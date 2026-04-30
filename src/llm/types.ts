import type { LLMProviderConfig } from '../shared/types';
import type { LLMGenerationParameters } from './model-catalog';

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMTextPart {
  type: 'text';
  text: string;
}

export interface LLMImagePart {
  type: 'image';
  dataUrl?: string;
  url?: string;
  mimeType: string;
  id?: string;
  source?: string;
}

export type LLMMessagePart = LLMTextPart | LLMImagePart;

export type LLMMessageContent = string | LLMMessagePart[];

export interface LLMMessage {
  role: LLMRole;
  content: LLMMessageContent;
}

export interface LLMChatRequest {
  provider: LLMProviderConfig;
  messages: LLMMessage[];
  parameters: LLMGenerationParameters;
}

export function textFromMessageContent(content: LLMMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .filter((part): part is LLMTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n');
}
