import Dexie, { type Table } from 'dexie';
import type {
  ContentMedia,
  DocumentMemory,
  ExtractedContent,
  ExtractorRunLog,
  KnowledgeEdge,
  KnowledgeNode,
  SummaryVersion
} from '../shared/types';

export interface ExtractedContentRecord extends ExtractedContent {
  id: string;
  contentHash: string;
  createdAt: number;
}

export interface MediaAssetRecord extends Omit<ContentMedia, 'id' | 'assetId'> {
  id: string;
  mediaId: string;
  mediaHash: string;
  documentId: string;
  extractedContentId: string;
  createdAt: number;
}

export class PageeDatabase extends Dexie {
  documents!: Table<DocumentMemory, string>;
  summaries!: Table<SummaryVersion, string>;
  extractedContents!: Table<ExtractedContentRecord, string>;
  extractionLogs!: Table<ExtractorRunLog, string>;
  mediaAssets!: Table<MediaAssetRecord, string>;
  knowledgeNodes!: Table<KnowledgeNode, string>;
  knowledgeEdges!: Table<KnowledgeEdge, string>;

  constructor() {
    super('pagee-local-knowledge');
    this.version(1).stores({
      documents: 'id, url, canonicalUrl, contentHash, contentType, createdAt, updatedAt, *tags, *topics, *entityIds',
      summaries: 'id, documentId, extractorId, providerId, model, mode, createdAt',
      extractedContents: 'id, url, canonicalUrl, contentHash, extractorId, contentType, createdAt',
      extractionLogs: 'id, url, extractorId, createdAt',
      knowledgeNodes: 'id, type, name, *aliases, *sourceDocumentIds',
      knowledgeEdges: 'id, from, to, type, sourceDocumentId'
    });
    this.version(2).stores({
      documents: 'id, url, canonicalUrl, contentHash, contentType, createdAt, updatedAt, *tags, *topics, *entityIds',
      summaries: 'id, documentId, extractorId, providerId, model, mode, createdAt',
      extractedContents: 'id, url, canonicalUrl, contentHash, extractorId, contentType, createdAt',
      extractionLogs: 'id, url, extractorId, createdAt',
      mediaAssets: 'id, mediaHash, documentId, extractedContentId, type, mimeType, source, pageNumber, createdAt',
      knowledgeNodes: 'id, type, name, *aliases, *sourceDocumentIds',
      knowledgeEdges: 'id, from, to, type, sourceDocumentId'
    });
  }
}

export const db = new PageeDatabase();
