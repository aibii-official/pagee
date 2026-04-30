import type { LLMChatRequest, LLMMessage } from '../types';

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
}

function toAnthropicMessages(messages: LLMMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content
    }));
}

export async function callAnthropic({ provider, messages, parameters }: LLMChatRequest): Promise<string> {
  const endpoint = `${provider.baseUrl.replace(/\/$/, '')}/messages`;
  const system = messages.find((message) => message.role === 'system')?.content;
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
