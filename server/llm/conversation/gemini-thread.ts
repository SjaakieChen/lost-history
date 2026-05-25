import type { Content, GenerateContentResponse } from '@google/genai';
import type { LlmFunctionCall } from '../../../shared/gemini-types.js';
import type { GeminiThreadState } from './types.js';

export function createGeminiThread(contents: Content[] = []): GeminiThreadState {
  return { provider: 'gemini', contents: [...contents] };
}

export function encodeGeminiContents(state: GeminiThreadState): Content[] {
  return [...state.contents];
}

export function appendGeminiUserText(state: GeminiThreadState, text: string): void {
  state.contents.push({ role: 'user', parts: [{ text }] });
}

export function appendGeminiModelContent(state: GeminiThreadState, content: Content): void {
  state.contents.push(content);
}

export function modelContentFromResponse(response: GenerateContentResponse): Content | undefined {
  return response.candidates?.[0]?.content;
}

export function appendGeminiModelResponse(state: GeminiThreadState, response: GenerateContentResponse): void {
  const content = modelContentFromResponse(response);
  if (content) {
    appendGeminiModelContent(state, content);
  }
}

export function buildGeminiFunctionResponseContent(
  name: string,
  response: Record<string, unknown>,
  id?: string,
): Content {
  return {
    role: 'user',
    parts: [
      {
        functionResponse: {
          name,
          response,
          ...(id ? { id } : {}),
        },
      },
    ],
  };
}

export function appendGeminiToolResponse(
  state: GeminiThreadState,
  name: string,
  response: Record<string, unknown>,
  id?: string,
): void {
  state.contents.push(buildGeminiFunctionResponseContent(name, response, id));
}

export function chatMessageToGeminiContent(message: {
  role: string;
  content: string;
  toolName?: string;
}): Content {
  if (message.role === 'assistant') {
    return { role: 'model', parts: [{ text: message.content }] };
  }
  if (message.role === 'tool' && message.toolName) {
    return buildGeminiFunctionResponseContent(
      message.toolName,
      safeParseJson(message.content),
    );
  }
  return { role: 'user', parts: [{ text: message.content }] };
}

function safeParseJson(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw: content };
  }
}

export function groqCallsToGeminiModelTurn(_calls: LlmFunctionCall[]): Content {
  // Gemini uses native response content; this is only for cross-provider fallback.
  return { role: 'model', parts: [{ text: '' }] };
}
