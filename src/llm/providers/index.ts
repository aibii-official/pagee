import type { ExtractedContent, LLMProviderConfig, SummaryMode, SummaryPreferences, SummaryResult } from '../../shared/types';
import type { SummaryProgressStage } from '../../shared/messages';
import { createSummaryContentChunks } from '../content-chunks';
import { resolveGenerationParameters, shouldAttemptVisionForProvider } from '../model-registry';
import { buildSummaryMessages } from '../prompts/summarize';
import { parseSummaryResult, SummaryParseError } from '../summary-parser';
import { callAnthropic } from './anthropic';
import { callGemini } from './gemini';
import { callOpenAICompatible } from './openai-compatible';

const SYNTHESIS_GROUP_TEXT_CHARS = 24000;

type ProgressReporter = (progress: { stage: SummaryProgressStage; message: string; current?: number; total?: number }) => void | Promise<void>;

function shouldRetrySummaryFailure(error: unknown): boolean {
  const message = (error as Error).message.toLowerCase();
  return error instanceof SummaryParseError || message.includes('output token limit') || message.includes('token limit') || message.includes('length');
}

function isImageFormatError(error: unknown): boolean {
  const message = (error as Error).message.toLowerCase();
  return message.includes('unsupported image format') || message.includes('invalid image') || message.includes('image_url') || message.includes('media type');
}

function chunkPlanLabel(content: ExtractedContent, chunksLength: number): string {
  const pageCount = typeof content.metadata.pageCount === 'number' ? content.metadata.pageCount : undefined;
  const mediaCount = content.media?.length ?? 0;
  const source = pageCount ? ` from ${pageCount} PDF page${pageCount === 1 ? '' : 's'}` : '';
  const media = mediaCount ? ` and ${mediaCount} media attachment${mediaCount === 1 ? '' : 's'}` : '';
  return `Prepared ${chunksLength} request chunk${chunksLength === 1 ? '' : 's'}${source}${media}`;
}

async function callProviderRaw(request: Parameters<typeof callOpenAICompatible>[0]): Promise<string> {
  return request.provider.apiStyle === 'anthropic'
    ? callAnthropic(request)
    : request.provider.apiStyle === 'gemini'
      ? callGemini(request)
      : callOpenAICompatible(request);
}

async function summarizeSingleContent(
  provider: LLMProviderConfig,
  content: ExtractedContent,
  mode: SummaryMode,
  preferences: SummaryPreferences,
  feedback: string[],
  includeMedia: boolean,
  progress?: ProgressReporter,
  progressMessage = 'Waiting for provider response',
  progressStage: SummaryProgressStage = 'summarizing',
  progressCurrent?: number,
  progressTotal?: number
): Promise<SummaryResult> {
  await progress?.({ stage: progressStage, message: progressMessage, current: progressCurrent, total: progressTotal });
  const raw = await callProviderRaw({
    provider,
    messages: buildSummaryMessages(content, mode, preferences, feedback, { includeMedia }),
    parameters: resolveGenerationParameters(provider, mode)
  }).catch(async (error) => {
    // Only retry on token limit or JSON parsing errors
    if (!shouldRetrySummaryFailure(error)) {
      throw error;
    }

    await progress?.({ stage: progressStage, message: `${progressMessage}; retrying with strict complete JSON`, current: progressCurrent, total: progressTotal });
    return callProviderRaw({
      provider,
      messages: buildSummaryMessages(content, mode, preferences, [...feedback, '上一次输出可能被截断或不是合法 JSON。请重新输出完整、合法的 JSON；宁可减少措辞长度，也不能省略 JSON 结构或提前结束。'], { includeMedia }),
      parameters: resolveGenerationParameters(provider, mode)
    });
  });

  try {
    return parseSummaryResult(raw);
  } catch (error) {
    if (!shouldRetrySummaryFailure(error)) {
      throw error;
    }

    await progress?.({ stage: progressStage, message: `${progressMessage}; repairing invalid JSON response`, current: progressCurrent, total: progressTotal });
    const repairedRaw = await callProviderRaw({
      provider,
      messages: buildSummaryMessages(content, mode, preferences, [...feedback, '上一次输出不是完整合法 JSON。请基于同一输入重新输出完整 JSON。不要输出 Markdown，不要解释。'], { includeMedia }),
      parameters: resolveGenerationParameters(provider, mode)
    });
    return parseSummaryResult(repairedRaw);
  }
}

function summaryToText(summary: SummaryResult, index: number): string {
  return [
    `分块 ${index + 1}`,
    `TLDR: ${summary.tldr}`,
    summary.bullets.length ? `要点:\n${summary.bullets.map((item) => `- ${item}`).join('\n')}` : '',
    summary.detailed ? `详细:\n${summary.detailed}` : '',
    summary.keyClaims.length ? `关键论断:\n${summary.keyClaims.map((item) => `- ${item}`).join('\n')}` : '',
    summary.entities.length ? `实体: ${summary.entities.join(', ')}` : '',
    summary.topics.length ? `主题: ${summary.topics.join(', ')}` : '',
    summary.quotes.length
      ? `引用证据:\n${summary.quotes.map((quote) => `- ${quote.sourceBlockId ? `[${quote.sourceBlockId}] ` : ''}${quote.text} (${quote.reason})`).join('\n')}`
      : '',
    summary.actionItems?.length ? `行动项:\n${summary.actionItems.map((item) => `- ${item}`).join('\n')}` : '',
    summary.openQuestions?.length ? `开放问题:\n${summary.openQuestions.map((item) => `- ${item}`).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

function groupSummaries(summaries: SummaryResult[]): SummaryResult[][] {
  const groups: SummaryResult[][] = [];
  let current: SummaryResult[] = [];
  let currentLength = 0;

  summaries.forEach((summary, index) => {
    const length = summaryToText(summary, index).length;
    if (current.length > 0 && currentLength + length > SYNTHESIS_GROUP_TEXT_CHARS) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }

    current.push(summary);
    currentLength += length;
  });

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function createSynthesisContent(original: ExtractedContent, summaries: SummaryResult[], level: number): ExtractedContent {
  const blocks = summaries.map((summary, index) => ({
    id: `summary-${level}-${index + 1}`,
    type: 'paragraph' as const,
    text: summaryToText(summary, index)
  }));
  const text = blocks.map((block) => `[${block.id}]\n${block.text}`).join('\n\n');

  return {
    ...original,
    extractorId: `${original.extractorId}-synthesis`,
    text,
    blocks,
    media: [],
    metadata: {
      ...original.metadata,
      synthesisLevel: level,
      sourceSummaryCount: summaries.length
    },
    quality: {
      ...original.quality,
      textLength: text.length
    }
  };
}

async function synthesizeSummaries(
  provider: LLMProviderConfig,
  original: ExtractedContent,
  summaries: SummaryResult[],
  mode: SummaryMode,
  preferences: SummaryPreferences,
  feedback: string[],
  level = 1,
  progress?: ProgressReporter
): Promise<SummaryResult> {
  const groups = groupSummaries(summaries);

  if (groups.length === 1) {
    return summarizeSingleContent(
      provider,
      createSynthesisContent(original, groups[0], level),
      mode,
      preferences,
      [...feedback, `这是对 ${summaries.length} 个分块摘要的全局综合。必须覆盖所有分块的主要信息，合并重复项，不要遗漏低频但重要的论断、图表信息或开放问题。`],
      false,
      progress,
      `Synthesizing final summary from ${summaries.length} chunk summaries`,
      'synthesizing',
      1,
      1
    );
  }

  const intermediate: SummaryResult[] = [];
  for (let index = 0; index < groups.length; index += 1) {
    await progress?.({
      stage: 'synthesizing',
      message: `Synthesizing summary group ${index + 1} of ${groups.length}`,
      current: index + 1,
      total: groups.length
    });
    intermediate.push(
      await summarizeSingleContent(
        provider,
        createSynthesisContent(original, groups[index], level),
        mode === 'short' ? 'medium' : mode,
        preferences,
        [...feedback, `这是第 ${index + 1}/${groups.length} 组分块摘要的中间综合。必须保留这一组内所有重要信息。`],
        false,
        progress,
        `Waiting for provider response for synthesis group ${index + 1} of ${groups.length}`,
        'synthesizing',
        index + 1,
        groups.length
      )
    );
  }

  return synthesizeSummaries(provider, original, intermediate, mode, preferences, feedback, level + 1, progress);
}

export async function summarizeWithProvider(
  provider: LLMProviderConfig,
  content: ExtractedContent,
  mode: SummaryMode,
  preferences: SummaryPreferences,
  feedback: string[] = [],
  progress?: ProgressReporter
): Promise<SummaryResult> {
  const hasMedia = Boolean(content.media?.some((item) => item.dataUrl || item.url));
  const includeMedia = hasMedia && shouldAttemptVisionForProvider(provider, provider.chatModel);

  await progress?.({ stage: 'chunking', message: 'Preparing content chunks' });
  const chunks = createSummaryContentChunks(content, includeMedia);
  await progress?.({ stage: 'chunking', message: chunkPlanLabel(content, chunks.length), current: 0, total: chunks.length });

  if (chunks.length === 1) {
    return summarizeSingleContent(provider, chunks[0], mode, preferences, feedback, includeMedia, progress, 'Waiting for provider response', 'summarizing', 1, 1);
  }

  const chunkSummaries: SummaryResult[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await progress?.({
      stage: 'summarizing',
      message: `Summarizing request chunk ${index + 1} of ${chunks.length}`,
      current: index + 1,
      total: chunks.length
    });
    chunkSummaries.push(
      await summarizeSingleContent(
        provider,
        chunk,
        mode === 'short' ? 'medium' : mode,
        preferences,
        [
          ...feedback,
          `这是完整内容的第 ${index + 1}/${chunks.length} 个分块。这个分块必须被完整覆盖：保留所有重要事实、论断、图表/图片信息、页码和引用 ID。不要因为最终摘要会再综合而省略关键信息。`
        ],
        includeMedia && Boolean(chunk.media?.some((item) => item.dataUrl || item.url)),
        progress,
        `Waiting for provider response for chunk ${index + 1} of ${chunks.length}`,
        'summarizing',
        index + 1,
        chunks.length
      )
    );
  }

  return synthesizeSummaries(provider, content, chunkSummaries, mode, preferences, feedback, 1, progress);
}
