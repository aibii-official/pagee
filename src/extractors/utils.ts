import type {
  ContentBlock,
  ContentBlockType,
  ContentType,
  ExtractionContext,
  ExtractionQuality,
  ExtractedContent
} from '../shared/types';

const DEFAULT_BLOCK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,blockquote,pre,code,li,table,figcaption';

export function cleanText(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function cleanMultilineText(value?: string | null): string {
  return (value ?? '')
    .replace(/\r/g, '')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getCanonicalUrl(document: Document): string | undefined {
  return document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || undefined;
}

export function getMetaContent(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const content = document.querySelector<HTMLMetaElement>(selector)?.content;
    if (content?.trim()) {
      return cleanText(content);
    }
  }

  return undefined;
}

export function getSiteName(ctx: ExtractionContext): string | undefined {
  return (
    getMetaContent(ctx.document, [
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
      'meta[name="twitter:site"]'
    ]) || ctx.hostname
  );
}

export function getTitle(ctx: ExtractionContext, fallback = 'Untitled page'): string {
  return cleanText(
    getMetaContent(ctx.document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) || ctx.document.title || fallback
  );
}

export function getPublishedAt(document: Document): string | undefined {
  const time = document.querySelector<HTMLTimeElement>('time[datetime]')?.dateTime;
  return cleanText(getMetaContent(document, ['meta[property="article:published_time"]']) || time) || undefined;
}

export function getAuthor(document: Document): string | undefined {
  return cleanText(
    getMetaContent(document, ['meta[name="author"]', 'meta[property="article:author"]', 'meta[name="twitter:creator"]'])
  ) || undefined;
}

export function hostnameMatches(pattern: string, hostname: string): boolean {
  const hostPattern = pattern
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  const normalizedHost = hostname.toLowerCase();
  const escaped = hostPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(normalizedHost);
}

export function elementSelector(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${CSS.escape(element.id)}` : '';
  const className = Array.from(element.classList).slice(0, 2).map((item) => `.${CSS.escape(item)}`).join('');
  return `${tag}${id}${className}`;
}

export function blockTypeForElement(element: Element): ContentBlockType {
  const tag = element.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'blockquote') return 'quote';
  if (tag === 'pre' || tag === 'code') return 'code';
  if (tag === 'li' || tag === 'ul' || tag === 'ol') return 'list';
  if (tag === 'table') return 'table';
  if (tag === 'figcaption') return 'caption';
  return 'paragraph';
}

export function blocksFromElement(root: ParentNode, selector = DEFAULT_BLOCK_SELECTOR): ContentBlock[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(selector));
  const blocks: ContentBlock[] = [];
  const seen = new Set<string>();

  elements.forEach((element, index) => {
    const text = cleanText(element.innerText || element.textContent);
    if (!text || text.length < 2 || seen.has(text)) {
      return;
    }

    seen.add(text);
    blocks.push({
      id: `b${index + 1}`,
      type: blockTypeForElement(element),
      text,
      selector: elementSelector(element)
    });
  });

  return blocks;
}

export function blocksFromSelectorMap(
  root: ParentNode,
  blockSelectors?: Partial<Record<ContentBlockType, string>>
): ContentBlock[] {
  if (!blockSelectors) {
    return blocksFromElement(root);
  }

  const elements = new Map<Element, ContentBlockType>();

  Object.entries(blockSelectors).forEach(([type, selector]) => {
    if (!selector) return;
    root.querySelectorAll(selector).forEach((element) => {
      if (!elements.has(element)) {
        elements.set(element, type as ContentBlockType);
      }
    });
  });

  return Array.from(elements.entries())
    .sort(([a], [b]) => {
      if (a === b) return 0;
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    })
    .map(([element, type], index) => ({
      id: `b${index + 1}`,
      type,
      text: cleanText((element as HTMLElement).innerText || element.textContent),
      selector: elementSelector(element)
    }))
    .filter((block) => block.text.length > 1);
}

export function textFromBlocks(blocks: ContentBlock[], fallback?: string): string {
  const text = blocks.map((block) => block.text).join('\n\n');
  return cleanMultilineText(text || fallback);
}

export function scoreExtraction(content: Omit<ExtractedContent, 'quality'>): ExtractionQuality {
  const warnings: string[] = [];
  const textLength = content.text.length;
  const lines = content.text.split(/\n+/).map(cleanText).filter(Boolean);
  const uniqueLines = new Set(lines);
  const duplicateRatio = lines.length > 0 ? 1 - uniqueLines.size / lines.length : 0;

  if (textLength < 200 && content.contentType !== 'selection') {
    warnings.push('Extracted text is short; consider selecting the exact text to summarize.');
  }

  if (duplicateRatio > 0.35) {
    warnings.push('Extracted text appears repetitive.');
  }

  if (!content.title) {
    warnings.push('No title was detected.');
  }

  const lengthScore = Math.min(textLength / 3000, 1) * 0.45;
  const blockScore = Math.min(content.blocks.length / 12, 1) * 0.25;
  const titleScore = content.title ? 0.15 : 0;
  const typeScore = content.contentType === 'selection' ? 0.25 : 0.1;
  const duplicatePenalty = Math.min(duplicateRatio, 0.5) * 0.3;
  const score = Math.max(0, Math.min(1, lengthScore + blockScore + titleScore + typeScore - duplicatePenalty));

  return {
    score: Number(score.toFixed(2)),
    textLength,
    duplicateRatio: Number(duplicateRatio.toFixed(2)),
    hasTitle: Boolean(content.title),
    hasAuthor: Boolean(content.author),
    hasTimestamps: content.blocks.some((block) => typeof block.timestamp === 'number'),
    warnings
  };
}

export function finalizeContent(content: Omit<ExtractedContent, 'quality'>): ExtractedContent {
  const quality = scoreExtraction(content);
  return { ...content, quality };
}

export function createBaseContent(
  ctx: ExtractionContext,
  extractorId: string,
  contentType: ContentType,
  text: string,
  blocks: ContentBlock[],
  metadata: Record<string, unknown> = {}
): ExtractedContent {
  return finalizeContent({
    extractorId,
    url: ctx.url,
    canonicalUrl: getCanonicalUrl(ctx.document),
    title: getTitle(ctx),
    author: getAuthor(ctx.document),
    publishedAt: getPublishedAt(ctx.document),
    siteName: getSiteName(ctx),
    contentType,
    text: cleanMultilineText(text),
    blocks,
    metadata
  });
}
