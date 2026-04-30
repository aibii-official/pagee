import type { LLMProviderConfig } from '../shared/types';
import type { LLMGenerationParameters } from './model-catalog';

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMChatRequest {
  provider: LLMProviderConfig;
  messages: LLMMessage[];
  parameters: LLMGenerationParameters;
}
