import { SUMMARY_PROMPT_VERSION } from '../llm/prompts/summarize';
import { createId, sha256 } from '../shared/hash';
import { normalizeUrlForLookup, urlLookupCandidates, urlsMatchForLookup } from '../shared/url';
import type {
  DocumentMemory,
  ExtractedContent,
  ExtractorRunLog,
  LibraryEntry,
  LLMProviderConfig,
  SummaryMode,
  SummaryResult,
  SummaryVersion
} from '../shared/types';
import { db, type ExtractedContentRecord } from './db';

export interface SaveSummarySnapshotInput {
  content: ExtractedContent;
  summary: SummaryResult;
  provider: LLMProviderConfig;
  mode: SummaryMode;
  feedback?: string[];
  saveExtractedText: boolean;
}

function compactId(prefix: string, hash: string): string {
  return `${prefix}_${hash.slice(0, 24)}`;
}

function entityId(name: string): string {
  return `entity_${name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function includesQuery(entry: LibraryEntry, query: string): boolean {
  const haystack = [
    entry.document.title,
    entry.document.url,
    entry.document.tags.join(' '),
    entry.document.topics.join(' '),
    entry.latestSummary?.summary.tldr,
    entry.latestSummary?.summary.bullets.join(' '),
    entry.latestSummary?.summary.entities.join(' ')
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

export async function saveExtractionLog(log: ExtractorRunLog): Promise<void> {
  await db.extractionLogs.put(log);
}

export async function saveSummarySnapshot(input: SaveSummarySnapshotInput): Promise<{
  document: DocumentMemory;
  summaryVersion: SummaryVersion;
}> {
  const now = Date.now();
  const contentHash = await sha256(input.content.text);
  const docHash = await sha256(normalizeUrlForLookup(input.content.canonicalUrl || input.content.url) ?? input.content.url);
  const documentId = compactId('doc', docHash);
  const extractedContentId = compactId('content', contentHash);
  const summaryId = createId('summary');
  const existing = await db.documents.get(documentId);
  const topics = Array.from(new Set([...(existing?.topics ?? []), ...input.summary.topics]));
  const entityIds = Array.from(new Set([...(existing?.entityIds ?? []), ...input.summary.entities.map(entityId)]));
  const summaryVersion: SummaryVersion = {
    id: summaryId,
    documentId,
    extractorId: input.content.extractorId,
    providerId: input.provider.id,
    model: input.provider.chatModel,
    promptVersion: SUMMARY_PROMPT_VERSION,
    mode: input.mode,
    summary: input.summary,
    feedback: input.feedback,
    createdAt: now
  };
  const documentMemory: DocumentMemory = {
    id: documentId,
    url: input.content.url,
    canonicalUrl: input.content.canonicalUrl,
    title: input.content.title,
    contentHash,
    contentType: input.content.contentType,
    extractedContentId,
    summaryIds: [...(existing?.summaryIds ?? []), summaryId],
    tags: existing?.tags ?? [],
    topics,
    entityIds,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  const extractedContent: ExtractedContentRecord = {
    ...input.content,
    id: extractedContentId,
    contentHash,
    createdAt: now,
    text: input.saveExtractedText ? input.content.text : '',
    blocks: input.saveExtractedText ? input.content.blocks : []
  };

  await db.transaction('rw', db.extractedContents, db.documents, db.summaries, async () => {
    await db.extractedContents.put(extractedContent);
    await db.documents.put(documentMemory);
    await db.summaries.put(summaryVersion);
  });

  return { document: documentMemory, summaryVersion };
}

export async function getLatestSummary(documentId: string): Promise<SummaryVersion | undefined> {
  return db.summaries
    .where('documentId')
    .equals(documentId)
    .sortBy('createdAt')
    .then((items) => items.at(-1));
}

export async function getLibraryEntryForUrl(url: string): Promise<LibraryEntry | undefined> {
  const candidates = urlLookupCandidates(url);
  let documentByCanonical: DocumentMemory | undefined;

  for (const candidate of candidates) {
    documentByCanonical =
      (await db.documents.where('url').equals(candidate).first()) ??
      (await db.documents.where('canonicalUrl').equals(candidate).first());

    if (documentByCanonical) {
      break;
    }
  }

  if (!documentByCanonical) {
    const recentDocuments = await db.documents.orderBy('updatedAt').reverse().limit(300).toArray();
    documentByCanonical = recentDocuments.find(
      (document) => urlsMatchForLookup(document.url, url) || urlsMatchForLookup(document.canonicalUrl, url)
    );
  }

  if (!documentByCanonical) {
    return undefined;
  }

  return {
    document: documentByCanonical,
    latestSummary: await getLatestSummary(documentByCanonical.id)
  };
}

export async function listLibraryEntries(query?: string, limit = 100): Promise<LibraryEntry[]> {
  const documents = await db.documents.orderBy('updatedAt').reverse().limit(limit).toArray();
  const entries = await Promise.all(
    documents.map(async (document) => ({
      document,
      latestSummary: await getLatestSummary(document.id)
    }))
  );

  const trimmed = query?.trim();
  return trimmed ? entries.filter((entry) => includesQuery(entry, trimmed)) : entries;
}

export async function listRecentExtractionLogs(limit = 20): Promise<ExtractorRunLog[]> {
  return db.extractionLogs.orderBy('createdAt').reverse().limit(limit).toArray();
}

export async function clearLibrary(): Promise<void> {
  await db.transaction(
    'rw',
    [db.documents, db.summaries, db.extractedContents, db.extractionLogs, db.knowledgeNodes, db.knowledgeEdges],
    async () => {
      await Promise.all([
        db.documents.clear(),
        db.summaries.clear(),
        db.extractedContents.clear(),
        db.extractionLogs.clear(),
        db.knowledgeNodes.clear(),
        db.knowledgeEdges.clear()
      ]);
    }
  );
}
