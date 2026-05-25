import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type OpenAI from 'openai';
import type { LlmFunctionCall } from '../../../shared/gemini-types.js';
import { formatToolResultLine } from './tool-tags.js';
import type { GroqThreadState } from './types.js';

export function createGroqThread(messages: ChatCompletionMessageParam[] = []): GroqThreadState {
  return { provider: 'groq', messages: [...messages] };
}

export function encodeGroqMessages(state: GroqThreadState): ChatCompletionMessageParam[] {
  return [...state.messages];
}

export function appendGroqUserText(state: GroqThreadState, text: string): void {
  state.messages.push({ role: 'user', content: text });
}

export function appendGroqAssistantMessage(
  state: GroqThreadState,
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
): void {
  state.messages.push({
    role: 'assistant',
    content: message.content ?? null,
    tool_calls: message.tool_calls,
  });
}

export function appendGroqToolResult(
  state: GroqThreadState,
  toolCallId: string,
  name: string,
  response: Record<string, unknown>,
): void {
  state.messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(response),
  });
}

export function appendGroqAssistantFromFunctionCalls(
  state: GroqThreadState,
  calls: LlmFunctionCall[],
  visibleText?: string,
): void {
  const tool_calls = calls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    type: 'function' as const,
    function: {
      name: call.name,
      arguments: JSON.stringify(call.args ?? {}),
    },
  }));

  state.messages.push({
    role: 'assistant',
    content: visibleText?.trim() || null,
    tool_calls,
  });
}

export function chatMessageToGroqParam(
  message: { role: string; content: string; toolName?: string; toolCallId?: string },
  preserveToolRole: boolean,
): ChatCompletionMessageParam {
  if (message.role === 'assistant') {
    return { role: 'assistant', content: message.content };
  }
  if (message.role === 'tool' && preserveToolRole && message.toolCallId && message.toolName) {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }
  if (message.role === 'tool' && message.toolName) {
    return {
      role: 'user',
      content: formatToolResultLine(message.toolName, safeParseJson(message.content)),
    };
  }
  if (message.role === 'system') {
    return { role: 'system', content: message.content };
  }
  return { role: 'user', content: message.content };
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
