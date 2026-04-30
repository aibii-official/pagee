import type { ExtractedContent, SummaryMode, SummaryPreferences } from '../../shared/types';
import type { LLMMessage } from '../types';

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
  const maxChars = 28000;
  const blockText = content.blocks
    .slice(0, 180)
    .map((block) => `[${block.id}] (${block.type}) ${block.text}`)
    .join('\n\n');
  const source = blockText || content.text;
  return source.length > maxChars ? `${source.slice(0, maxChars)}\n\n[TRUNCATED]` : source;
}

export function buildSummaryMessages(
  content: ExtractedContent,
  mode: SummaryMode,
  preferences: SummaryPreferences,
  feedback: string[] = []
): LLMMessage[] {
  const feedbackInstruction = feedback.length > 0 ? `用户本轮反馈：${feedback.join('、')}。` : '';

  return [
    {
      role: 'system',
      content: [
        '你是浏览器插件里的个人知识压缩助手。',
        '只基于用户提供的原文生成摘要，不编造原文没有的信息。',
        '必须区分原文事实、模型推断和建议。',
        '引用必须尽量带 sourceBlockId，对应输入里的段落 ID。',
        '只输出合法 JSON，不要输出 Markdown 代码块。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `页面标题：${content.title}`,
        `URL：${content.url}`,
        `内容类型：${content.contentType}`,
        `抽取器：${content.extractorId}`,
        `抽取质量：${content.quality.score}，字数：${content.quality.textLength}`,
        preferenceInstruction(preferences),
        MODE_INSTRUCTIONS[mode],
        feedbackInstruction,
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
        .join('\n\n')
    }
  ];
}
