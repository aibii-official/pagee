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
  GetSettings: 'pagee:get-settings',
  SaveSettings: 'pagee:save-settings',
  SummarizeActiveTab: 'pagee:summarize-active-tab',
  GetCurrentPageMemory: 'pagee:get-current-page-memory',
  ListLibrary: 'pagee:list-library',
  ClearLibrary: 'pagee:clear-library'
} as const;

export type RuntimeRequest =
  | { type: typeof RuntimeMessage.GetSettings }
  | { type: typeof RuntimeMessage.SaveSettings; settings: UserSettings }
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
    }
  | { type: typeof RuntimeMessage.GetCurrentPageMemory; tabId?: number; windowId?: number; url?: string }
  | { type: typeof RuntimeMessage.ListLibrary; query?: string }
  | { type: typeof RuntimeMessage.ClearLibrary };

export type ContentRequest = {
  type: typeof RuntimeMessage.ExtractContent;
  selectionText?: string;
  settings: ExtractorRuntimeSettings;
};

export interface ContentExtractionResponse {
  content: ExtractedContent;
  log: ExtractorRunLog;
}

export interface RuntimeResponseMap {
  [RuntimeMessage.GetSettings]: UserSettings;
  [RuntimeMessage.SaveSettings]: UserSettings;
  [RuntimeMessage.SummarizeActiveTab]: SummaryTaskResult;
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
