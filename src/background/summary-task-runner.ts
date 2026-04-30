import { summarizeWithProvider } from '../llm/providers';
import { getModelOptionForProvider } from '../llm/model-registry';
import { createId, sha256 } from '../shared/hash';
import type { SummaryProgressStage } from '../shared/messages';
import type {
  DocumentMemory,
  ExtractedContent,
  LLMProviderConfig,
  SummaryMode,
  SummaryTaskResult,
  SummaryVersion,
  UserSettings
} from '../shared/types';
import { saveSummarySnapshot } from '../storage/repositories';
import { ensureProviderPermission, getSettings } from '../storage/settings';

export type SummaryProgressPublisher = (
  stage: SummaryProgressStage,
  message: string,
  current?: number,
  total?: number
) => void;

export function selectSummaryProvider(settings: UserSettings, providerId?: string, chatModel?: string): LLMProviderConfig {
  const provider = providerId
    ? settings.providers.find((candidate) => candidate.id === providerId && candidate.enabled)
    : settings.providers.find((candidate) => candidate.id === settings.activeProviderId && candidate.enabled) ??
      settings.providers.find((candidate) => candidate.enabled);

  if (!provider) {
    throw new Error('No enabled provider. Configure an official API provider in Options first.');
  }

  if (!provider.apiKey.trim()) {
    throw new Error(`${provider.name} is enabled but has no API key.`);
  }

  const selectedModel = getModelOptionForProvider(provider, chatModel?.trim() || provider.chatModel);
  return { ...provider, chatModel: selectedModel.id };
}

async function createTransientSnapshot(
  content: ExtractedContent,
  mode: SummaryMode,
  summaryVersion: Omit<SummaryVersion, 'id' | 'documentId' | 'createdAt'>
): Promise<{ document: DocumentMemory; summaryVersion: SummaryVersion }> {
  const now = Date.now();
  const mediaHashSource = (content.media ?? [])
    .map((item) => [item.id, item.source, item.description, item.url, item.dataUrl].filter(Boolean).join('\n'))
    .join('\n\n');
  const contentHash = await sha256([content.text, mediaHashSource].filter(Boolean).join('\n\n'));
  const documentId = `transient_${crypto.randomUUID()}`;
  const summaryId = createId('summary');
  const document: DocumentMemory = {
    id: documentId,
    url: content.url,
    canonicalUrl: content.canonicalUrl,
    title: content.title,
    contentHash,
    contentType: content.contentType,
    extractedContentId: `transient_content_${contentHash.slice(0, 24)}`,
    summaryIds: [summaryId],
    tags: [],
    topics: summaryVersion.summary.topics,
    entityIds: summaryVersion.summary.entities,
    createdAt: now,
    updatedAt: now
  };

  return {
    document,
    summaryVersion: {
      ...summaryVersion,
      id: summaryId,
      documentId,
      mode,
      createdAt: now
    }
  };
}

export async function runExtractedContentSummary(input: {
  content: ExtractedContent;
  mode: SummaryMode;
  feedback?: string[];
  providerId?: string;
  chatModel?: string;
  publishProgress?: SummaryProgressPublisher;
}): Promise<SummaryTaskResult> {
  const settings = await getSettings();
  const provider = selectSummaryProvider(settings, input.providerId, input.chatModel);
  input.publishProgress?.('preparing', `Using ${provider.name} · ${provider.chatModel}`);
  await ensureProviderPermission(provider);

  const summary = await summarizeWithProvider(
    provider,
    input.content,
    input.mode,
    settings.summaryPreferences,
    input.feedback,
    (progress) => input.publishProgress?.(progress.stage, progress.message, progress.current, progress.total)
  );

  input.publishProgress?.('saving', 'Saving summary to local memory');
  const stored = settings.privacy.saveSummaries
    ? await saveSummarySnapshot({
        content: input.content,
        summary,
        provider,
        mode: input.mode,
        feedback: input.feedback,
        saveExtractedText: settings.privacy.saveExtractedText
      })
    : await createTransientSnapshot(input.content, input.mode, {
        extractorId: input.content.extractorId,
        providerId: provider.id,
        model: provider.chatModel,
        promptVersion: 'summary-json-v1',
        mode: input.mode,
        summary,
        feedback: input.feedback
      });

  input.publishProgress?.('complete', 'Summary complete');
  return {
    content: input.content,
    document: stored.document,
    summaryVersion: stored.summaryVersion,
    providerName: provider.name
  };
}
