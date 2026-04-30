import type { LLMProviderConfig, SummaryMode } from '../shared/types';

export interface LLMGenerationParameters {
  maxTokens: number;
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  temperature?: number;
  topP?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  extraBody?: Record<string, unknown>;
}

export interface LLMModelOption {
  id: string;
  label: string;
  description: string;
  contextWindow?: number;
  recommended: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
  };
  fixedParameters?: Array<keyof Omit<LLMGenerationParameters, 'maxTokens'>>;
  unsupportedParameters?: Array<keyof Omit<LLMGenerationParameters, 'maxTokens'>>;
  request?: {
    maxTokensField?: 'max_tokens' | 'max_completion_tokens';
    jsonMode?: boolean;
    sampling?: 'send' | 'omit';
    timeoutMs?: number;
    extraBody?: Record<string, unknown>;
  };
}

const MODE_MAX_TOKENS: Record<SummaryMode, number> = {
  short: 900,
  medium: 1600,
  long: 2400,
  study: 1800,
  research: 2400
};

export const MODEL_CATALOG: Record<string, LLMModelOption[]> = {
  openai: [
    {
      id: 'gpt-4o-mini',
      label: 'GPT-4o mini',
      description: 'Cost-effective default for page summaries.',
      contextWindow: 128000,
      recommended: { temperature: 0.2, maxTokens: 1600 }
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      description: 'Higher quality summary and reasoning.',
      contextWindow: 128000,
      recommended: { temperature: 0.2, maxTokens: 2200 }
    },
    {
      id: 'gpt-4.1-mini',
      label: 'GPT-4.1 mini',
      description: 'Fast long-context synthesis.',
      contextWindow: 1047576,
      recommended: { temperature: 0.2, maxTokens: 2200 }
    },
    {
      id: 'gpt-4.1',
      label: 'GPT-4.1',
      description: 'Strong long-context synthesis.',
      contextWindow: 1047576,
      recommended: { temperature: 0.2, maxTokens: 2400 }
    }
  ],
  anthropic: [
    {
      id: 'claude-3-5-haiku-latest',
      label: 'Claude 3.5 Haiku',
      description: 'Fast, economical summaries.',
      contextWindow: 200000,
      recommended: { temperature: 0.2, maxTokens: 1600 }
    },
    {
      id: 'claude-3-5-sonnet-latest',
      label: 'Claude 3.5 Sonnet',
      description: 'Balanced high-quality summaries.',
      contextWindow: 200000,
      recommended: { temperature: 0.2, maxTokens: 2200 }
    },
    {
      id: 'claude-3-7-sonnet-latest',
      label: 'Claude 3.7 Sonnet',
      description: 'Deeper analysis and research summaries.',
      contextWindow: 200000,
      recommended: { temperature: 0.2, maxTokens: 2400 }
    }
  ],
  gemini: [
    {
      id: 'gemini-1.5-flash',
      label: 'Gemini 1.5 Flash',
      description: 'Fast default with broad context.',
      contextWindow: 1000000,
      recommended: { temperature: 0.2, maxTokens: 1600 }
    },
    {
      id: 'gemini-1.5-pro',
      label: 'Gemini 1.5 Pro',
      description: 'Higher quality long-context summaries.',
      contextWindow: 2000000,
      recommended: { temperature: 0.2, maxTokens: 2400 }
    },
    {
      id: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
      description: 'Newer fast Gemini model.',
      contextWindow: 1000000,
      recommended: { temperature: 0.2, maxTokens: 1800 }
    }
  ],
  deepseek: [
    {
      id: 'deepseek-chat',
      label: 'DeepSeek Chat',
      description: 'General summaries via official OpenAI-compatible API.',
      contextWindow: 64000,
      recommended: { temperature: 0.2, maxTokens: 1600 }
    },
    {
      id: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner',
      description: 'Research-style summaries with stronger reasoning.',
      contextWindow: 64000,
      recommended: { temperature: 0.2, maxTokens: 2400 }
    }
  ],
  moonshot: [
    {
      id: 'kimi-k2.6',
      label: 'Kimi K2.6',
      description: 'Kimi K2.6 has strict sampling constraints. Pagee omits sampling parameters and disables thinking for summary JSON output.',
      recommended: { maxTokens: 2400 },
      request: {
        maxTokensField: 'max_completion_tokens',
        jsonMode: true,
        sampling: 'omit',
        timeoutMs: 120000,
        extraBody: { thinking: { type: 'disabled' } }
      }
    },
    {
      id: 'kimi-k2.5',
      label: 'Kimi K2.5',
      description: 'Kimi K2.5 has strict sampling constraints. Pagee omits sampling parameters and disables thinking for summary JSON output.',
      recommended: { maxTokens: 2200 },
      request: {
        maxTokensField: 'max_completion_tokens',
        jsonMode: true,
        sampling: 'omit',
        timeoutMs: 120000,
        extraBody: { thinking: { type: 'disabled' } }
      }
    },
    {
      id: 'kimi-k2-0905-preview',
      label: 'Kimi K2 0905 Preview',
      description: 'Kimi K2 preview model. Pagee omits sampling parameters to avoid provider-side strict value drift.',
      recommended: { maxTokens: 2400 },
      request: { maxTokensField: 'max_completion_tokens', jsonMode: true, sampling: 'omit', timeoutMs: 120000 }
    },
    {
      id: 'kimi-k2-0711-preview',
      label: 'Kimi K2 Preview',
      description: 'Kimi K2 preview model. Pagee omits sampling parameters to avoid provider-side strict value drift.',
      recommended: { maxTokens: 2400 },
      request: { maxTokensField: 'max_completion_tokens', jsonMode: true, sampling: 'omit', timeoutMs: 120000 }
    },
    {
      id: 'kimi-k2-turbo-preview',
      label: 'Kimi K2 Turbo Preview',
      description: 'Faster Kimi K2 preview model. Pagee omits sampling parameters to avoid provider-side strict value drift.',
      recommended: { maxTokens: 2200 },
      request: { maxTokensField: 'max_completion_tokens', jsonMode: true, sampling: 'omit', timeoutMs: 120000 }
    },
    {
      id: 'moonshot-v1-8k',
      label: 'Moonshot v1 8K',
      description: 'Classic Moonshot short-context model.',
      contextWindow: 8192,
      recommended: { maxTokens: 1200 },
      request: { maxTokensField: 'max_completion_tokens', jsonMode: true, sampling: 'omit' }
    },
    {
      id: 'moonshot-v1-32k',
      label: 'Moonshot v1 32K',
      description: 'Classic Moonshot medium-context model.',
      contextWindow: 32768,
      recommended: { maxTokens: 1800 },
      request: { maxTokensField: 'max_completion_tokens', jsonMode: true, sampling: 'omit' }
    },
    {
      id: 'moonshot-v1-128k',
      label: 'Moonshot v1 128K',
      description: 'Classic Moonshot long-context model.',
      contextWindow: 131072,
      recommended: { maxTokens: 2400 },
      request: { maxTokensField: 'max_completion_tokens', jsonMode: true, sampling: 'omit' }
    },
    {
      id: 'moonshot-v1-auto',
      label: 'Moonshot v1 Auto',
      description: 'Moonshot automatically selects context size.',
      recommended: { maxTokens: 2400 },
      request: { maxTokensField: 'max_completion_tokens', jsonMode: true, sampling: 'omit' }
    }
  ],
  qwen: [
    {
      id: 'qwen-plus',
      label: 'Qwen Plus',
      description: 'Balanced DashScope OpenAI-compatible model.',
      recommended: { temperature: 0.2, maxTokens: 1800 }
    },
    {
      id: 'qwen-turbo',
      label: 'Qwen Turbo',
      description: 'Fast and economical summaries.',
      recommended: { temperature: 0.2, maxTokens: 1400 }
    },
    {
      id: 'qwen-max',
      label: 'Qwen Max',
      description: 'Higher quality Qwen summaries.',
      recommended: { temperature: 0.2, maxTokens: 2400 }
    },
    {
      id: 'qwen-long',
      label: 'Qwen Long',
      description: 'Long-context page and document summaries.',
      recommended: { temperature: 0.2, maxTokens: 2400 }
    }
  ],
  zhipu: [
    {
      id: 'glm-4-flash',
      label: 'GLM-4 Flash',
      description: 'Fast official GLM model.',
      recommended: { temperature: 0.2, maxTokens: 1600 }
    },
    {
      id: 'glm-4-plus',
      label: 'GLM-4 Plus',
      description: 'Higher quality GLM summaries.',
      recommended: { temperature: 0.2, maxTokens: 2200 }
    },
    {
      id: 'glm-4-long',
      label: 'GLM-4 Long',
      description: 'Long-context GLM summaries.',
      recommended: { temperature: 0.2, maxTokens: 2400 }
    }
  ]
};

export function getModelOptions(providerId?: string): LLMModelOption[] {
  return providerId ? MODEL_CATALOG[providerId] ?? [] : [];
}

export function getDefaultModelId(providerId: string): string {
  return getModelOptions(providerId)[0]?.id ?? '';
}

export function getModelOption(providerId: string, modelId?: string): LLMModelOption | undefined {
  const options = getModelOptions(providerId);
  return options.find((model) => model.id === modelId) ?? options[0];
}

export function normalizeProviderModel(provider: LLMProviderConfig): LLMProviderConfig {
  const options = getModelOptions(provider.id);

  if (options.length === 0 || options.some((model) => model.id === provider.chatModel)) {
    return provider;
  }

  return { ...provider, chatModel: options[0].id };
}

export function resolveGenerationParameters(provider: LLMProviderConfig, mode: SummaryMode): LLMGenerationParameters {
  const model = getModelOption(provider.id, provider.chatModel);
  const modeMaxTokens = MODE_MAX_TOKENS[mode];
  const recommended = model?.recommended ?? { temperature: 0.2 };
  const maxTokens = Math.min(modeMaxTokens, recommended.maxTokens ?? modeMaxTokens);

  return {
    maxTokens,
    maxTokensField: model?.request?.maxTokensField,
    temperature:
      model?.request?.sampling === 'omit' || model?.unsupportedParameters?.includes('temperature') ? undefined : recommended.temperature,
    topP: model?.request?.sampling === 'omit' || model?.unsupportedParameters?.includes('topP') ? undefined : recommended.topP,
    jsonMode: model?.request?.jsonMode,
    timeoutMs: model?.request?.timeoutMs,
    extraBody: model?.request?.extraBody
  };
}

export function formatModelParameters(model?: LLMModelOption): string {
  if (!model) return '';
  const parts: string[] = [];

  if (typeof model.recommended.temperature === 'number') {
    parts.push(`temperature=${model.recommended.temperature}${model.fixedParameters?.includes('temperature') ? ' fixed' : ''}`);
  }

  if (typeof model.recommended.topP === 'number') {
    parts.push(`top_p=${model.recommended.topP}${model.fixedParameters?.includes('topP') ? ' fixed' : ''}`);
  }

  if (typeof model.recommended.maxTokens === 'number') {
    parts.push(`max=${model.recommended.maxTokens}`);
  }

  if (model.request?.sampling === 'omit') {
    parts.push('sampling=provider default');
  }

  if (model.request?.maxTokensField) {
    parts.push(model.request.maxTokensField);
  }

  if (model.request?.extraBody) {
    parts.push('model-specific body');
  }

  return parts.join(' · ');
}
