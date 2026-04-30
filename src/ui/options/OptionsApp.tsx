import { useEffect, useMemo, useState } from 'react';
import { BUILT_IN_EXTRACTORS } from '../../extractors/catalog';
import { formatModelParameters, getModelOptionForProvider, getModelOptionsForProvider } from '../../llm/model-registry';
import { RuntimeMessage, sendRuntimeMessage } from '../../shared/messages';
import type { DeclarativeExtractionRule, LLMProviderConfig, SummaryPreferences, UiLanguage, UserSettings } from '../../shared/types';
import { getProviderOriginPattern } from '../../storage/settings';
import { t } from '../i18n';

function updateProvider(settings: UserSettings, providerId: string, patch: Partial<LLMProviderConfig>): UserSettings {
  return {
    ...settings,
    providers: settings.providers.map((provider) => (provider.id === providerId ? { ...provider, ...patch } : provider))
  };
}

function updatePreferences(settings: UserSettings, patch: Partial<SummaryPreferences>): UserSettings {
  return {
    ...settings,
    summaryPreferences: { ...settings.summaryPreferences, ...patch }
  };
}

export function OptionsApp() {
  const [settings, setSettings] = useState<UserSettings>();
  const [selectedProviderId, setSelectedProviderId] = useState<string>();
  const [rulesText, setRulesText] = useState('[]');
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void sendRuntimeMessage({ type: RuntimeMessage.GetSettings }).then((loaded) => {
      setSettings(loaded);
      setSelectedProviderId(loaded.activeProviderId ?? loaded.providers[0]?.id);
      setRulesText(JSON.stringify(loaded.declarativeRules, null, 2));
    });
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(undefined), 2400);
    return () => window.clearTimeout(timer);
  }, [status]);

  const language = settings?.uiLanguage ?? 'en';
  const enabledProviders = useMemo(() => settings?.providers.filter((provider) => provider.enabled) ?? [], [settings]);
  const selectedProvider = settings?.providers.find((provider) => provider.id === selectedProviderId) ?? settings?.providers[0];
  const selectedProviderModels = getModelOptionsForProvider(selectedProvider);
  const selectedModel = selectedProvider ? getModelOptionForProvider(selectedProvider, selectedProvider.chatModel) : undefined;

  async function save(nextSettings = settings, toast = t(language, 'settingsSaved')) {
    if (!nextSettings) return;
    setError(undefined);

    try {
      const parsed = JSON.parse(rulesText || '[]') as DeclarativeExtractionRule[] | DeclarativeExtractionRule;
      const declarativeRules = Array.isArray(parsed) ? parsed : [parsed];
      const saved = await sendRuntimeMessage({
        type: RuntimeMessage.SaveSettings,
        settings: { ...nextSettings, declarativeRules }
      });
      setSettings(saved);
      setStatus(toast);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function toggleProvider(provider: LLMProviderConfig, enabled: boolean) {
    if (!settings) return;

    if (enabled) {
      const granted = await chrome.permissions.request({ origins: [getProviderOriginPattern(provider)] });
      if (!granted) {
        setError(`${t(language, 'providerPermissionDenied')} ${provider.name}`);
        return;
      }
    }

    const next = updateProvider(settings, provider.id, { enabled });
    const nextEnabledProviders = next.providers.filter((candidate) => candidate.enabled);
    const normalized = {
      ...next,
      activeProviderId: enabled
        ? next.activeProviderId ?? provider.id
        : next.activeProviderId === provider.id
          ? nextEnabledProviders[0]?.id
          : next.activeProviderId
    };

    setSettings(normalized);
    await save(normalized);
  }

  function patchSelectedProvider(patch: Partial<LLMProviderConfig>) {
    if (!settings || !selectedProvider) return;
    setSettings(updateProvider(settings, selectedProvider.id, patch));
  }

  async function refreshModels() {
    if (!selectedProvider) return;
    setError(undefined);
    setStatus('Refreshing official model list...');

    try {
      const saved = await sendRuntimeMessage({ type: RuntimeMessage.RefreshProviderModels, providerId: selectedProvider.id });
      setSettings(saved);
      setStatus(`Loaded ${saved.providers.find((provider) => provider.id === selectedProvider.id)?.discoveredModels?.length ?? 0} official models.`);
    } catch (err) {
      setError((err as Error).message);
      setStatus(undefined);
    }
  }

  if (!settings || !selectedProvider) {
    return <main className="app page">Loading settings...</main>;
  }

  return (
    <main className="app page stack">
      <div className="toast-stack" aria-live="polite">
        {status && <div className="toast success">{status}</div>}
        {error && <div className="toast error">{error}</div>}
      </div>

      <section className="hero">
        <div className="row between wrap">
          <span className="eyebrow">{t(language, 'options')}</span>
          <select
            className="compact-select"
            value={settings.uiLanguage}
            onChange={(event) => setSettings({ ...settings, uiLanguage: event.target.value as UiLanguage })}
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
        <h1>Configure official APIs, extractors, and local memory.</h1>
        <p className="muted">{t(language, 'apiKeysLocal')}</p>
      </section>

      <section className="card stack">
        <div className="row between wrap">
          <div>
            <h2>{t(language, 'providerSettings')}</h2>
            <p className="muted">{t(language, 'defaultProviderHint')}</p>
          </div>
          <span className="pill">{t(language, 'enabledCount')} {enabledProviders.length} / {settings.providers.length}</span>
        </div>

        <div className="provider-layout">
          <div className="provider-list" role="listbox" aria-label={t(language, 'selectProvider')}>
            {settings.providers.map((provider) => (
              <button
                className={`provider-tab ${provider.id === selectedProvider.id ? 'active' : ''}`}
                key={provider.id}
                onClick={() => setSelectedProviderId(provider.id)}
                type="button"
              >
                <span>{provider.name}</span>
                <span className={`pill ${provider.enabled ? 'good' : ''}`}>{provider.enabled ? t(language, 'enabled') : provider.region}</span>
              </button>
            ))}
          </div>

          <div className="card stack provider-editor">
            <div className="row between wrap">
              <div>
                <h3>{selectedProvider.name}</h3>
                <p className="muted">{selectedProvider.apiStyle} · {selectedProvider.region}</p>
              </div>
              <label className="check">
                <input
                  checked={selectedProvider.enabled}
                  type="checkbox"
                  onChange={(event) => void toggleProvider(selectedProvider, event.target.checked)}
                />
                <span>{t(language, 'enabled')}</span>
              </label>
            </div>

            <label className="check">
              <input
                checked={settings.activeProviderId === selectedProvider.id}
                disabled={!selectedProvider.enabled}
                name="activeProvider"
                type="radio"
                onChange={() => setSettings({ ...settings, activeProviderId: selectedProvider.id })}
              />
              <span>{t(language, 'defaultProvider')}</span>
            </label>

            <div className="grid two">
              <div className="field">
                <label>{t(language, 'baseUrl')}</label>
                <input value={selectedProvider.baseUrl} onChange={(event) => patchSelectedProvider({ baseUrl: event.target.value })} />
              </div>
              <div className="field">
                <label>{t(language, 'chatModel')}</label>
                <select value={selectedProvider.chatModel} onChange={(event) => patchSelectedProvider({ chatModel: event.target.value })}>
                  {selectedProviderModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row wrap">
              <button className="secondary" type="button" onClick={() => void refreshModels()}>Refresh official models</button>
              {selectedProvider.modelsFetchedAt && <span className="pill good">Fetched {new Date(selectedProvider.modelsFetchedAt).toLocaleString()}</span>}
            </div>
            {selectedModel && (
              <div className="model-card">
                <div className="row between wrap">
                  <strong>{selectedModel.id}</strong>
                  {selectedModel.contextWindow && <span className="pill">{Math.round(selectedModel.contextWindow / 1000)}K ctx</span>}
                </div>
                <p className="muted">{selectedModel.description}</p>
                <p className="muted">Model parameters: {formatModelParameters(selectedModel)}</p>
              </div>
            )}
            <div className="field">
              <label>API key</label>
              <input
                autoComplete="off"
                placeholder={t(language, 'keyPlaceholder')}
                type="password"
                value={selectedProvider.apiKey}
                onChange={(event) => patchSelectedProvider({ apiKey: event.target.value })}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>{t(language, 'summaryPreferences')}</h2>
        <div className="grid two">
          <div className="field">
            <label>{t(language, 'interfaceLanguage')}</label>
            <select
              value={settings.uiLanguage}
              onChange={(event) => setSettings({ ...settings, uiLanguage: event.target.value as UiLanguage })}
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </div>
          <div className="field">
            <label>{t(language, 'summaryLanguage')}</label>
            <select
              value={settings.summaryPreferences.language}
              onChange={(event) => setSettings(updatePreferences(settings, { language: event.target.value as SummaryPreferences['language'] }))}
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
              <option value="bilingual">Bilingual</option>
            </select>
          </div>
          <div className="field">
            <label>Length</label>
            <select
              value={settings.summaryPreferences.length}
              onChange={(event) => setSettings(updatePreferences(settings, { length: event.target.value as SummaryPreferences['length'] }))}
            >
              <option value="short">Short</option>
              <option value="medium">Medium</option>
              <option value="long">Long</option>
            </select>
          </div>
          <div className="field">
            <label>Style</label>
            <select
              value={settings.summaryPreferences.style}
              onChange={(event) => setSettings(updatePreferences(settings, { style: event.target.value as SummaryPreferences['style'] }))}
            >
              <option value="technical">Technical</option>
              <option value="plain">Plain</option>
              <option value="business">Business</option>
              <option value="critical">Critical</option>
              <option value="learning">Learning</option>
            </select>
          </div>
          <div className="field">
            <label>Default mode</label>
            <select
              value={settings.summaryPreferences.defaultMode}
              onChange={(event) => setSettings(updatePreferences(settings, { defaultMode: event.target.value as SummaryPreferences['defaultMode'] }))}
            >
              <option value="short">Short</option>
              <option value="medium">Standard</option>
              <option value="long">Deep</option>
              <option value="study">Study</option>
              <option value="research">Research</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2>{t(language, 'contentExtraction')}</h2>
        <p className="muted">{t(language, 'extractorHint')}</p>
        <div className="grid two">
          {BUILT_IN_EXTRACTORS.map((extractor) => {
            const state = settings.extractorSettings[extractor.id] ?? { enabled: true, priority: extractor.defaultPriority };
            return (
              <div className="card stack" key={extractor.id}>
                <div className="row between wrap">
                  <h3>{extractor.name}</h3>
                  <label className="check">
                    <input
                      checked={state.enabled}
                      type="checkbox"
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          extractorSettings: {
                            ...settings.extractorSettings,
                            [extractor.id]: { ...state, enabled: event.target.checked }
                          }
                        })
                      }
                    />
                    <span>{t(language, 'enabled')}</span>
                  </label>
                </div>
                <p className="muted">{extractor.description}</p>
                <div className="field">
                  <label>Priority</label>
                  <input
                    min="0"
                    type="number"
                    value={state.priority ?? extractor.defaultPriority}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        extractorSettings: {
                          ...settings.extractorSettings,
                          [extractor.id]: { ...state, priority: Number(event.target.value) }
                        }
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="field">
          <label>Declarative rule packs JSON</label>
          <textarea value={rulesText} onChange={(event) => setRulesText(event.target.value)} />
        </div>
      </section>

      <section className="card stack">
        <h2>{t(language, 'privacy')}</h2>
        <label className="check">
          <input
            checked={settings.privacy.saveSummaries}
            type="checkbox"
            onChange={(event) => setSettings({ ...settings, privacy: { ...settings.privacy, saveSummaries: event.target.checked } })}
          />
          <span>Save summaries to local IndexedDB</span>
        </label>
        <label className="check">
          <input
            checked={settings.privacy.saveExtractedText}
            type="checkbox"
            onChange={(event) => setSettings({ ...settings, privacy: { ...settings.privacy, saveExtractedText: event.target.checked } })}
          />
          <span>Save extracted source text locally</span>
        </label>
        <p className="muted">{t(language, 'apiKeysLocal')}</p>
      </section>

      <div className="row wrap action-bar">
        <button onClick={() => void save()}>{t(language, 'saveOptions')}</button>
        <button className="secondary" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/knowledge/index.html') })}>
          {t(language, 'openKnowledge')}
        </button>
        <button
          className="ghost"
          onClick={() =>
            void sendRuntimeMessage({ type: RuntimeMessage.ClearLibrary }).then(() => setStatus('Local knowledge cleared.'))
          }
        >
          {t(language, 'clearKnowledge')}
        </button>
      </div>
    </main>
  );
}
