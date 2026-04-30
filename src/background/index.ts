import { summarizeWithProvider } from '../llm/providers';
import { getModelOption } from '../llm/model-catalog';
import { createId, sha256 } from '../shared/hash';
import {
  RuntimeMessage,
  type ContentExtractionResponse,
  type ContentRequest,
  type MessageEnvelope,
  type RuntimeRequest
} from '../shared/messages';
import type {
  DocumentMemory,
  ExtractedContent,
  LLMProviderConfig,
  SummaryMode,
  SummaryTaskResult,
  SummaryVersion,
  UserSettings
} from '../shared/types';
import {
  clearLibrary,
  getLibraryEntryForUrl,
  listLibraryEntries,
  saveExtractionLog,
  saveSummarySnapshot
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

function isRegularPageUrl(url?: string): boolean {
  return Boolean(url?.startsWith('http://') || url?.startsWith('https://'));
}

function rememberRegularTab(tab?: chrome.tabs.Tab): void {
  if (tab?.id && typeof tab.windowId === 'number' && isRegularPageUrl(tab.url)) {
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
  return isRegularPageUrl(fallbackTab?.url) ? fallbackTab : undefined;
}

async function getTargetTab(target: TabTarget = {}): Promise<chrome.tabs.Tab> {
  const explicitTab = await getTabById(target.tabId);
  if (explicitTab?.id && isRegularPageUrl(explicitTab.url)) {
    rememberRegularTab(explicitTab);
    return explicitTab;
  }

  const fallbackForExplicitWindow = await getFallbackRegularTab(target.windowId ?? explicitTab?.windowId);
  if (fallbackForExplicitWindow?.id) {
    return fallbackForExplicitWindow;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab?.id && isRegularPageUrl(tab.url)) {
    rememberRegularTab(tab);
    return tab;
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

  throw new Error(`Pagee can only summarize regular http(s) pages. Current target: ${candidate.url}`);
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

function selectProvider(settings: UserSettings, providerId?: string, chatModel?: string): LLMProviderConfig {
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

  const selectedModel = getModelOption(provider.id, chatModel?.trim() || provider.chatModel);
  if (!selectedModel) {
    throw new Error(`${provider.name} has no supported model in Pagee's model catalog.`);
  }

  return { ...provider, chatModel: selectedModel.id };
}

async function createTransientSnapshot(
  content: ExtractedContent,
  mode: SummaryMode,
  summaryVersion: Omit<SummaryVersion, 'id' | 'documentId' | 'createdAt'>
): Promise<{ document: DocumentMemory; summaryVersion: SummaryVersion }> {
  const now = Date.now();
  const contentHash = await sha256(content.text);
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

async function summarizeActiveTab(
  mode: SummaryMode,
  feedback?: string[],
  selectionText?: string,
  target: TabTarget = {},
  providerId?: string,
  chatModel?: string
): Promise<SummaryTaskResult> {
  const settings = await getSettings();
  const provider = selectProvider(settings, providerId, chatModel);
  await ensureProviderPermission(provider);
  const content = await extractActiveTab(target, selectionText);
  const summary = await summarizeWithProvider(provider, content, mode, settings.summaryPreferences, feedback);

  const stored = settings.privacy.saveSummaries
    ? await saveSummarySnapshot({
        content,
        summary,
        provider,
        mode,
        feedback,
        saveExtractedText: settings.privacy.saveExtractedText
      })
    : await createTransientSnapshot(content, mode, {
        extractorId: content.extractorId,
        providerId: provider.id,
        model: provider.chatModel,
        promptVersion: 'summary-json-v1',
        mode,
        summary,
        feedback
      });

  return {
    content,
    document: stored.document,
    summaryVersion: stored.summaryVersion,
    providerName: provider.name
  };
}

async function getCurrentPageMemory(target: TabTarget = {}) {
  if (isRegularPageUrl(target.url)) {
    return getLibraryEntryForUrl(target.url as string);
  }

  const tab = await getTabById(target.tabId);
  if (isRegularPageUrl(tab?.url)) {
    return getLibraryEntryForUrl(tab?.url as string);
  }

  return undefined;
}

async function handleRuntimeMessage(message: RuntimeRequest): Promise<unknown> {
  switch (message.type) {
    case RuntimeMessage.GetSettings:
      return getSettings();
    case RuntimeMessage.SaveSettings:
      return saveSettings(message.settings);
    case RuntimeMessage.SummarizeActiveTab:
      return summarizeActiveTab(message.mode, message.feedback, message.selectionText, {
        tabId: message.tabId,
        windowId: message.windowId,
        url: message.url
      }, message.providerId, message.chatModel);
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
