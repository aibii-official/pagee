import type { LLMProviderConfig, LLMProviderDiscoveredModel } from '../shared/types';

interface OpenAICompatibleModelList {
  data?: Array<Record<string, unknown>>;
}

interface GeminiModelList {
  models?: Array<{
    name?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function inferVisionFromModelId(modelId: string): boolean | undefined {
  const id = modelId.toLowerCase();
  if (/(vision|vl|4v|image|gpt-4o|gemini|claude-3)/.test(id)) {
    return true;
  }

  if (/(embedding|text-embedding|moderation|rerank|tts|whisper|audio)/.test(id)) {
    return false;
  }

  return undefined;
}

function outputLimitFromRaw(raw: Record<string, unknown>): number | undefined {
  return (
    asNumber(raw.output_token_limit) ??
    asNumber(raw.outputTokenLimit) ??
    asNumber(raw.max_output_tokens) ??
    asNumber(raw.maxOutputTokens) ??
    asNumber(raw.max_tokens) ??
    asNumber(raw.maxTokens)
  );
}

function contextWindowFromRaw(raw: Record<string, unknown>): number | undefined {
  return (
    asNumber(raw.context_window) ??
    asNumber(raw.contextWindow) ??
    asNumber(raw.input_token_limit) ??
    asNumber(raw.inputTokenLimit) ??
    asNumber(raw.max_context_length) ??
    asNumber(raw.maxContextLength)
  );
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = text ? JSON.parse(text) as unknown : {};

  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? JSON.stringify((payload as { error?: unknown }).error)
      : text;
    throw new Error(message || `Model list request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function discoverOpenAICompatibleModels(provider: LLMProviderConfig): Promise<LLMProviderDiscoveredModel[]> {
  const payload = await fetchJson(`${provider.baseUrl.replace(/\/$/, '')}/models`, {
    headers: { authorization: `Bearer ${provider.apiKey}` }
  }) as OpenAICompatibleModelList;

  return (payload.data ?? [])
    .map((raw): LLMProviderDiscoveredModel | undefined => {
      const id = asString(raw.id);
      if (!id) return undefined;

      return {
        id,
        label: id,
        description: asString(raw.description) || asString(raw.owned_by) || 'Discovered from provider /models.',
        contextWindow: contextWindowFromRaw(raw),
        maxOutputTokens: outputLimitFromRaw(raw),
        capabilities: { vision: inferVisionFromModelId(id) },
        source: 'official-api' as const
      };
    })
    .filter((model): model is LLMProviderDiscoveredModel => Boolean(model));
}

async function discoverGeminiModels(provider: LLMProviderConfig): Promise<LLMProviderDiscoveredModel[]> {
  const payload = await fetchJson(`${provider.baseUrl.replace(/\/$/, '')}/models?key=${encodeURIComponent(provider.apiKey)}`, {}) as GeminiModelList;

  return (payload.models ?? [])
    .map((model): LLMProviderDiscoveredModel | undefined => {
      const rawId = model.name?.replace(/^models\//, '');
      if (!rawId || !model.supportedGenerationMethods?.includes('generateContent')) return undefined;

      return {
        id: rawId,
        label: model.displayName || rawId,
        description: model.description || 'Discovered from Gemini models endpoint.',
        contextWindow: model.inputTokenLimit,
        maxOutputTokens: model.outputTokenLimit,
        capabilities: { vision: inferVisionFromModelId(rawId) ?? true },
        source: 'official-api' as const
      };
    })
    .filter((model): model is LLMProviderDiscoveredModel => Boolean(model));
}

async function discoverAnthropicModels(provider: LLMProviderConfig): Promise<LLMProviderDiscoveredModel[]> {
  const payload = await fetchJson(`${provider.baseUrl.replace(/\/$/, '')}/models`, {
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01'
    }
  }) as OpenAICompatibleModelList;

  return (payload.data ?? [])
    .map((raw): LLMProviderDiscoveredModel | undefined => {
      const id = asString(raw.id);
      if (!id) return undefined;

      return {
        id,
        label: asString(raw.display_name) || id,
        description: asString(raw.description) || 'Discovered from Anthropic models endpoint.',
        contextWindow: contextWindowFromRaw(raw),
        maxOutputTokens: outputLimitFromRaw(raw),
        capabilities: { vision: inferVisionFromModelId(id) },
        source: 'official-api' as const
      };
    })
    .filter((model): model is LLMProviderDiscoveredModel => Boolean(model));
}

export async function discoverOfficialModels(provider: LLMProviderConfig): Promise<LLMProviderDiscoveredModel[]> {
  if (!provider.apiKey.trim()) {
    throw new Error(`${provider.name} needs an API key before refreshing official models.`);
  }

  if (provider.apiStyle === 'gemini') {
    return discoverGeminiModels(provider);
  }

  if (provider.apiStyle === 'anthropic') {
    return discoverAnthropicModels(provider);
  }

  return discoverOpenAICompatibleModels(provider);
}
