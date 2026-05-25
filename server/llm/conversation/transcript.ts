import type { CallLlmResult, ChatMessage, LlmFunctionCall } from '../../../shared/gemini-types.js';
import { formatAssistantToolStep } from './tool-tags.js';
import { formatExecutedToolsAsTags, stripSpecialistBlocks } from './specialist-tags.js';
import { stripToolCallBlocks } from './tool-tags.js';

export interface BuildTranscriptTurnOptions {
  userPrompt: string;
  result: Pick<
    CallLlmResult,
    'text' | 'thoughts' | 'functionCalls' | 'executedTools' | 'registryKey'
  >;
  /** When true, embed caller tool calls as `<tool_call>` blocks. */
  includeToolCalls?: boolean;
}

/** Visible assistant text without embedded specialist or tool_call blocks. */
export function visibleAssistantText(text: string): string {
  return stripToolCallBlocks(stripSpecialistBlocks(text)).trim();
}

export function formatAssistantTurnContent(
  result: Pick<CallLlmResult, 'text' | 'functionCalls' | 'executedTools'>,
  includeToolCalls = true,
): string {
  const visible = visibleAssistantText(result.text);
  const specialistTags = formatExecutedToolsAsTags(result.executedTools);
  const parts: string[] = [];

  if (visible) {
    parts.push(visible);
  }

  if (specialistTags) {
    parts.push(specialistTags);
  }

  if (includeToolCalls && result.functionCalls?.length) {
    const toolSection = formatAssistantToolStep(undefined, result.functionCalls);
    if (toolSection) {
      parts.push(toolSection);
    }
  }

  if (parts.length === 0) {
    return result.text.trim() || 'No response text received.';
  }

  return parts.join('\n\n');
}

export function buildTranscriptTurnFromResult(
  options: BuildTranscriptTurnOptions,
): ChatMessage[] {
  const { userPrompt, result, includeToolCalls = true } = options;
  const messages: ChatMessage[] = [];

  if (userPrompt.trim()) {
    messages.push({ role: 'user', content: userPrompt.trim() });
  }

  messages.push({
    role: 'assistant',
    content: formatAssistantTurnContent(result, includeToolCalls),
    thoughts: result.thoughts?.trim() || undefined,
    model: result.registryKey,
  });

  return messages;
}

/** Append assistant tool-call blocks for agent steps (caller tools only). */
export function formatAgentStepAssistantContent(
  visibleText: string | undefined,
  functionCalls: LlmFunctionCall[] | undefined,
  executedTools?: CallLlmResult['executedTools'],
): string {
  const specialistTags = formatExecutedToolsAsTags(executedTools);
  const parts: string[] = [];

  if (visibleText?.trim()) {
    parts.push(visibleText.trim());
  }

  if (specialistTags) {
    parts.push(specialistTags);
  }

  if (functionCalls?.length) {
    parts.push(formatAssistantToolStep(undefined, functionCalls));
  }

  return parts.join('\n\n');
}

export function appendTranscriptMessages(
  base: ChatMessage[],
  turn: ChatMessage[],
): ChatMessage[] {
  return [...base, ...turn];
}
