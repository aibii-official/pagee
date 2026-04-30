import type { LLMChatRequest, LLMMessage, LLMMessageContent } from '../types';
import { supportedImageDataUrl } from '../../shared/media';

interface OpenAIMessagePart {
  type?: string;
  text?: string;
  image_url?: { url: string };
}

interface OpenAIChoice {
  message?: {
    content?: string | OpenAIMessagePart[] | null;
    reasoning_content?: string | null;
    refusal?: string | null;
  };
  text?: string;
  finish_reason?: string | null;
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: Record<string, unknown>;
  error?: { message?: string; type?: string; code?: string };
}

class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: OpenAIResponse
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

type OpenAIContent = string | OpenAIMessagePart[] | null | undefined;

function toOpenAIContent(content: LLMMessageContent): string | OpenAIMessagePart[] {
  if (typeof content === 'string') {
    return content;
  }

  return content.flatMap((part): OpenAIMessagePart[] => {
    if (part.type !== 'image') {
      return [{ type: 'text', text: part.text }];
    }

    const url = supportedImageDataUrl(part.dataUrl);
    return url ? [{ type: 'image_url', image_url: { url } }] : [];
  });
}

function toOpenAIMessages(messages: LLMMessage[]): Array<{ role: string; content: string | OpenAIMessagePart[] }> {
  return messages.map((message) => ({
    role: message.role,
    content: toOpenAIContent(message.content)
  }));
}

function textFromContent(content: OpenAIContent): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text)
      .filter(Boolean)
      .join('\n')
      .trim();
  }

  return '';
}

function buildBody(request: LLMChatRequest, includeJsonMode: boolean): Record<string, unknown> {
  const { provider, messages, parameters } = request;
  const body: Record<string, unknown> = {
    model: provider.chatModel,
    messages: toOpenAIMessages(messages),
    ...(parameters.extraBody ?? {})
  };
  const maxTokensField = parameters.maxTokensField ?? 'max_tokens';

  body[maxTokensField] = parameters.maxTokens;

  if (typeof parameters.temperature === 'number') {
    body.temperature = parameters.temperature;
  }

  if (typeof parameters.topP === 'number') {
    body.top_p = parameters.topP;
  }

  if (includeJsonMode) {
    body.response_format = { type: 'json_object' };
  }

  return body;
}

async function postChatCompletion(request: LLMChatRequest, includeJsonMode: boolean): Promise<OpenAIResponse> {
  const endpoint = `${request.provider.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = buildBody(request, includeJsonMode);
  const response = await fetchWithProviderAuth(endpoint, request.provider.apiKey, body);
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as OpenAIResponse) : ({} as OpenAIResponse);

  if (!response.ok) {
    const error = payload.error;
    const detail = [error?.message, error?.type, error?.code].filter(Boolean).join(' · ');
    throw new ProviderRequestError(detail || `${request.provider.name} returned HTTP ${response.status}.`, response.status, payload);
  }

  return payload;
}

async function fetchWithProviderAuth(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
}

function extractContent(payload: OpenAIResponse): string {
  const choice = payload.choices?.[0];
  const messageContent = textFromContent(choice?.message?.content);

  if (messageContent) {
    return messageContent;
  }

  if (choice?.text?.trim()) {
    return choice.text.trim();
  }

  return '';
}

function finishReason(payload: OpenAIResponse): string | undefined | null {
  return payload.choices?.[0]?.finish_reason;
}

function describeEmptyResponse(providerName: string, model: string, payload: OpenAIResponse): string {
  const choice = payload.choices?.[0];
  const finishReason = choice?.finish_reason ?? 'unknown';
  const usage = payload.usage ? JSON.stringify(payload.usage) : 'no usage';
  const reasoningOnly = Boolean(choice?.message?.reasoning_content && !choice.message.content);
  const refusal = choice?.message?.refusal;
  const hints: string[] = [];

  if (finishReason === 'length') {
    hints.push('generation hit the token limit');
  }

  if (reasoningOnly) {
    hints.push('model returned reasoning_content without final content');
  }

  if (refusal) {
    hints.push(`refusal: ${refusal}`);
  }

  return `${providerName} returned no final content for ${model}. finish_reason=${finishReason}; ${usage}${
    hints.length ? `; ${hints.join('; ')}` : ''
  }.`;
}

function temperatureConstraintFromError(error: unknown): number | undefined {
  const message = (error as Error).message;
  const match = message.match(/invalid temperature:\s*only\s*([0-9.]+)\s*is allowed/i);
  const value = match?.[1] ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : undefined;
}

function maxTokenConstraintFromError(error: unknown, currentMaxTokens: number): number | undefined {
  const message = (error as Error).message;
  const lower = message.toLowerCase();

  if (!lower.includes('max') || !lower.includes('token')) {
    return undefined;
  }

  const candidates = Array.from(message.matchAll(/\b\d{3,6}\b/g))
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value > 0 && value < currentMaxTokens)
    .sort((left, right) => right - left);

  return candidates[0];
}

function shouldRetryWithoutTemperature(error: unknown): boolean {
  const message = (error as Error).message.toLowerCase();
  return message.includes('invalid temperature') || message.includes('temperature') && message.includes('not supported');
}

async function withProviderParameterRecovery(request: LLMChatRequest, includeJsonMode: boolean): Promise<OpenAIResponse> {
  try {
    return await postChatCompletion(request, includeJsonMode);
  } catch (error) {
    const exactTemperature = temperatureConstraintFromError(error);
    const providerMaxTokens = maxTokenConstraintFromError(error, request.parameters.maxTokens);

    if (typeof providerMaxTokens === 'number') {
      return postChatCompletion(
        {
          ...request,
          parameters: {
            ...request.parameters,
            maxTokens: providerMaxTokens
          }
        },
        includeJsonMode
      );
    }

    if (typeof exactTemperature === 'number') {
      return postChatCompletion(
        {
          ...request,
          parameters: {
            ...request.parameters,
            temperature: exactTemperature
          }
        },
        includeJsonMode
      );
    }

    if (shouldRetryWithoutTemperature(error) && typeof request.parameters.temperature === 'number') {
      return postChatCompletion(
        {
          ...request,
          parameters: {
            ...request.parameters,
            temperature: undefined,
            topP: undefined
          }
        },
        includeJsonMode
      );
    }

    throw error;
  }
}

export async function callOpenAICompatible(request: LLMChatRequest): Promise<string> {
  const includeJsonMode = Boolean(request.provider.supportsJsonMode && request.parameters.jsonMode !== false);
  const firstPayload = await withProviderParameterRecovery(request, includeJsonMode);
  if (finishReason(firstPayload) === 'length') {
    throw new Error(`${request.provider.name} stopped because the output token limit was reached for ${request.provider.chatModel}.`);
  }
  const firstContent = extractContent(firstPayload);

  if (firstContent) {
    return firstContent;
  }

  if (includeJsonMode) {
    const retryPayload = await withProviderParameterRecovery(request, false);
    if (finishReason(retryPayload) === 'length') {
      throw new Error(`${request.provider.name} stopped because the output token limit was reached for ${request.provider.chatModel}.`);
    }
    const retryContent = extractContent(retryPayload);

    if (retryContent) {
      return retryContent;
    }

    throw new Error(describeEmptyResponse(request.provider.name, request.provider.chatModel, retryPayload));
  }

  throw new Error(describeEmptyResponse(request.provider.name, request.provider.chatModel, firstPayload));
}
