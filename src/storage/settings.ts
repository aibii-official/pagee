import { BUILT_IN_EXTRACTORS } from '../extractors/catalog';
import { normalizeProviderModel } from '../llm/model-catalog';
import type { ExtractorRuntimeSettings, LLMProviderConfig, UserSettings } from '../shared/types';

const SETTINGS_KEY = 'pagee:user-settings:v1';

export const DEFAULT_PROVIDERS: LLMProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI Official',
    region: 'us',
    apiStyle: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    chatModel: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small',
    supportsStreaming: true,
    supportsJsonMode: true,
    enabled: false
  },
  {
    id: 'anthropic',
    name: 'Anthropic Official',
    region: 'us',
    apiStyle: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    apiKey: '',
    chatModel: 'claude-3-5-haiku-latest',
    supportsStreaming: true,
    supportsJsonMode: false,
    enabled: false
  },
  {
    id: 'gemini',
    name: 'Google Gemini Official',
    region: 'global',
    apiStyle: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    chatModel: 'gemini-1.5-flash',
    supportsStreaming: true,
    supportsJsonMode: true,
    enabled: false
  },
  {
    id: 'deepseek',
    name: 'DeepSeek Official',
    region: 'cn',
    apiStyle: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    chatModel: 'deepseek-chat',
    supportsStreaming: true,
    supportsJsonMode: true,
    enabled: false
  },
  {
    id: 'moonshot',
    name: 'Moonshot/Kimi Official',
    region: 'cn',
    apiStyle: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    chatModel: 'kimi-k2.6',
    supportsStreaming: true,
    supportsJsonMode: true,
    enabled: false
  },
  {
    id: 'qwen',
    name: 'Alibaba Qwen/DashScope Official',
    region: 'cn',
    apiStyle: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    chatModel: 'qwen-plus',
    supportsStreaming: true,
    supportsJsonMode: true,
    enabled: false
  },
  {
    id: 'zhipu',
    name: 'Zhipu GLM Official',
    region: 'cn',
    apiStyle: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    chatModel: 'glm-4-flash',
    supportsStreaming: true,
    supportsJsonMode: true,
    enabled: false
  }
];

export const DEFAULT_SETTINGS: UserSettings = {
  uiLanguage: 'en',
  activeProviderId: undefined,
  providers: DEFAULT_PROVIDERS,
  summaryPreferences: {
    language: 'zh',
    length: 'medium',
    style: 'learning',
    defaultMode: 'medium'
  },
  extractorSettings: Object.fromEntries(
    BUILT_IN_EXTRACTORS.map((extractor) => [extractor.id, { enabled: true, priority: extractor.defaultPriority }])
  ),
  declarativeRules: [],
  privacy: {
    showApiDestinationBeforeRequest: true,
    saveExtractedText: true,
    saveSummaries: true
  }
};

function mergeSettings(value?: Partial<UserSettings>): UserSettings {
  const providers = DEFAULT_PROVIDERS.map((provider) =>
    normalizeProviderModel({
      ...provider,
      ...(value?.providers?.find((candidate) => candidate.id === provider.id) ?? {})
    })
  );

  return {
    ...DEFAULT_SETTINGS,
    ...value,
    providers,
    summaryPreferences: {
      ...DEFAULT_SETTINGS.summaryPreferences,
      ...value?.summaryPreferences
    },
    extractorSettings: {
      ...DEFAULT_SETTINGS.extractorSettings,
      ...value?.extractorSettings
    },
    privacy: {
      ...DEFAULT_SETTINGS.privacy,
      ...value?.privacy
    },
    declarativeRules: value?.declarativeRules ?? []
  };
}

export async function getSettings(): Promise<UserSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(stored[SETTINGS_KEY] as Partial<UserSettings> | undefined);
}

export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const normalized = mergeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function getActiveProvider(): Promise<LLMProviderConfig> {
  const settings = await getSettings();
  const provider = settings.providers.find((candidate) => candidate.id === settings.activeProviderId && candidate.enabled);
  const fallback = settings.providers.find((candidate) => candidate.enabled);
  const selected = provider ?? fallback;

  if (!selected) {
    throw new Error('No enabled provider. Configure an official API provider in Options first.');
  }

  if (!selected.apiKey.trim()) {
    throw new Error(`${selected.name} is enabled but has no API key.`);
  }

  return selected;
}

export function getProviderOriginPattern(provider: LLMProviderConfig): string {
  return `${new URL(provider.baseUrl).origin}/*`;
}

export async function ensureProviderPermission(provider: LLMProviderConfig): Promise<void> {
  const origin = getProviderOriginPattern(provider);
  const hasPermission = await chrome.permissions.contains({ origins: [origin] });

  if (hasPermission) {
    return;
  }

  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    throw new Error(`Permission was not granted for ${origin}.`);
  }
}

export function toExtractorRuntimeSettings(settings: UserSettings): ExtractorRuntimeSettings {
  const disabledExtractorIds = Object.entries(settings.extractorSettings)
    .filter(([, state]) => !state.enabled)
    .map(([id]) => id);

  const priorities = Object.fromEntries(
    Object.entries(settings.extractorSettings)
      .filter(([, state]) => typeof state.priority === 'number')
      .map(([id, state]) => [id, state.priority as number])
  );

  return {
    disabledExtractorIds,
    priorities,
    declarativeRules: settings.declarativeRules
  };
}
