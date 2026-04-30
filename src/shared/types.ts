export type ProviderRegion = 'us' | 'cn' | 'global';

export type ProviderApiStyle = 'openai-compatible' | 'anthropic' | 'gemini' | 'custom-official';

export type UiLanguage = 'en' | 'zh';

export interface LLMProviderConfig {
  id: string;
  name: string;
  region: ProviderRegion;
  apiStyle: ProviderApiStyle;
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel?: string;
  discoveredModels?: LLMProviderDiscoveredModel[];
  modelsFetchedAt?: number;
  supportsStreaming: boolean;
  supportsJsonMode?: boolean;
  enabled: boolean;
}

export interface LLMProviderDiscoveredModel {
  id: string;
  label?: string;
  description?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: {
    vision?: boolean;
  };
  source: 'official-api';
}

export type SummaryMode = 'short' | 'medium' | 'long' | 'study' | 'research';

export type ContentType = 'article' | 'tweet-thread' | 'video' | 'pdf' | 'selection' | 'generic';

export type ContentBlockType = 'heading' | 'paragraph' | 'quote' | 'tweet' | 'caption' | 'code' | 'list' | 'table' | 'image';

export interface ContentBlock {
  id: string;
  type: ContentBlockType;
  text: string;
  source?: string;
  timestamp?: number;
  selector?: string;
}

export interface ContentMedia {
  id: string;
  assetId?: string;
  type: 'image';
  mimeType: string;
  url?: string;
  dataUrl?: string;
  source?: string;
  pageNumber?: number;
  description?: string;
  width?: number;
  height?: number;
}

export interface ExtractionQuality {
  score: number;
  textLength: number;
  duplicateRatio?: number;
  hasTitle: boolean;
  hasAuthor?: boolean;
  hasTimestamps?: boolean;
  warnings: string[];
}

export interface ExtractedContent {
  extractorId: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  author?: string;
  publishedAt?: string;
  siteName?: string;
  contentType: ContentType;
  text: string;
  blocks: ContentBlock[];
  media?: ContentMedia[];
  metadata: Record<string, unknown>;
  quality: ExtractionQuality;
}

export interface ExtractionContext {
  url: string;
  hostname: string;
  document: Document;
  selectionText?: string;
  language?: string;
}

export interface ContentExtractorPlugin {
  id: string;
  name: string;
  version: string;
  priority: number;
  contentTypes: ContentType[];
  matches(ctx: ExtractionContext): boolean | Promise<boolean>;
  extract(ctx: ExtractionContext): Promise<ExtractedContent>;
  validate?(content: ExtractedContent): ExtractionQuality;
}

export interface DeclarativeExtractionRule {
  id: string;
  version: string;
  matches: string[];
  contentType: ContentType;
  selectors: {
    title?: string;
    author?: string;
    publishedAt?: string;
    siteName?: string;
    content: string;
  };
  remove?: string[];
  blockSelectors?: Partial<Record<ContentBlockType, string>>;
}

export interface ExtractorRuntimeSettings {
  disabledExtractorIds: string[];
  priorities: Record<string, number>;
  declarativeRules: DeclarativeExtractionRule[];
}

export interface SummaryResult {
  tldr: string;
  bullets: string[];
  detailed?: string;
  keyClaims: string[];
  entities: string[];
  topics: string[];
  quotes: Array<{ text: string; sourceBlockId?: string; reason: string }>;
  actionItems?: string[];
  openQuestions?: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface SummaryPreferences {
  language: 'zh' | 'en' | 'bilingual';
  length: 'short' | 'medium' | 'long';
  style: 'technical' | 'plain' | 'business' | 'critical' | 'learning';
  defaultMode: SummaryMode;
}

export interface PrivacySettings {
  showApiDestinationBeforeRequest: boolean;
  saveExtractedText: boolean;
  saveSummaries: boolean;
}

export interface ExtractorSetting {
  enabled: boolean;
  priority?: number;
}

export interface UserSettings {
  uiLanguage: UiLanguage;
  activeProviderId?: string;
  providers: LLMProviderConfig[];
  summaryPreferences: SummaryPreferences;
  extractorSettings: Record<string, ExtractorSetting>;
  declarativeRules: DeclarativeExtractionRule[];
  privacy: PrivacySettings;
}

export interface ExtractorRunLog {
  id: string;
  url: string;
  extractorId: string;
  extractorName: string;
  quality: ExtractionQuality;
  candidateIds: string[];
  selected: boolean;
  error?: string;
  createdAt: number;
}

export interface DocumentMemory {
  id: string;
  url: string;
  canonicalUrl?: string;
  title: string;
  contentHash: string;
  contentType: string;
  extractedContentId: string;
  summaryIds: string[];
  tags: string[];
  topics: string[];
  entityIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SummaryVersion {
  id: string;
  documentId: string;
  extractorId: string;
  providerId: string;
  model: string;
  promptVersion: string;
  mode: SummaryMode;
  summary: SummaryResult;
  userEditedText?: string;
  feedback?: string[];
  createdAt: number;
}

export interface KnowledgeNode {
  id: string;
  type: 'concept' | 'person' | 'org' | 'project' | 'claim' | 'question';
  name: string;
  description?: string;
  aliases?: string[];
  sourceDocumentIds: string[];
  embedding?: number[];
}

export interface KnowledgeEdge {
  id: string;
  from: string;
  to: string;
  type: 'mentions' | 'supports' | 'contradicts' | 'extends' | 'similar_to' | 'part_of';
  evidence: string;
  sourceDocumentId: string;
}

export interface LibraryEntry {
  document: DocumentMemory;
  latestSummary?: SummaryVersion;
}

export interface SummaryTaskResult {
  content: ExtractedContent;
  document: DocumentMemory;
  summaryVersion: SummaryVersion;
  providerName: string;
}
