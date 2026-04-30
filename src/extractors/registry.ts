import type {
  ContentExtractorPlugin,
  ExtractionContext,
  ExtractorRunLog,
  ExtractorRuntimeSettings,
  ExtractedContent
} from '../shared/types';
import { createDeclarativeRuleExtractor } from './declarative-rule-extractor';
import { CODE_EXTRACTOR_PLUGINS_AFTER_RULES, CODE_EXTRACTOR_PLUGINS_BEFORE_RULES } from './manifest';

export interface ExtractionRunResult {
  content: ExtractedContent;
  log: ExtractorRunLog;
}

function applySettings(plugin: ContentExtractorPlugin, settings: ExtractorRuntimeSettings): ContentExtractorPlugin | undefined {
  if (settings.disabledExtractorIds.includes(plugin.id)) {
    return undefined;
  }

  return {
    ...plugin,
    priority: settings.priorities[plugin.id] ?? plugin.priority
  };
}

function createPlugins(settings: ExtractorRuntimeSettings): ContentExtractorPlugin[] {
  return [
    ...CODE_EXTRACTOR_PLUGINS_BEFORE_RULES,
    createDeclarativeRuleExtractor(settings.declarativeRules),
    ...CODE_EXTRACTOR_PLUGINS_AFTER_RULES
  ]
    .map((plugin) => applySettings(plugin, settings))
    .filter((plugin): plugin is ContentExtractorPlugin => Boolean(plugin))
    .sort((a, b) => b.priority - a.priority);
}

function makeLog(
  url: string,
  plugin: ContentExtractorPlugin,
  content: ExtractedContent,
  candidateIds: string[],
  error?: string
): ExtractorRunLog {
  return {
    id: `log_${crypto.randomUUID()}`,
    url,
    extractorId: plugin.id,
    extractorName: plugin.name,
    quality: content.quality,
    candidateIds,
    selected: true,
    error,
    createdAt: Date.now()
  };
}

export async function runExtractors(
  ctx: ExtractionContext,
  settings: ExtractorRuntimeSettings
): Promise<ExtractionRunResult> {
  const plugins = createPlugins(settings);
  const candidates: ContentExtractorPlugin[] = [];
  const errors: string[] = [];

  for (const plugin of plugins) {
    try {
      if (await plugin.matches(ctx)) {
        candidates.push(plugin);
      }
    } catch (error) {
      errors.push(`${plugin.id}: ${(error as Error).message}`);
    }
  }

  const candidateIds = candidates.map((plugin) => plugin.id);
  let best: { plugin: ContentExtractorPlugin; content: ExtractedContent } | undefined;

  for (const plugin of candidates) {
    try {
      const content = await plugin.extract(ctx);
      const quality = plugin.validate?.(content) ?? content.quality;
      const normalizedContent = { ...content, quality };

      if (!best || normalizedContent.quality.score > best.content.quality.score) {
        best = { plugin, content: normalizedContent };
      }

      const requiredScore = plugin.id === 'visible-text' ? 0.1 : 0.45;
      if (plugin.id === 'selection' || normalizedContent.quality.score >= requiredScore) {
        return {
          content: normalizedContent,
          log: makeLog(ctx.url, plugin, normalizedContent, candidateIds, errors.join('; ') || undefined)
        };
      }
    } catch (error) {
      errors.push(`${plugin.id}: ${(error as Error).message}`);
    }
  }

  if (best) {
    best.content.quality.warnings.push('Best available extractor was below the preferred quality threshold.');
    return {
      content: best.content,
      log: makeLog(ctx.url, best.plugin, best.content, candidateIds, errors.join('; ') || undefined)
    };
  }

  throw new Error(`No extractor produced content. ${errors.join('; ')}`.trim());
}
