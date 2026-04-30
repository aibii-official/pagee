import type { LLMChatRequest } from '../types';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
}

export async function callGemini({ provider, messages, parameters }: LLMChatRequest): Promise<string> {
  const model = provider.chatModel.replace(/^models\//, '');
  const endpoint = `${provider.baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    provider.apiKey
  )}`;
  const system = messages.find((message) => message.role === 'system')?.content;
  const userText = messages
    .filter((message) => message.role !== 'system')
    .map((message) => message.content)
    .join('\n\n');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: userText }] }],
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
