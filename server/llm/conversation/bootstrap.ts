import type { Content } from '@google/genai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { CallLlmOptions } from '../../../shared/gemini-types.js';
import type { ResolvedTextModel } from '../../gemini/models.js';
import { chatMessageToGeminiContent, createGeminiThread } from './gemini-thread.js';
import { chatMessageToGroqParam, createGroqThread } from './groq-thread.js';
import { normalizeImportedMessages } from './import.js';
import type { ProviderThreadState } from './types.js';

function resolveSystemInstruction(options: CallLlmOptions): string | undefined {
  const fromMessages = options.messages?.find((message) => message.role === 'system')?.content;
  return options.systemInstruction?.trim() || fromMessages?.trim() || undefined;
}

export function createThreadState(
  resolved: ResolvedTextModel,
  options: Pick<CallLlmOptions, 'messages' | 'prompt' | 'systemInstruction'>,
  importOptions?: { preserveToolRole?: boolean; supportsFunctionCalling?: boolean },
): ProviderThreadState {
  const provider = resolved.info.provider ?? 'gemini';
  const preserveToolRole =
    importOptions?.preserveToolRole ??
    (importOptions?.supportsFunctionCalling ?? resolved.info.supportsFunctionCalling);

  const rawMessages = options.messages ?? [];
  const normalized = normalizeImportedMessages(rawMessages, { preserveToolRole });
  const system = resolveSystemInstruction(options);

  if (provider === 'groq') {
    const messages: ChatCompletionMessageParam[] = [];
    if (system) {
      messages.push({ role: 'system', content: system });
    }
    for (const message of normalized) {
      if (message.role === 'system') {
        continue;
      }
      messages.push(
        chatMessageToGroqParam(message, preserveToolRole && resolved.info.supportsFunctionCalling),
      );
    }
    if (options.prompt?.trim()) {
      messages.push({ role: 'user', content: options.prompt.trim() });
    }
    if (messages.filter((m) => m.role !== 'system').length === 0 && !options.prompt?.trim()) {
      throw new Error('Either prompt or messages is required.');
    }
    return createGroqThread(messages);
  }

  const contents: Content[] = [];
  for (const message of normalized) {
    if (message.role === 'system') {
      continue;
    }
    contents.push(chatMessageToGeminiContent(message));
  }
  if (options.prompt?.trim()) {
    contents.push({ role: 'user', parts: [{ text: options.prompt.trim() }] });
  }
  if (contents.length === 0) {
    throw new Error('Either prompt or messages is required.');
  }
  return createGeminiThread(contents);
}

export function appendUserPromptToThread(state: ProviderThreadState, prompt: string): void {
  const text = prompt.trim();
  if (!text) {
    return;
  }
  if (state.provider === 'gemini') {
    state.contents.push({ role: 'user', parts: [{ text }] });
  } else {
    state.messages.push({ role: 'user', content: text });
  }
}

export function getThreadSystemInstruction(
  state: ProviderThreadState,
  fallback?: string,
): string | undefined {
  if (state.provider === 'groq') {
    const system = state.messages.find((m) => m.role === 'system');
    if (system && 'content' in system && typeof system.content === 'string') {
      return system.content;
    }
  }
  return fallback;
}
