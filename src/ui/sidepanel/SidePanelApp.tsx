import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { extractPdfFile, extractPdfUrl } from '../../extractors/plugins/pdf-file';
import { formatModelParameters, getModelOptionForProvider, getModelOptionsForProvider } from '../../llm/model-registry';
import { RuntimeMessage, sendRuntimeMessage, type SummaryProgressUpdate } from '../../shared/messages';
import type { ExtractedContent, LibraryEntry, SummaryMode, SummaryTaskResult, UiLanguage, UserSettings } from '../../shared/types';
import { isFilePdfUrl, isHttpPageUrl, isPdfLikeUrl, normalizeUrlForLookup, urlsMatchForLookup } from '../../shared/url';
import { QualityBadge, SummaryView } from '../components/SummaryView';
import { t } from '../i18n';
import { type ActiveTabTarget, getActiveTabTarget, getActiveTabTargetForWindow, getLiveTabTarget, targetFromTab } from '../tab-target';
import { formatDate } from '../utils';

function getModes(language: UiLanguage): Array<{ id: SummaryMode; label: string; description: string }> {
  return [
    { id: 'short', label: t(language, 'modeShort'), description: t(language, 'modeShort') + ' - ' + t(language, 'shorter') },
    { id: 'medium', label: t(language, 'modeMedium'), description: t(language, 'modeMedium') + ' - ' + t(language, 'detailedSummary') },
    { id: 'long', label: t(language, 'modeLong'), description: t(language, 'modeLong') + ' - ' + t(language, 'moreDetailed') },
    { id: 'study', label: t(language, 'modeStudy'), description: t(language, 'modeStudy') + ' - ' + t(language, 'moreTechnical') },
    { id: 'research', label: t(language, 'modeResearch'), description: t(language, 'modeResearch') + ' - ' + t(language, 'simpler') }
  ];
}

interface PendingSummaryTask {
  id: string;
  pageKey: string;
  title?: string;
  url?: string;
  mode: SummaryMode;
  providerName?: string;
  model?: string;
  startedAt: number;
  progress?: SummaryProgressUpdate;
}

interface BackgroundSummaryNotice {
  id: string;
  result: SummaryTaskResult;
  completedAt: number;
}

interface SummaryRunConfig {
  mode: SummaryMode;
  providerId?: string;
  providerName?: string;
  chatModel: string;
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

function openKnowledgePage() {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/knowledge/index.html') });
}

function contentCoverageText(content: ExtractedContent): string {
  const media = content.media ?? [];
  const inlineMedia = media.filter((item) => Boolean(item.dataUrl)).length;
  const parts = [`${content.blocks.length} text block${content.blocks.length === 1 ? '' : 's'}`];

  if (typeof content.metadata.pageCount === 'number') {
    parts.push(`${content.metadata.pageCount} PDF page${content.metadata.pageCount === 1 ? '' : 's'}`);
  }

  if (media.length > 0) {
    parts.push(`${media.length} media attachment${media.length === 1 ? '' : 's'} (${inlineMedia} embedded)`);
  }

  if (typeof content.metadata.pageMediaCoverage === 'string') {
    parts.push(`media coverage: ${content.metadata.pageMediaCoverage}`);
  }

  if (content.metadata.capturedVisibleViewport) {
    parts.push('viewport screenshot included');
  }

  return parts.join(' · ');
}

export function SidePanelApp() {
  const [mode, setMode] = useState<SummaryMode>('medium');
  const [settings, setSettings] = useState<UserSettings>();
  const [language, setLanguage] = useState<UiLanguage>('en');
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [chatModel, setChatModel] = useState('');
  const [currentPage, setCurrentPage] = useState<ActiveTabTarget>();
  const currentPageRef = useRef<ActiveTabTarget>();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const refreshSeqRef = useRef(0);
  const [task, setTask] = useState<SummaryTaskResult>();
  const [memory, setMemory] = useState<LibraryEntry>();
  const [pendingTasks, setPendingTasks] = useState<PendingSummaryTask[]>([]);
  const [backgroundResults, setBackgroundResults] = useState<BackgroundSummaryNotice[]>([]);
  const backgroundResultsRef = useRef<BackgroundSummaryNotice[]>([]);
  const [pdfImporting, setPdfImporting] = useState(false);
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

  function updatePendingTaskProgress(progress: SummaryProgressUpdate) {
    setPendingTasks((items) => items.map((item) => (item.id === progress.taskId ? { ...item, progress } : item)));
  }

  function dismissBackgroundResult(id: string) {
    setBackgroundResultItems((items) => items.filter((item) => item.id !== id));
  }

  function dismissAllBackgroundResults() {
    setBackgroundResultItems(() => []);
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
    const target = explicitTarget ? await getLiveTabTarget(explicitTarget) : await getActiveTabTarget();
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

    const pollTimer = window.setInterval(() => refreshForTabChange(), 1000);

    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.windows.onFocusChanged.removeListener(handleWindowFocus);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(handleHistoryStateUpdated);
      window.clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    const handleRuntimeMessage = (message: { type?: string; url?: string; title?: string } | SummaryProgressUpdate, sender: chrome.runtime.MessageSender) => {
      if (message.type === RuntimeMessage.SummaryProgress) {
        updatePendingTaskProgress(message as SummaryProgressUpdate);
        return false;
      }

      const tab = sender.tab;
      if (message.type !== RuntimeMessage.PageStateChanged || !tab?.id || tab.id !== currentPageRef.current?.tabId) {
        return false;
      }

      void refreshPageMemory(true, {
        tabId: tab.id,
        windowId: tab.windowId,
        url: message.url,
        title: message.title
      });

      return false;
    };

    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  }, []);

  useEffect(() => {
    const match = backgroundResults.find((notice) => resultMatchesPage(notice.result, currentPage));
    if (match) {
      if (!memory) {
        setMemory({ document: match.result.document, latestSummary: match.result.summaryVersion });
      }
      setBackgroundResultItems((items) => items.filter((item) => item.id !== match.id));
    }
  }, [backgroundResults, currentPage, memory]);

  const enabledProviders = settings?.providers.filter((provider) => provider.enabled) ?? [];
  const selectedProvider = enabledProviders.find((provider) => provider.id === selectedProviderId) ?? enabledProviders[0];
  const modelOptions = getModelOptionsForProvider(selectedProvider);
  const selectedModel = selectedProvider ? getModelOptionForProvider(selectedProvider, chatModel || selectedProvider.chatModel) : undefined;
  const currentPageKey = pageKey(currentPage);
  const currentPagePending = pendingTasks.some((pendingTask) => pendingTask.pageKey === currentPageKey);
  const currentPagePendingTasks = pendingTasks.filter((pendingTask) => pendingTask.pageKey === currentPageKey);
  const backgroundPendingTasks = pendingTasks.filter((pendingTask) => pendingTask.pageKey !== currentPageKey);
  const taskMatchesCurrentPage = Boolean(task && resultMatchesPage(task, currentPage));
  const memoryMatchesCurrentPage = memoryMatchesPage(memory, currentPage);
  const currentPageIsPdf = isPdfLikeUrl(currentPage?.url);
  const currentPageIsSupportedTarget = isHttpPageUrl(currentPage?.url) || currentPageIsPdf;
  const pdfExtractorEnabled = settings?.extractorSettings['pdf-file']?.enabled ?? true;

  function currentRunConfig(): SummaryRunConfig {
    return {
      mode,
      providerId: selectedProvider?.id,
      providerName: selectedProvider?.name,
      chatModel: chatModel || selectedProvider?.chatModel || ''
    };
  }

  async function updateUiLanguage(nextLanguage: UiLanguage) {
    setLanguage(nextLanguage);
    if (!settings) return;

    const nextSettings = { ...settings, uiLanguage: nextLanguage };
    setSettings(nextSettings);
    await sendRuntimeMessage({ type: RuntimeMessage.SaveSettings, settings: nextSettings });
  }

  async function refreshSelectedProviderModels() {
    if (!selectedProvider) return;
    setError(undefined);

    try {
      const saved = await sendRuntimeMessage({ type: RuntimeMessage.RefreshProviderModels, providerId: selectedProvider.id });
      setSettings(saved);
      const refreshed = saved.providers.find((provider) => provider.id === selectedProvider.id);
      setChatModel(refreshed?.chatModel ?? '');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function summarize(feedback?: string[]) {
    setError(undefined);
    const runConfig = currentRunConfig();
    const target = await getActiveTabTarget();
    const taskId = crypto.randomUUID();
    const taskPageKey = pageKey(target);
    const pendingTask: PendingSummaryTask = {
      id: taskId,
      pageKey: taskPageKey,
      title: target.title,
      url: target.url,
      mode: runConfig.mode,
      providerName: runConfig.providerName,
      model: runConfig.chatModel,
      startedAt: Date.now()
    };

    setCurrentPageTarget(target);
    setPendingTasks((items) => [...items, pendingTask]);

    try {
      const response = await sendRuntimeMessage({
        type: RuntimeMessage.SummarizeActiveTab,
        mode: runConfig.mode,
        feedback,
        providerId: runConfig.providerId,
        chatModel: runConfig.chatModel,
        taskId,
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

  async function summarizeContent(content: ExtractedContent, target: ActiveTabTarget, feedback?: string[], runConfig = currentRunConfig()) {
    setError(undefined);
    const taskId = crypto.randomUUID();
    const taskPageKey = pageKey(target);
    const pendingTask: PendingSummaryTask = {
      id: taskId,
      pageKey: taskPageKey,
      title: target.title || content.title,
      url: target.url || content.url,
      mode: runConfig.mode,
      providerName: runConfig.providerName,
      model: runConfig.chatModel,
      startedAt: Date.now()
    };

    setCurrentPageTarget(target);
    setPendingTasks((items) => [...items, pendingTask]);

    try {
      const response = await sendRuntimeMessage({
        type: RuntimeMessage.SummarizeExtractedContent,
        content,
        mode: runConfig.mode,
        feedback,
        providerId: runConfig.providerId,
        chatModel: runConfig.chatModel,
        taskId
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

  async function summarizePdfFile(file: File, feedback?: string[], runConfig = currentRunConfig()) {
    const activeTarget = await getActiveTabTarget();
    const sourceUrl = isPdfLikeUrl(activeTarget.url) ? activeTarget.url : undefined;

    setError(undefined);
    setPdfImporting(true);
    setCurrentPageTarget(activeTarget);

    try {
      const content = await extractPdfFile({ file, sourceUrl });
      await summarizeContent(content, {
        ...activeTarget,
        title: activeTarget.title || content.title,
        url: content.url
      }, feedback, runConfig);
    } catch (err) {
      if (pageKey(currentPageRef.current) === pageKey(activeTarget)) {
        setError((err as Error).message);
      }
    } finally {
      setPdfImporting(false);
    }
  }

  async function ensureCurrentPdfUrlPermission(url: string) {
    if (!isFilePdfUrl(url)) {
      return;
    }

    const fileOrigin = 'file:///*';
    const hasPermission = await chrome.permissions.contains({ origins: [fileOrigin] }).catch(() => false);
    if (hasPermission) {
      return;
    }

    const granted = await chrome.permissions.request({ origins: [fileOrigin] }).catch(() => false);
    if (!granted) {
      throw new Error('Chrome did not grant direct file URL access. Use Choose PDF as the fallback.');
    }
  }

  async function summarizeCurrentPdf(feedback?: string[]) {
    const runConfig = currentRunConfig();
    const activeTarget = await getActiveTabTarget();

    if (!activeTarget.url || !isPdfLikeUrl(activeTarget.url)) {
      setError('The current tab is not a PDF URL. Use Choose PDF to import a local file.');
      return;
    }

    setError(undefined);
    setPdfImporting(true);
    setCurrentPageTarget(activeTarget);

    try {
      await ensureCurrentPdfUrlPermission(activeTarget.url);
      const content = await extractPdfUrl(activeTarget.url, activeTarget.title);
      await summarizeContent(content, {
        ...activeTarget,
        title: activeTarget.title || content.title,
        url: content.url
      }, feedback, runConfig);
    } catch (err) {
      if (pageKey(currentPageRef.current) === pageKey(activeTarget)) {
        setError(`${t(language, 'directPdfReadFailed')} ${(err as Error).message}`);
      }
    } finally {
      setPdfImporting(false);
    }
  }

  function choosePdfFile() {
    pdfInputRef.current?.click();
  }

  function handlePdfFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';

    if (file) {
      void summarizePdfFile(file, undefined, currentRunConfig());
    }
  }

  function summarizeCurrentSummary(feedback: string[]) {
    if (currentPageIsPdf && taskMatchesCurrentPage && task?.content.contentType === 'pdf') {
      void summarizeContent(task.content, currentPage ?? { title: task.document.title, url: task.document.url }, feedback, currentRunConfig());
      return;
    }

    if (currentPageIsPdf) {
      void summarizeCurrentPdf(feedback);
      return;
    }

    void summarize(feedback);
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
        <div className="row wrap">
          <button className="secondary" onClick={openKnowledgePage}>{t(language, 'openKnowledge')}</button>
          <button className="ghost" onClick={() => chrome.runtime.openOptionsPage()}>{t(language, 'options')}</button>
        </div>
      </section>

      {currentPageIsSupportedTarget && currentPage?.url && (
        <section className="card stack current-page-card">
          <span className="eyebrow">{currentPageIsPdf ? t(language, 'pdfTarget') : 'Current page'}</span>
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
            <p className="muted">Model parameters: {formatModelParameters(selectedModel)}</p>
          </div>
        )}
        <p className="muted">{t(language, 'modelOverrideHint')}</p>
        {selectedProvider && (
          <div className="row wrap">
            <button className="ghost" onClick={() => void refreshSelectedProviderModels()}>Refresh official models</button>
            {selectedProvider.modelsFetchedAt && <span className="pill good">Models refreshed</span>}
          </div>
        )}
        {currentPageIsPdf && <p className="muted">{t(language, 'pdfHint')}</p>}
        <div className="field">
          <label htmlFor="mode">{t(language, 'summaryMode')}</label>
          <select id="mode" value={mode} onChange={(event) => setMode(event.target.value as SummaryMode)}>
            {getModes(language).map((item) => (
              <option key={item.id} value={item.id} title={item.description}>
                {item.label}
              </option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: '4px' }}>
            {getModes(language).find((m) => m.id === mode)?.description}
          </p>
        </div>
        <div className="row wrap">
          {currentPageIsPdf ? (
            <>
              <input accept="application/pdf,.pdf" hidden ref={pdfInputRef} type="file" onChange={handlePdfFileChange} />
              <button disabled={!pdfExtractorEnabled || currentPagePending || pdfImporting || enabledProviders.length === 0} onClick={() => void summarizeCurrentPdf()}>
                {pdfImporting ? t(language, 'extractingPdf') : currentPagePending ? t(language, 'summarizing') : t(language, 'summarizePdf')}
              </button>
              <button className="secondary" disabled={!pdfExtractorEnabled || currentPagePending || pdfImporting || enabledProviders.length === 0} onClick={choosePdfFile}>
                {t(language, 'choosePdf')}
              </button>
            </>
          ) : (
            <button disabled={currentPagePending || enabledProviders.length === 0} onClick={() => summarize()}>
              {currentPagePending ? t(language, 'summarizing') : t(language, 'summarizeActivePage')}
            </button>
          )}
          <button className="secondary" onClick={openKnowledgePage}>{t(language, 'openKnowledge')}</button>
          <button className="secondary" onClick={() => chrome.runtime.openOptionsPage()}>{t(language, 'configureApi')}</button>
        </div>
      </section>

      {currentPagePendingTasks.length > 0 && (
        <section className="card stack background-task-card">
          <div className="row between wrap">
            <h3>Current page task</h3>
            <span className="pill warn">{currentPagePendingTasks.length} running</span>
          </div>
          {currentPagePendingTasks.map((pendingTask) => (
            <div className="list-item compact" key={pendingTask.id}>
              <p>{pendingTask.title || pendingTask.url || 'Summarizing page'}</p>
              <p className="muted">Mode: {getModes(language).find((m) => m.id === pendingTask.mode)?.label || pendingTask.mode} · {pendingTask.providerName ?? 'Provider'} · {pendingTask.model || 'model'}</p>
              <p className="muted">Started {formatDate(pendingTask.startedAt)}</p>
              {pendingTask.progress && (
                <p className="muted">
                  {pendingTask.progress.message}
                  {pendingTask.progress.total ? ` (${pendingTask.progress.current ?? 0}/${pendingTask.progress.total})` : ''}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {(backgroundPendingTasks.length > 0 || backgroundResults.length > 0) && (
        <details className="card stack background-task-card background-task-tray" open={backgroundPendingTasks.length > 0}>
          <summary>
            <span>Background tasks</span>
            <span className="pill">{backgroundPendingTasks.length} running · {backgroundResults.length} done</span>
          </summary>
          {backgroundPendingTasks.map((pendingTask) => (
            <div className="list-item compact" key={pendingTask.id}>
              <strong>{pendingTask.title || pendingTask.url || 'Summary running in background'}</strong>
              <p className="muted">Mode: {getModes(language).find((m) => m.id === pendingTask.mode)?.label || pendingTask.mode} · {pendingTask.providerName ?? 'Provider'} · {pendingTask.model || 'model'}</p>
              {pendingTask.progress && (
                <p className="muted">
                  {pendingTask.progress.message}
                  {pendingTask.progress.total ? ` (${pendingTask.progress.current ?? 0}/${pendingTask.progress.total})` : ''}
                </p>
              )}
            </div>
          ))}
          {backgroundResults.length > 0 && (
            <div className="row between wrap">
              <span className="pill good">Completed summaries</span>
              <button className="ghost" onClick={dismissAllBackgroundResults}>Dismiss all</button>
            </div>
          )}
          {backgroundResults.map((notice) => (
            <div className="list-item compact" key={notice.id}>
              <div className="row between wrap">
                <strong>{notice.result.document.title}</strong>
                <button className="ghost" onClick={() => dismissBackgroundResult(notice.id)}>Dismiss</button>
              </div>
              <p className="muted">{notice.result.summaryVersion.summary.tldr}</p>
              <div className="row wrap">
                <button className="secondary" onClick={() => chrome.tabs.create({ url: notice.result.document.url })}>Open page</button>
                <button className="secondary" onClick={openKnowledgePage}>{t(language, 'openKnowledge')}</button>
              </div>
            </div>
          ))}
        </details>
      )}

      {error && <div className="error">{error}</div>}

      {taskMatchesCurrentPage && task && (
        <section className="card stack">
          <div className="row between wrap">
            <h3>{task.document.title}</h3>
            <QualityBadge quality={task.content.quality} />
          </div>
          <p className="muted">Extractor: {task.content.extractorId} · Provider: {task.providerName} · Model: {task.summaryVersion.model}</p>
          <p className="muted">Coverage: {contentCoverageText(task.content)}</p>
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
            <button className="ghost" disabled={currentPagePending} onClick={() => summarizeCurrentSummary([t(language, 'shorter')])}>{t(language, 'shorter')}</button>
            <button className="ghost" disabled={currentPagePending} onClick={() => summarizeCurrentSummary([t(language, 'moreDetailed')])}>{t(language, 'moreDetailed')}</button>
            <button className="ghost" disabled={currentPagePending} onClick={() => summarizeCurrentSummary([t(language, 'moreTechnical')])}>{t(language, 'moreTechnical')}</button>
            <button className="ghost" disabled={currentPagePending} onClick={() => summarizeCurrentSummary([t(language, 'simpler')])}>{t(language, 'simpler')}</button>
          </div>
          <SummaryView language={language} summary={currentSummary} />
        </>
      )}
    </main>
  );
}
