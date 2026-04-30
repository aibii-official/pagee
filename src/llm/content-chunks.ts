import type { ContentBlock, ContentMedia, ExtractedContent } from '../shared/types';

const MAX_TEXT_CHARS_PER_CHUNK = 24000;
const MAX_MEDIA_PER_CHUNK = 6;
const LONG_BLOCK_PART_CHARS = 12000;

function blockTextLength(blocks: ContentBlock[]): number {
  return blocks.reduce((total, block) => total + block.text.length, 0);
}

function pageNumberFromBlock(block: ContentBlock): number | undefined {
  const value = [block.source, block.id].filter(Boolean).join(' ');
  const match = value.match(/(?:page|p)(?:\s|-)*(\d+)/i);
  const pageNumber = match?.[1] ? Number(match[1]) : NaN;
  return Number.isFinite(pageNumber) ? pageNumber : undefined;
}

function fallbackBlocks(content: ExtractedContent): ContentBlock[] {
  if (content.blocks.length > 0) {
    return content.blocks;
  }

  return content.text
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `text-${index + 1}`,
      type: 'paragraph',
      text
    }));
}

function splitLongBlock(block: ContentBlock): ContentBlock[] {
  if (block.text.length <= LONG_BLOCK_PART_CHARS) {
    return [block];
  }

  const parts: ContentBlock[] = [];
  for (let start = 0; start < block.text.length; start += LONG_BLOCK_PART_CHARS) {
    parts.push({
      ...block,
      id: `${block.id}-part-${parts.length + 1}`,
      text: block.text.slice(start, start + LONG_BLOCK_PART_CHARS)
    });
  }

  return parts;
}

function makeChunk(content: ExtractedContent, blocks: ContentBlock[], media: ContentMedia[], index: number, total?: number): ExtractedContent {
  const text = blocks.map((block) => `[${block.source ?? block.id}]\n${block.text}`).join('\n\n');

  return {
    ...content,
    text,
    blocks,
    media,
    metadata: {
      ...content.metadata,
      summaryChunkIndex: index,
      summaryChunkTotal: total
    },
    quality: {
      ...content.quality,
      textLength: text.length
    }
  };
}

function pushMediaOnlyChunks(chunks: Array<{ blocks: ContentBlock[]; media: ContentMedia[] }>, media: ContentMedia[]): void {
  for (let start = 0; start < media.length; start += MAX_MEDIA_PER_CHUNK) {
    const group = media.slice(start, start + MAX_MEDIA_PER_CHUNK);
    chunks.push({
      blocks: group.map((item) => ({
        id: `${item.id}-visual-block`,
        type: 'image',
        text: `Visual attachment ${item.id}: ${item.description ?? item.source ?? item.type}${item.url ? ` (${item.url})` : ''}`,
        source: item.source
      })),
      media: group
    });
  }
}

export function createSummaryContentChunks(content: ExtractedContent, includeMedia: boolean): ExtractedContent[] {
  const media = includeMedia ? content.media ?? [] : [];
  const mediaByPage = new Map<number, ContentMedia[]>();
  const pageMediaIds = new Set<string>();

  media.forEach((item) => {
    if (typeof item.pageNumber === 'number') {
      mediaByPage.set(item.pageNumber, [...(mediaByPage.get(item.pageNumber) ?? []), item]);
      pageMediaIds.add(item.id);
    }
  });

  const unassignedMedia = media.filter((item) => !pageMediaIds.has(item.id));
  const blocks = fallbackBlocks(content).flatMap(splitLongBlock);
  const chunks: Array<{ blocks: ContentBlock[]; media: ContentMedia[] }> = [];
  let currentBlocks: ContentBlock[] = [];
  let currentMedia: ContentMedia[] = [];
  const attachedMediaIds = new Set<string>();

  function flush() {
    if (currentBlocks.length > 0 || currentMedia.length > 0) {
      chunks.push({ blocks: currentBlocks, media: currentMedia });
      currentBlocks = [];
      currentMedia = [];
    }
  }

  blocks.forEach((block) => {
    const pageNumber = pageNumberFromBlock(block);
    const blockMedia = pageNumber ? mediaByPage.get(pageNumber)?.filter((item) => !attachedMediaIds.has(item.id)) ?? [] : [];

    if (
      currentBlocks.length > 0 &&
      (blockTextLength(currentBlocks) + block.text.length > MAX_TEXT_CHARS_PER_CHUNK || currentMedia.length + blockMedia.length > MAX_MEDIA_PER_CHUNK)
    ) {
      flush();
    }

    currentBlocks.push(block);

    blockMedia.forEach((item) => {
      if (currentMedia.length >= MAX_MEDIA_PER_CHUNK) {
        flush();
        currentBlocks.push({
          id: `${item.id}-context`,
          type: 'image',
          text: `Continuation visual attachment ${item.id}: ${item.description ?? item.source ?? item.type}${item.url ? ` (${item.url})` : ''}`,
          source: item.source
        });
      }

      currentMedia.push(item);
      attachedMediaIds.add(item.id);
    });
  });

  flush();
  pushMediaOnlyChunks(chunks, unassignedMedia);

  if (chunks.length === 0) {
    return [makeChunk(content, [], [], 1, 1)];
  }

  return chunks.map((chunk, index) => makeChunk(content, chunk.blocks, chunk.media, index + 1, chunks.length));
}
