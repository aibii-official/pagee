import type { ExtractedContent, SummaryMode, SummaryPreferences } from '../../shared/types';
import { supportedImageDataUrl, supportedImageDataUrlMimeType } from '../../shared/media';
import type { LLMImagePart, LLMMessage } from '../types';

export const SUMMARY_PROMPT_VERSION = 'summary-json-v1';

const MODE_INSTRUCTIONS: Record<SummaryMode, string> = {
  short: '输出一句 TLDR 和 3 到 5 个要点，保持极短。',
  medium: '输出 TLDR、要点、关键论断和重要引用，适合作为默认知识卡片。',
  long: '输出详细摘要、背景、主张、证据、限制和影响。',
  study: '输出学习摘要，包含概念解释、先修知识、易混点和复习问题。',
  research: '输出研究摘要，明确 claim、evidence、assumption、open question。'
};

function preferenceInstruction(preferences: SummaryPreferences): string {
  const language = {
    zh: '中文',
    en: 'English',
    bilingual: '中英双语'
  }[preferences.language];

  return `摘要语言：${language}。长度偏好：${preferences.length}。风格偏好：${preferences.style}。`;
}

function compactBlocks(content: ExtractedContent): string {
  const blockText = content.blocks
    .map((block) => `[${block.id}] (${block.type}) ${block.text}`)
    .join('\n\n');
  const source = blockText || content.text;
  return source;
}

function mediaSummary(content: ExtractedContent, includeMedia: boolean): string {
  const media = content.media ?? [];
  if (media.length === 0) {
    return '';
  }

  const embeddedCount = media.filter((item) => supportedImageDataUrl(item.dataUrl)).length;

  const available = media
    .map((item) => `[${item.id}] ${item.source ?? item.type}${item.description ? ` · ${item.description}` : ''}${item.url ? ` · ${item.url}` : ''}`)
    .join('\n');

  return includeMedia
    ? `视觉附件：以下图片也是原始内容的一部分，其中 ${embeddedCount}/${media.length} 个已通过本地 MIME 校验并作为图片输入发送给模型；只有已发送的图片可被视觉理解，URL-only 项仅作为来源元数据。若已发送的视觉附件中能看到相关图片、图表或插画，必须基于视觉内容描述和总结，不要声称“文本未呈现所以无法确认”。引用视觉证据时优先使用对应图片 ID 或同页 block ID。\n${available}`
    : `视觉附件未发送给当前模型：当前抽取结果包含 ${media.length} 个图片附件，但所选模型未声明视觉输入能力。本次摘要只能基于文本块。`;
}

function mediaParts(content: ExtractedContent): LLMImagePart[] {
  return (content.media ?? [])
    .filter((item) => item.type === 'image' && Boolean(supportedImageDataUrl(item.dataUrl)))
    .map((item) => ({
      type: 'image',
      id: item.id,
      source: item.source,
      dataUrl: supportedImageDataUrl(item.dataUrl),
      url: undefined,
      mimeType: supportedImageDataUrlMimeType(item.dataUrl) || item.mimeType
    }));
}

export function buildSummaryMessages(
  content: ExtractedContent,
  mode: SummaryMode,
  preferences: SummaryPreferences,
  feedback: string[] = [],
  options: { includeMedia?: boolean } = {}
): LLMMessage[] {
  const feedbackInstruction = feedback.length > 0 ? `用户本轮反馈：${feedback.join('、')}。` : '';
  const includeMedia = Boolean(options.includeMedia);
  const userText = [
    `页面标题：${content.title}`,
    `URL：${content.url}`,
    `内容类型：${content.contentType}`,
    `抽取器：${content.extractorId}`,
    `抽取质量：${content.quality.score}，字数：${content.quality.textLength}`,
    preferenceInstruction(preferences),
    MODE_INSTRUCTIONS[mode],
    feedbackInstruction,
    mediaSummary(content, includeMedia),
    '请严格输出如下 JSON 结构：',
    '{',
    '  "tldr": "string",',
    '  "bullets": ["string"],',
    '  "detailed": "string | optional",',
    '  "keyClaims": ["string"],',
    '  "entities": ["string"],',
    '  "topics": ["string"],',
    '  "quotes": [{"text":"string","sourceBlockId":"string | optional","reason":"string"}],',
    '  "actionItems": ["string"],',
    '  "openQuestions": ["string"],',
    '  "confidence": "low | medium | high"',
    '}',
    '原文分块：',
    compactBlocks(content)
  ]
    .filter(Boolean)
    .join('\n\n');
  const images = includeMedia ? mediaParts(content) : [];

  return [
    {
      role: 'system',
      content: [
        '你是浏览器插件里的个人知识压缩助手。',
        '只基于用户提供的原文、视觉附件和元数据生成摘要，不编造输入里没有的信息。',
        '必须区分原文事实、模型推断和建议。',
        '引用必须尽量带 sourceBlockId，对应输入里的段落 ID、页码 block ID 或图片 ID。',
        '只输出合法 JSON，不要输出 Markdown 代码块。'
      ].join('\n')
    },
    {
      role: 'user',
      content: images.length > 0 ? [{ type: 'text', text: userText }, ...images] : userText
    }
  ];
}
