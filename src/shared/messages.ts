import type {
  ExtractedContent,
  ExtractorRunLog,
  ExtractorRuntimeSettings,
  LibraryEntry,
  SummaryMode,
  SummaryTaskResult,
  UserSettings
} from './types';

export const RuntimeMessage = {
  ExtractContent: 'pagee:extract-content',
  GetPageState: 'pagee:get-page-state',
  PageStateChanged: 'pagee:page-state-changed',
  SummaryProgress: 'pagee:summary-progress',
  GetSettings: 'pagee:get-settings',
  SaveSettings: 'pagee:save-settings',
  RefreshProviderModels: 'pagee:refresh-provider-models',
  SummarizeActiveTab: 'pagee:summarize-active-tab',
  SummarizeExtractedContent: 'pagee:summarize-extracted-content',
  GetCurrentPageMemory: 'pagee:get-current-page-memory',
  ListLibrary: 'pagee:list-library',
  ClearLibrary: 'pagee:clear-library'
} as const;

export type RuntimeRequest =
  | { type: typeof RuntimeMessage.GetSettings }
  | { type: typeof RuntimeMessage.SaveSettings; settings: UserSettings }
  | { type: typeof RuntimeMessage.RefreshProviderModels; providerId: string }
  | {
      type: typeof RuntimeMessage.SummarizeActiveTab;
      mode: SummaryMode;
      feedback?: string[];
      selectionText?: string;
      tabId?: number;
      windowId?: number;
      url?: string;
      providerId?: string;
      chatModel?: string;
      taskId?: string;
    }
  | {
      type: typeof RuntimeMessage.SummarizeExtractedContent;
      content: ExtractedContent;
      mode: SummaryMode;
      feedback?: string[];
      providerId?: string;
      chatModel?: string;
      taskId?: string;
    }
  | { type: typeof RuntimeMessage.PageStateChanged; url: string; title: string; timestamp: number }
  | SummaryProgressUpdate
  | { type: typeof RuntimeMessage.GetCurrentPageMemory; tabId?: number; windowId?: number; url?: string }
  | { type: typeof RuntimeMessage.ListLibrary; query?: string }
  | { type: typeof RuntimeMessage.ClearLibrary };

export type ContentRequest =
  | {
      type: typeof RuntimeMessage.ExtractContent;
      selectionText?: string;
      settings: ExtractorRuntimeSettings;
    }
  | { type: typeof RuntimeMessage.GetPageState };

export interface PageStateSnapshot {
  url: string;
  title: string;
  timestamp: number;
}

export type SummaryProgressStage = 'preparing' | 'extracting' | 'chunking' | 'summarizing' | 'synthesizing' | 'saving' | 'complete';

export interface SummaryProgressUpdate {
  type: typeof RuntimeMessage.SummaryProgress;
  taskId: string;
  stage: SummaryProgressStage;
  message: string;
  current?: number;
  total?: number;
  updatedAt: number;
}

export interface ContentExtractionResponse {
  content: ExtractedContent;
  log: ExtractorRunLog;
}

export interface RuntimeResponseMap {
  [RuntimeMessage.GetSettings]: UserSettings;
  [RuntimeMessage.SaveSettings]: UserSettings;
  [RuntimeMessage.RefreshProviderModels]: UserSettings;
  [RuntimeMessage.SummarizeActiveTab]: SummaryTaskResult;
  [RuntimeMessage.SummarizeExtractedContent]: SummaryTaskResult;
  [RuntimeMessage.PageStateChanged]: { received: true };
  [RuntimeMessage.SummaryProgress]: { received: true };
  [RuntimeMessage.GetCurrentPageMemory]: LibraryEntry | undefined;
  [RuntimeMessage.ListLibrary]: LibraryEntry[];
  [RuntimeMessage.ClearLibrary]: { cleared: true };
}

export type RuntimeMessageType = keyof RuntimeResponseMap;

export interface MessageEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export async function sendRuntimeMessage<T extends RuntimeMessageType>(
  message: Extract<RuntimeRequest, { type: T }>
): Promise<RuntimeResponseMap[T]> {
  const response = (await chrome.runtime.sendMessage(message)) as MessageEnvelope<RuntimeResponseMap[T]> | undefined;

  if (!response) {
    throw new Error('No response from extension runtime.');
  }

  if (!response.ok) {
    throw new Error(response.error || 'Extension runtime request failed.');
  }

  return response.data as RuntimeResponseMap[T];
}
