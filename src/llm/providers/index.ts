import type { ExtractedContent, LLMProviderConfig, SummaryMode, SummaryPreferences, SummaryResult } from '../../shared/types';
import { resolveGenerationParameters } from '../model-catalog';
import { buildSummaryMessages } from '../prompts/summarize';
import { parseSummaryResult } from '../summary-parser';
import { callAnthropic } from './anthropic';
import { callGemini } from './gemini';
import { callOpenAICompatible } from './openai-compatible';

export async function summarizeWithProvider(
  provider: LLMProviderConfig,
  content: ExtractedContent,
  mode: SummaryMode,
  preferences: SummaryPreferences,
  feedback: string[] = []
): Promise<SummaryResult> {
  const request = {
    provider,
    messages: buildSummaryMessages(content, mode, preferences, feedback),
    parameters: resolveGenerationParameters(provider, mode)
  };

  const raw = await (provider.apiStyle === 'anthropic'
    ? callAnthropic(request)
    : provider.apiStyle === 'gemini'
      ? callGemini(request)
      : callOpenAICompatible(request));

  return parseSummaryResult(raw);
}
