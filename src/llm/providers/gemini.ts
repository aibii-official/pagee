import type { LLMChatRequest, LLMMessageContent } from '../types';
import { textFromMessageContent } from '../types';
import { supportedImageDataUrl, supportedImageDataUrlMimeType } from '../../shared/media';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function base64FromDataUrl(value: string): string {
  return value.replace(/^data:[^;]+;base64,/, '');
}

function toGeminiParts(content: LLMMessageContent): GeminiPart[] {
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  return content.map((part) =>
    part.type === 'image' && supportedImageDataUrl(part.dataUrl)
      ? {
          inlineData: {
            mimeType: supportedImageDataUrlMimeType(part.dataUrl) || part.mimeType,
            data: base64FromDataUrl(supportedImageDataUrl(part.dataUrl) as string)
          }
        }
      : part.type === 'image'
        ? { text: `Image attachment ${part.id ?? ''} is available by URL but could not be embedded for this provider: ${part.url ?? part.source ?? ''}` }
      : { text: part.text }
  );
}

export async function callGemini({ provider, messages, parameters }: LLMChatRequest): Promise<string> {
  const model = provider.chatModel.replace(/^models\//, '');
  const endpoint = `${provider.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    provider.apiKey
  )}`;
  const systemMessage = messages.find((message) => message.role === 'system');
  const system = systemMessage ? textFromMessageContent(systemMessage.content) : undefined;
  const userParts = messages
    .filter((message) => message.role !== 'system')
    .flatMap((message) => toGeminiParts(message.content));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: userParts }],
      generationConfig: {
        maxOutputTokens: parameters.maxTokens,
        temperature: parameters.temperature,
        topP: parameters.topP,
        responseMimeType: provider.supportsJsonMode ? 'application/json' : undefined
      }
    })
  });

  const payload = (await response.json().catch(() => ({}))) as GeminiResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `${provider.name} returned HTTP ${response.status}.`);
  }

  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('\n').trim();
  if (!text) {
    throw new Error(`${provider.name} returned an empty response.`);
  }

  return text;
}
