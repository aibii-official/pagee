import { useEffect, useRef, useState } from 'react';
import { formatModelParameters, getModelOption, getModelOptions } from '../../llm/model-catalog';
import { RuntimeMessage, sendRuntimeMessage } from '../../shared/messages';
import type { LibraryEntry, SummaryMode, SummaryTaskResult, UiLanguage, UserSettings } from '../../shared/types';
import { normalizeUrlForLookup, urlsMatchForLookup } from '../../shared/url';
import { QualityBadge, SummaryView } from '../components/SummaryView';
import { t } from '../i18n';
import { type ActiveTabTarget, getActiveTabTarget, getActiveTabTargetForWindow, targetFromTab } from '../tab-target';
import { formatDate } from '../utils';

const MODES: Array<{ id: SummaryMode; label: string }> = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Standard' },
  { id: 'long', label: 'Deep' },
  { id: 'study', label: 'Study' },
  { id: 'research', label: 'Research' }
];

interface PendingSummaryTask {
  id: string;
  pageKey: string;
  title?: string;
  url?: string;
  startedAt: number;
}

interface BackgroundSummaryNotice {
  id: string;
  result: SummaryTaskResult;
  completedAt: number;
}

function pageKey(target?: ActiveTabTarget): string {
  return `${target?.tabId ?? 'unknown'}:${normalizeUrlForLookup(target?.url) ?? target?.url ?? ''}`;
}

function resultMatchesPage(result: SummaryTaskResult, target?: ActiveTabTarget): boolean {
  return urlsMatchForLookup(result.document.url, target?.url) || urlsMatchForLookup(result.document.canonicalUrl, target?.url);
}

function memoryMatchesPage(entry?: LibraryEntry, target?: ActiveTabTarget): boolean {
  return Boolean(entry && (urlsMatchForLookup(entry.document.url, target?.url) || urlsMatchForLookup(entry.document.canonicalUrl, target?.url)));
}

export function SidePanelApp() {
  const [mode, setMode] = useState<SummaryMode>('medium');
  const [settings, setSettings] = useState<UserSettings>();
  const [language, setLanguage] = useState<UiLanguage>('en');
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [chatModel, setChatModel] = useState('');
  const [currentPage, setCurrentPage] = useState<ActiveTabTarget>();
  const currentPageRef = useRef<ActiveTabTarget>();
  const refreshSeqRef = useRef(0);
  const [task, setTask] = useState<SummaryTaskResult>();
  const [memory, setMemory] = useState<LibraryEntry>();
  const [pendingTasks, setPendingTasks] = useState<PendingSummaryTask[]>([]);
  const [backgroundResults, setBackgroundResults] = useState<BackgroundSummaryNotice[]>([]);
  const backgroundResultsRef = useRef<BackgroundSummaryNotice[]>([]);
  const [error, setError] = useState<string>();

  function setCurrentPageTarget(target: ActiveTabTarget) {
    currentPageRef.current = target;
    setCurrentPage(target);
  }

  function setBackgroundResultItems(updater: (items: BackgroundSummaryNotice[]) => BackgroundSummaryNotice[]) {
    setBackgroundResults((items) => {
      const nextItems = updater(items);
      backgroundResultsRef.current = nextItems;
      return nextItems;
    });
  }

  async function refreshSettings() {
    const loadedSettings = await sendRuntimeMessage({ type: RuntimeMessage.GetSettings });
    const enabled = loadedSettings.providers.filter((provider) => provider.enabled);
    const provider =
      enabled.find((candidate) => candidate.id === selectedProviderId) ??
      enabled.find((candidate) => candidate.id === loadedSettings.activeProviderId) ??
      enabled[0];

    setSettings(loadedSettings);
    setLanguage(loadedSettings.uiLanguage);
    setMode(loadedSettings.summaryPreferences.defaultMode);
    setSelectedProviderId(provider?.id);
    setChatModel(provider?.chatModel ?? '');
  }

  async function refreshPageMemory(clearCurrentSummary = true, explicitTarget?: ActiveTabTarget) {
    const seq = ++refreshSeqRef.current;
    const target = explicitTarget ?? (await getActiveTabTarget());
    const previousPageKey = pageKey(currentPageRef.current);
    const nextPageKey = pageKey(target);
    setCurrentPageTarget(target);

    if (clearCurrentSummary && previousPageKey !== nextPageKey) {
      setTask(undefined);
      setError(undefined);
    }

    let nextMemory: LibraryEntry | undefined;

    try {
      const entry = await sendRuntimeMessage({ type: RuntimeMessage.GetCurrentPageMemory, ...target });
      const backgroundMatch = backgroundResultsRef.current.find((notice) => resultMatchesPage(notice.result, target));
      nextMemory = entry ?? (backgroundMatch ? { document: backgroundMatch.result.document, latestSummary: backgroundMatch.result.summaryVersion } : undefined);
    } catch {
      const backgroundMatch = backgroundResultsRef.current.find((notice) => resultMatchesPage(notice.result, target));
      nextMemory = backgroundMatch ? { document: backgroundMatch.result.document, latestSummary: backgroundMatch.result.summaryVersion } : undefined;
    }

    if (seq === refreshSeqRef.current && pageKey(currentPageRef.current) === nextPageKey) {
      setMemory(nextMemory);
    }
  }

  useEffect(() => {
    void refreshSettings();
    void refreshPageMemory(false);
  }, []);

  useEffect(() => {
    const handleStorageChange = (_changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local') {
        void refreshSettings();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [selectedProviderId]);

  useEffect(() => {
    const refreshForTabChange = (target?: ActiveTabTarget) => {
      void refreshPageMemory(true, target);
    };
    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      void chrome.tabs.get(activeInfo.tabId).then((tab) => refreshForTabChange(targetFromTab(tab))).catch(() => refreshForTabChange());
    };
    const handleUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
        refreshForTabChange(targetFromTab(tab));
      }
    };
    const handleWindowFocus = (windowId: number) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        void getActiveTabTargetForWindow(windowId).then((target) => refreshForTabChange(target)).catch(() => refreshForTabChange());
      }
    };
    const handleHistoryStateUpdated = (details: chrome.webNavigation.WebNavigationFramedCallbackDetails) => {
      if (details.frameId === 0) {
        void chrome.tabs.get(details.tabId).then((tab) => refreshForTabChange({ ...targetFromTab(tab), url: details.url })).catch(() => refreshForTabChange({ tabId: details.tabId, url: details.url }));
      }
    };

    chrome.tabs.onActivated.addListener(handleActivated);
    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.windows.onFocusChanged.addListener(handleWindowFocus);
    chrome.webNavigation.onHistoryStateUpdated.addListener(handleHistoryStateUpdated, { url: [{ schemes: ['http', 'https'] }] });

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(handleHistoryStateUpdated);
    };
  }, []);

  useEffect(() => {
    const match = backgroundResults.find((notice) => resultMatchesPage(notice.result, currentPage));
    if (match && !memory) {
      setMemory({ document: match.result.document, latestSummary: match.result.summaryVersion });
    }
  }, [backgroundResults, currentPage, memory]);

  const enabledProviders = settings?.providers.filter((provider) => provider.enabled) ?? [];
  const selectedProvider = enabledProviders.find((provider) => provider.id === selectedProviderId) ?? enabledProviders[0];
  const modelOptions = getModelOptions(selectedProvider?.id);
  const selectedModel = selectedProvider ? getModelOption(selectedProvider.id, chatModel || selectedProvider.chatModel) : undefined;
  const currentPageKey = pageKey(currentPage);
  const currentPagePending = pendingTasks.some((pendingTask) => pendingTask.pageKey === currentPageKey);
  const taskMatchesCurrentPage = Boolean(task && resultMatchesPage(task, currentPage));
  const memoryMatchesCurrentPage = memoryMatchesPage(memory, currentPage);

  async function updateUiLanguage(nextLanguage: UiLanguage) {
    setLanguage(nextLanguage);
    if (!settings) return;

    const nextSettings = { ...settings, uiLanguage: nextLanguage };
    setSettings(nextSettings);
    await sendRuntimeMessage({ type: RuntimeMessage.SaveSettings, settings: nextSettings });
  }

  async function summarize(feedback?: string[]) {
    setError(undefined);
    const target = await getActiveTabTarget();
    const taskId = crypto.randomUUID();
    const taskPageKey = pageKey(target);
    const pendingTask: PendingSummaryTask = {
      id: taskId,
      pageKey: taskPageKey,
      title: target.title,
      url: target.url,
      startedAt: Date.now()
    };

    setCurrentPageTarget(target);
    setPendingTasks((items) => [...items, pendingTask]);

    try {
      const response = await sendRuntimeMessage({
        type: RuntimeMessage.SummarizeActiveTab,
        mode,
        feedback,
        providerId: selectedProvider?.id,
        chatModel,
        ...target
      });

      if (pageKey(currentPageRef.current) === taskPageKey) {
        setTask(response);
        setMemory({ document: response.document, latestSummary: response.summaryVersion });
      } else {
        setBackgroundResultItems((items) => [{ id: taskId, result: response, completedAt: Date.now() }, ...items].slice(0, 5));
      }
    } catch (err) {
      if (pageKey(currentPageRef.current) === taskPageKey) {
        setError((err as Error).message);
      }
    } finally {
      setPendingTasks((items) => items.filter((item) => item.id !== taskId));
    }
  }

  const currentSummary = taskMatchesCurrentPage ? task?.summaryVersion.summary : memoryMatchesCurrentPage ? memory?.latestSummary?.summary : undefined;

  return (
    <main className="app sidepanel stack">
      <section className="hero">
        <div className="row between wrap">
          <span className="eyebrow">{t(language, 'workspace')}</span>
          <select className="compact-select" value={language} onChange={(event) => void updateUiLanguage(event.target.value as UiLanguage)}>
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
        <h1>Page summary and memory</h1>
        <p className="muted">{t(language, 'apiKeysLocal')}</p>
      </section>

      {currentPage?.url?.startsWith('http') && (
        <section className="card stack current-page-card">
          <span className="eyebrow">Current page</span>
          <h3>{currentPage.title || currentPage.url}</h3>
          <p className="muted">{currentPage.url}</p>
        </section>
      )}

      <section className="card stack">
        {enabledProviders.length === 0 ? (
          <div className="stack">
            <span className="pill warn">{t(language, 'noEnabledProvider')}</span>
            <button className="secondary" onClick={() => chrome.runtime.openOptionsPage()}>
              {t(language, 'configureApi')}
            </button>
          </div>
        ) : (
          <div className="grid two">
            <div className="field">
              <label htmlFor="provider">{t(language, 'apiProvider')}</label>
              <select
                id="provider"
                value={selectedProvider?.id ?? ''}
                onChange={(event) => {
                  const provider = enabledProviders.find((candidate) => candidate.id === event.target.value);
                  setSelectedProviderId(provider?.id);
                  setChatModel(provider?.chatModel ?? '');
                }}
              >
                {enabledProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="model">{t(language, 'chatModel')}</label>
              <select id="model" value={selectedModel?.id ?? ''} onChange={(event) => setChatModel(event.target.value)}>
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {selectedModel && (
          <div className="model-card compact">
            <p className="muted">{selectedModel.description}</p>
            <p className="muted">Recommended: {formatModelParameters(selectedModel)}</p>
          </div>
        )}
        <p className="muted">{t(language, 'modelOverrideHint')}</p>
        <div className="field">
          <label htmlFor="mode">{t(language, 'summaryMode')}</label>
          <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as SummaryMode)}>
            {MODES.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
        </div>
        <div className="row wrap">
          <button disabled={currentPagePending || enabledProviders.length === 0} onClick={() => summarize()}>
            {currentPagePending ? t(language, 'summarizing') : t(language, 'summarizeActivePage')}
          </button>
          <button className="secondary" onClick={() => chrome.runtime.openOptionsPage()}>{t(language, 'configureApi')}</button>
        </div>
      </section>

      {(pendingTasks.length > 0 || backgroundResults.length > 0) && (
        <section className="card stack background-task-card">
          <div className="row between wrap">
            <h3>Background activity</h3>
            {pendingTasks.length > 0 && <span className="pill warn">{pendingTasks.length} running</span>}
          </div>
          {pendingTasks.map((pendingTask) => (
            <div className="list-item compact" key={pendingTask.id}>
              <p>{pendingTask.title || pendingTask.url || 'Summarizing page'}</p>
              <p className="muted">Started {formatDate(pendingTask.startedAt)}</p>
            </div>
          ))}
          {backgroundResults.map((notice) => (
            <div className="list-item compact" key={notice.id}>
              <div className="row between wrap">
                <div className="stack">
                  <span className="pill good">Completed in background</span>
                  <h3>{notice.result.document.title}</h3>
                  <p className="muted">{notice.result.document.url}</p>
                </div>
                <button className="secondary" onClick={() => chrome.tabs.create({ url: notice.result.document.url })}>Open page</button>
              </div>
              <p>{notice.result.summaryVersion.summary.tldr}</p>
            </div>
          ))}
        </section>
      )}

      {error && <div className="error">{error}</div>}

      {taskMatchesCurrentPage && task && (
        <section className="card stack">
          <div className="row between wrap">
            <h3>{task.document.title}</h3>
            <QualityBadge quality={task.content.quality} />
          </div>
          <p className="muted">Extractor: {task.content.extractorId} · Provider: {task.providerName} · Model: {task.summaryVersion.model}</p>
          {task.content.quality.warnings.length > 0 && <p className="muted">Warnings: {task.content.quality.warnings.join(' ')}</p>}
        </section>
      )}

      {!taskMatchesCurrentPage && memoryMatchesCurrentPage && memory?.latestSummary && (
        <section className="card stack">
          <span className="pill good">Saved memory</span>
          <h3>{memory.document.title}</h3>
          <p className="muted">Last summarized {formatDate(memory.latestSummary.createdAt)}</p>
        </section>
      )}

      {currentSummary && (
        <>
          <div className="row wrap">
            <button className="ghost" disabled={currentPagePending} onClick={() => summarize([t(language, 'shorter')])}>{t(language, 'shorter')}</button>
            <button className="ghost" disabled={currentPagePending} onClick={() => summarize([t(language, 'moreDetailed')])}>{t(language, 'moreDetailed')}</button>
            <button className="ghost" disabled={currentPagePending} onClick={() => summarize([t(language, 'moreTechnical')])}>{t(language, 'moreTechnical')}</button>
            <button className="ghost" disabled={currentPagePending} onClick={() => summarize([t(language, 'simpler')])}>{t(language, 'simpler')}</button>
          </div>
          <SummaryView language={language} summary={currentSummary} />
        </>
      )}
    </main>
  );
}
