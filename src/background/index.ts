import { shouldAttemptVisionForProvider } from '../llm/model-registry';
import { discoverOfficialModels } from '../llm/model-discovery';
import { runExtractedContentSummary, selectSummaryProvider } from './summary-task-runner';
import {
  RuntimeMessage,
  type ContentExtractionResponse,
  type ContentRequest,
  type MessageEnvelope,
  type RuntimeRequest,
  type SummaryProgressStage
} from '../shared/messages';
import type {
  ContentMedia,
  ExtractedContent,
  LLMProviderConfig,
  SummaryMode,
  SummaryTaskResult,
  UserSettings
} from '../shared/types';
import { isFilePdfUrl, isHttpPageUrl, normalizeUrlForLookup } from '../shared/url';
import {
  clearLibrary,
  getLibraryEntryForUrl,
  listLibraryEntries,
  saveExtractionLog
} from '../storage/repositories';
import {
  ensureProviderPermission,
  getSettings,
  saveSettings,
  toExtractorRuntimeSettings
} from '../storage/settings';

interface TabTarget {
  tabId?: number;
  windowId?: number;
  url?: string;
}

const lastRegularTabByWindow = new Map<number, number>();

function publishSummaryProgress(
  taskId: string | undefined,
  stage: SummaryProgressStage,
  message: string,
  current?: number,
  total?: number
): void {
  if (!taskId) {
    return;
  }

  void chrome.runtime.sendMessage({
    type: RuntimeMessage.SummaryProgress,
    taskId,
    stage,
    message,
    current,
    total,
    updatedAt: Date.now()
  }).catch(() => undefined);
}

function rememberRegularTab(tab?: chrome.tabs.Tab): void {
  if (tab?.id && typeof tab.windowId === 'number' && isHttpPageUrl(tab.url)) {
    lastRegularTabByWindow.set(tab.windowId, tab.id);
  }
}

function isContentScriptConnectionError(error: unknown): boolean {
  const message = (error as Error).message;
  return message.includes('Receiving end does not exist') || message.includes('Could not establish connection');
}

function getContentScriptFiles(): string[] {
  return (chrome.runtime.getManifest().content_scripts ?? [])
    .flatMap((script) => script.js ?? [])
    .filter((file) => file.endsWith('.js'));
}

async function injectContentScript(tabId: number): Promise<void> {
  const files = getContentScriptFiles();

  if (files.length === 0) {
    throw new Error('Pagee content script bundle is missing from the extension manifest.');
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files
  });
}

async function sendExtractionRequest(tabId: number, request: ContentRequest): Promise<ContentExtractionResponse | { error?: string } | undefined> {
  return chrome.tabs.sendMessage(tabId, request) as Promise<ContentExtractionResponse | { error?: string } | undefined>;
}

async function getTabById(tabId?: number): Promise<chrome.tabs.Tab | undefined> {
  if (!tabId) {
    return undefined;
  }

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function getFallbackRegularTab(windowId?: number): Promise<chrome.tabs.Tab | undefined> {
  if (typeof windowId !== 'number') {
    return undefined;
  }

  const fallbackTabId = lastRegularTabByWindow.get(windowId);
  const fallbackTab = await getTabById(fallbackTabId);
  return isHttpPageUrl(fallbackTab?.url) ? fallbackTab : undefined;
}

async function getTargetTab(target: TabTarget = {}): Promise<chrome.tabs.Tab> {
  const explicitTab = await getTabById(target.tabId);
  const targetUrl = target.url || explicitTab?.url;
  const normalizedTargetUrl = normalizeUrlForLookup(targetUrl);

  if (explicitTab?.id && isHttpPageUrl(explicitTab.url)) {
    rememberRegularTab(explicitTab);
    return explicitTab;
  }

  if (isFilePdfUrl(explicitTab?.url ?? target.url)) {
    // PDF files are handled by the side panel file picker or direct PDF extraction
    // They don't go through the regular tab targeting flow
    throw new Error('This is a local PDF. Open the Pagee workspace and choose the PDF file to summarize it locally.');
  }

  const fallbackForExplicitWindow = await getFallbackRegularTab(target.windowId ?? explicitTab?.windowId);
  if (fallbackForExplicitWindow?.id) {
    return fallbackForExplicitWindow;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab?.id && isHttpPageUrl(tab.url)) {
    rememberRegularTab(tab);
    return tab;
  }

  if (isFilePdfUrl(tab?.url ?? target.url)) {
    throw new Error('This is a local PDF. Open the Pagee workspace and choose the PDF file to summarize it locally.');
  }

  const fallbackForCurrentWindow = await getFallbackRegularTab(target.windowId ?? tab?.windowId);
  if (fallbackForCurrentWindow?.id) {
    return fallbackForCurrentWindow;
  }

  const candidate = explicitTab ?? tab;
  if (!candidate?.id) {
    throw new Error('No active tab is available.');
  }

  if (!candidate.url) {
    return candidate;
  }

  throw new Error(`Pagee can only summarize regular http(s) pages directly. Current target: ${candidate.url}`);
}

async function extractActiveTab(target: TabTarget = {}, selectionText?: string): Promise<ExtractedContent> {
  const tab = await getTargetTab(target);
  const settings = await getSettings();
  const request: ContentRequest = {
    type: RuntimeMessage.ExtractContent,
    selectionText,
    settings: toExtractorRuntimeSettings(settings)
  };
  let response: ContentExtractionResponse | { error?: string } | undefined;

  const tabId = tab.id as number;

  try {
    response = await sendExtractionRequest(tabId, request);
  } catch (error) {
    if (isContentScriptConnectionError(error)) {
      try {
        await injectContentScript(tabId);
        response = await sendExtractionRequest(tabId, request);
      } catch (retryError) {
        throw new Error(
          `Pagee could not inject into the target page automatically. Click the Pagee toolbar button on this page or reload it once. ${
            (retryError as Error).message
          }`
        );
      }
    } else {
      throw error;
    }
  }

  if (!response) {
    throw new Error('Content extraction did not return a response. Reload the page and try again.');
  }

  if ('error' in response && response.error) {
    throw new Error(response.error);
  }

  if (!('content' in response) || !('log' in response)) {
    throw new Error('Content extraction returned an invalid response.');
  }

  await saveExtractionLog(response.log);
  return response.content;
}

async function attachVisibleTabScreenshot(
  content: ExtractedContent,
  tab: chrome.tabs.Tab,
  provider: LLMProviderConfig
): Promise<ExtractedContent> {
  if (!tab.windowId || content.contentType === 'selection' || content.contentType === 'pdf') {
    return content;
  }

  // Only capture screenshot if the model explicitly supports vision
  // This avoids sending images to text-only models and relying on error fallback
  if (!shouldAttemptVisionForProvider(provider, provider.chatModel)) {
    return content;
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    const media: ContentMedia = {
      id: 'visible-page-screenshot',
      type: 'image',
      mimeType: 'image/jpeg',
      dataUrl,
      source: 'Visible viewport screenshot',
      description: 'Screenshot of the currently visible part of the page at summary time.'
    };

    return {
      ...content,
      media: [...(content.media ?? []), media],
      metadata: {
        ...content.metadata,
        capturedVisibleViewport: true
      },
      quality: {
        ...content.quality,
        warnings: [...content.quality.warnings, 'A visible viewport screenshot is available for the selected vision-capable model.']
      }
    };
  } catch {
    return content;
  }
}

async function summarizeExtractedContent(
  content: ExtractedContent,
  mode: SummaryMode,
  feedback?: string[],
  providerId?: string,
  chatModel?: string,
  taskId?: string
): Promise<SummaryTaskResult> {
  return runExtractedContentSummary({
    content,
    mode,
    feedback,
    providerId,
    chatModel,
    publishProgress: (stage, message, current, total) => publishSummaryProgress(taskId, stage, message, current, total)
  });
}

async function summarizeActiveTab(
  mode: SummaryMode,
  feedback?: string[],
  selectionText?: string,
  target: TabTarget = {},
  providerId?: string,
  chatModel?: string,
  taskId?: string
): Promise<SummaryTaskResult> {
  publishSummaryProgress(taskId, 'extracting', 'Reading current page');
  const tab = await getTargetTab(target);
  const settings = await getSettings();
  const provider = selectSummaryProvider(settings, providerId, chatModel);
  const content = await extractActiveTab({ tabId: tab.id, windowId: tab.windowId, url: tab.url }, selectionText);
  const contentWithMedia = await attachVisibleTabScreenshot(content, tab, provider);
  const mediaCount = contentWithMedia.media?.length ?? 0;
  if (mediaCount > 0) {
    publishSummaryProgress(
      taskId,
      'preparing',
      shouldAttemptVisionForProvider(provider, provider.chatModel)
        ? `Prepared ${mediaCount} visual attachment${mediaCount === 1 ? '' : 's'} for ${provider.chatModel}`
        : `Found ${mediaCount} visual attachment${mediaCount === 1 ? '' : 's'}, but ${provider.chatModel} is marked text-only by provider metadata`
    );
  }
  return summarizeExtractedContent(contentWithMedia, mode, feedback, providerId, chatModel, taskId);
}

async function getCurrentPageMemory(target: TabTarget = {}) {
  const targetUrl = target.url;
  if (isHttpPageUrl(targetUrl) || isFilePdfUrl(targetUrl)) {
    return getLibraryEntryForUrl(targetUrl as string);
  }

  const tab = await getTabById(target.tabId);
  if (isHttpPageUrl(tab?.url) || isFilePdfUrl(tab?.url)) {
    return getLibraryEntryForUrl(tab?.url as string);
  }

  return undefined;
}

async function refreshProviderModels(providerId: string): Promise<UserSettings> {
  const settings = await getSettings();
  const provider = settings.providers.find((candidate) => candidate.id === providerId);

  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  await ensureProviderPermission(provider);
  const discoveredModels = await discoverOfficialModels(provider);
  const nextSettings: UserSettings = {
    ...settings,
    providers: settings.providers.map((candidate) =>
      candidate.id === providerId
        ? {
            ...candidate,
            discoveredModels,
            modelsFetchedAt: Date.now(),
            chatModel: discoveredModels.some((model) => model.id === candidate.chatModel) ? candidate.chatModel : discoveredModels[0]?.id ?? candidate.chatModel
          }
        : candidate
    )
  };

  return saveSettings(nextSettings);
}

async function handleRuntimeMessage(message: RuntimeRequest): Promise<unknown> {
  switch (message.type) {
    case RuntimeMessage.GetSettings:
      return getSettings();
    case RuntimeMessage.SaveSettings:
      return saveSettings(message.settings);
    case RuntimeMessage.RefreshProviderModels:
      return refreshProviderModels(message.providerId);
    case RuntimeMessage.SummarizeActiveTab:
      return summarizeActiveTab(message.mode, message.feedback, message.selectionText, {
        tabId: message.tabId,
        windowId: message.windowId,
        url: message.url
      }, message.providerId, message.chatModel, message.taskId);
    case RuntimeMessage.SummarizeExtractedContent:
      return summarizeExtractedContent(message.content, message.mode, message.feedback, message.providerId, message.chatModel, message.taskId);
    case RuntimeMessage.PageStateChanged:
      return { received: true };
    case RuntimeMessage.SummaryProgress:
      return { received: true };
    case RuntimeMessage.GetCurrentPageMemory:
      return getCurrentPageMemory({ tabId: message.tabId, windowId: message.windowId, url: message.url });
    case RuntimeMessage.ListLibrary:
      return listLibraryEntries(message.query);
    case RuntimeMessage.ClearLibrary:
      await clearLibrary();
      return { cleared: true };
    default:
      throw new Error('Unsupported Pagee runtime message.');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'pagee-summarize-selection',
    title: 'Summarize selected text with Pagee',
    contexts: ['selection']
  });

  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'pagee-summarize-selection') {
    return;
  }

  if (tab?.windowId) {
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  }

  void summarizeActiveTab('short', undefined, info.selectionText, { tabId: tab?.id, windowId: tab?.windowId }).catch((error) => {
    console.error('[Pagee] Selection summary failed', error);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void getTabById(activeInfo.tabId).then(rememberRegularTab);
});

chrome.tabs.onUpdated.addListener((_tabId, _changeInfo, tab) => {
  if (tab.active) {
    rememberRegularTab(tab);
  }
});

chrome.runtime.onMessage.addListener((message: RuntimeRequest, _sender, sendResponse) => {
  void handleRuntimeMessage(message)
    .then((data) => {
      sendResponse({ ok: true, data } satisfies MessageEnvelope<unknown>);
    })
    .catch((error) => {
      sendResponse({ ok: false, error: (error as Error).message } satisfies MessageEnvelope<unknown>);
    });

  return true;
});
