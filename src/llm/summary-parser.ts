import { z } from 'zod';
import type { SummaryResult } from '../shared/types';

const QuoteSchema = z.object({
  text: z.string(),
  sourceBlockId: z.string().optional(),
  reason: z.string()
});

export const SummaryResultSchema = z.object({
  tldr: z.string(),
  bullets: z.array(z.string()).default([]),
  detailed: z.string().optional(),
  keyClaims: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  quotes: z.array(QuoteSchema).default([]),
  actionItems: z.array(z.string()).optional(),
  openQuestions: z.array(z.string()).optional(),
  confidence: z.enum(['low', 'medium', 'high']).default('medium')
});

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function extractJsonObject(raw: string): string {
  const stripped = stripJsonFences(raw);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return stripped.slice(start, end + 1);
  }

  return stripped;
}

export function parseSummaryResult(raw: string): SummaryResult {
  try {
    const parsed = JSON.parse(extractJsonObject(raw)) as unknown;
    const result = SummaryResultSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }
  } catch {
    // Fall through to a low-confidence summary so the UI can still save and display the model output.
  }

  return {
    tldr: raw.slice(0, 800),
    bullets: [],
    keyClaims: [],
    entities: [],
    topics: [],
    quotes: [],
    confidence: 'low'
  };
}
