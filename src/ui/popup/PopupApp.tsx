import { useEffect, useState } from 'react';
import { RuntimeMessage, sendRuntimeMessage } from '../../shared/messages';
import type { SummaryTaskResult, UiLanguage } from '../../shared/types';
import { QualityBadge, SummaryView } from '../components/SummaryView';
import { t } from '../i18n';
import { getActiveTabTarget } from '../tab-target';

async function openSidePanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
}

export function PopupApp() {
  const [result, setResult] = useState<SummaryTaskResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [language, setLanguage] = useState<UiLanguage>('en');

  useEffect(() => {
    void sendRuntimeMessage({ type: RuntimeMessage.GetSettings })
      .then((settings) => setLanguage(settings.uiLanguage))
      .catch(() => undefined);
  }, []);

  async function summarize() {
    setLoading(true);
    setError(undefined);

    try {
      const target = await getActiveTabTarget();
      const response = await sendRuntimeMessage({ type: RuntimeMessage.SummarizeActiveTab, mode: 'short', ...target });
      setResult(response);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app popup stack">
      <section className="hero">
        <span className="eyebrow">Pagee</span>
        <h1>Summarize the current page into local memory.</h1>
        <p className="muted">{t(language, 'apiKeysLocal')}</p>
      </section>

      <div className="row wrap">
        <button disabled={loading} onClick={summarize}>
          {loading ? t(language, 'summarizing') : t(language, 'quickSummary')}
        </button>
        <button className="secondary" onClick={openSidePanel}>{t(language, 'openWorkspace')}</button>
      </div>

      <div className="row wrap">
        <button className="ghost" onClick={() => chrome.runtime.openOptionsPage()}>{t(language, 'options')}</button>
        <button className="ghost" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/knowledge/index.html') })}>
          {t(language, 'knowledge')}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {result && (
        <section className="stack">
          <div className="card stack">
            <div className="row between wrap">
              <h3>{result.document.title}</h3>
              <QualityBadge quality={result.content.quality} />
            </div>
            <p className="muted">Provider: {result.providerName}</p>
          </div>
          <SummaryView language={language} summary={result.summaryVersion.summary} />
        </section>
      )}
    </main>
  );
}
