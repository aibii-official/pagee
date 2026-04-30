import type { LLMChatRequest, LLMMessage, LLMMessageContent } from '../types';
import { textFromMessageContent } from '../types';
import { supportedImageDataUrl, supportedImageDataUrlMimeType } from '../../shared/media';

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

type AnthropicContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

function base64FromDataUrl(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, '');
}

function toAnthropicContent(content: LLMMessageContent): AnthropicContentPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return content.map((part) =>
    part.type === 'image' && supportedImageDataUrl(part.dataUrl)
      ? {
          type: 'image',
          source: {
            type: 'base64',
            media_type: supportedImageDataUrlMimeType(part.dataUrl) || part.mimeType,
            data: base64FromDataUrl(supportedImageDataUrl(part.dataUrl) as string)
          }
        }
      : part.type === 'image'
        ? { type: 'text', text: `Image attachment ${part.id ?? ''} is available by URL but could not be embedded for this provider: ${part.url ?? part.source ?? ''}` }
      : { type: 'text', text: part.text }
  );
}

function toAnthropicMessages(messages: LLMMessage[]): Array<{ role: 'user' | 'assistant'; content: AnthropicContentPart[] }> {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: toAnthropicContent(message.content)
    }));
}

export async function callAnthropic({ provider, messages, parameters }: LLMChatRequest): Promise<string> {
  const endpoint = `${provider.baseUrl.replace(/\/$/, '')}/messages`;
  const systemMessage = messages.find((message) => message.role === 'system');
  const system = systemMessage ? textFromMessageContent(systemMessage.content) : undefined;
  const body: Record<string, unknown> = {
    model: provider.chatModel,
    max_tokens: parameters.maxTokens,
    system,
    messages: toAnthropicMessages(messages)
  };

  if (typeof parameters.temperature === 'number') {
    body.temperature = parameters.temperature;
  }

  if (typeof parameters.topP === 'number') {
    body.top_p = parameters.topP;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json().catch(() => ({}))) as AnthropicResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `${provider.name} returned HTTP ${response.status}.`);
  }

  const text = payload.content?.map((part) => part.text).filter(Boolean).join('\n').trim();
  if (!text) {
    throw new Error(`${provider.name} returned an empty response.`);
  }

  return text;
}
