import { expect } from 'vitest';
import type { CallLlmResult, ChatMessage, LlmExecutedTool } from '../../shared/gemini-types.js';
import {
  parseCodeExecutionBlocks,
  parseWebSearchBlocks,
} from '../../server/llm/conversation/specialist-tags.js';
import { parseToolCallBlocks } from '../../server/llm/conversation/tool-tags.js';
import type { LlmSession } from '../../server/llm/session.js';

export type SpecialistTagName = 'web_search' | 'code_execution' | 'tool_call';

export interface TranscriptExpectations {
  registryPattern?: RegExp;
  /** Result.text */
  text?: string | RegExp | ((text: string) => boolean);
  /** Result.thoughts — must be absent when expectNoThoughts */
  thoughts?: RegExp | ((text: string) => boolean);
  expectNoThoughts?: boolean;
  functionCalls?: string[];
  expectNoFunctionCalls?: boolean;
  executedToolsMin?: number;
  expectNoExecutedTools?: boolean;
  executedToolMatcher?: (tools: LlmExecutedTool[]) => boolean;
  assistantTags?: SpecialistTagName[];
  expectNoAssistantTags?: SpecialistTagName[];
  /** Assistant thoughts on transcript message (not only result.thoughts) */
  transcriptThoughts?: RegExp | ((text: string) => boolean);
  userPromptInTranscript?: string;
  messagesLength?: number;
}

function matchPattern(
  value: string,
  pattern: string | RegExp | ((text: string) => boolean),
): boolean {
  if (typeof pattern === 'function') {
    return pattern(value);
  }
  if (typeof pattern === 'string') {
    return value.includes(pattern);
  }
  return pattern.test(value);
}

export function assistantMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((message) => message.role === 'assistant');
}

export function combinedAssistantContent(messages: ChatMessage[]): string {
  return assistantMessages(messages)
    .map((message) => message.content)
    .join('\n');
}

function isWebSearchExecutedTool(tool: LlmExecutedTool): boolean {
  return (
    (tool.searchResults?.length ?? 0) > 0 ||
    (tool.searchQueries?.length ?? 0) > 0 ||
    tool.type === 'search' ||
    tool.type === 'web_search'
  );
}

function isCodeExecutionExecutedTool(tool: LlmExecutedTool): boolean {
  if (isWebSearchExecutedTool(tool)) {
    return false;
  }
  return Boolean(
    tool.codeResults?.length ||
    tool.type === 'python' ||
    tool.name === 'python',
  );
}

/** Rigorous check: API result fields + portable transcript alignment. */
export function assertUnifiedCallOutput(
  result: CallLlmResult,
  messages: ChatMessage[],
  expected: TranscriptExpectations,
): void {
  if (expected.registryPattern) {
    expect(result.registryKey).toMatch(expected.registryPattern);
  }

  if (expected.text) {
    expect(matchPattern(result.text, expected.text)).toBe(true);
  }

  if (expected.expectNoThoughts) {
    expect(result.thoughts?.trim()).toBeFalsy();
  } else if (expected.thoughts) {
    expect(matchPattern(result.thoughts ?? '', expected.thoughts)).toBe(true);
  }

  if (expected.expectNoFunctionCalls) {
    expect(result.functionCalls?.length ?? 0).toBe(0);
  } else if (expected.functionCalls?.length) {
    const names = result.functionCalls?.map((call) => call.name) ?? [];
    for (const name of expected.functionCalls) {
      expect(names).toContain(name);
    }
  }

  if (expected.expectNoExecutedTools) {
    expect(result.executedTools?.length ?? 0).toBe(0);
  } else {
    if (expected.executedToolsMin !== undefined) {
      expect(result.executedTools?.length ?? 0).toBeGreaterThanOrEqual(expected.executedToolsMin);
    }
    if (expected.executedToolMatcher) {
      expect(expected.executedToolMatcher(result.executedTools ?? [])).toBe(true);
    }
  }

  if (expected.messagesLength !== undefined) {
    expect(messages).toHaveLength(expected.messagesLength);
  }

  if (expected.userPromptInTranscript) {
    const user = messages.find((message) => message.role === 'user');
    expect(user?.content).toContain(expected.userPromptInTranscript);
  }

  const assistants = assistantMessages(messages);
  expect(assistants.length).toBeGreaterThan(0);

  const combined = combinedAssistantContent(messages);

  if (expected.assistantTags?.length) {
    for (const tag of expected.assistantTags) {
      expect(combined).toContain(`<${tag}`);
    }
  }

  if (expected.expectNoAssistantTags?.length) {
    for (const tag of expected.expectNoAssistantTags) {
      expect(combined).not.toContain(`<${tag}`);
    }
  }

  if (expected.transcriptThoughts) {
    const thoughtBlob = assistants.map((message) => message.thoughts ?? '').join('\n');
    expect(
      matchPattern(thoughtBlob || (result.thoughts ?? ''), expected.transcriptThoughts),
    ).toBe(true);
  }

  // Transcript tags must reflect result artifacts when present.
  if (result.executedTools?.some(isWebSearchExecutedTool)) {
    const parsed = parseWebSearchBlocks(combined);
    expect(parsed.length).toBeGreaterThan(0);
  }
  if (result.executedTools?.some(isCodeExecutionExecutedTool)) {
    const parsed = parseCodeExecutionBlocks(combined);
    expect(parsed.length).toBeGreaterThan(0);
  }
  if (result.functionCalls?.length) {
    const parsed = parseToolCallBlocks(combined);
    expect(parsed.length).toBeGreaterThanOrEqual(result.functionCalls.length);
  }
}

export function assertSessionExport(
  session: LlmSession,
  expected: TranscriptExpectations & { minAssistantTurns?: number },
): void {
  const messages = session.exportMessages({ includeToolSummary: true });
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const lastResultShape: CallLlmResult = {
    text: assistantMessages(messages).at(-1)?.content ?? '',
    thoughts: assistantMessages(messages).at(-1)?.thoughts,
    registryKey: assistantMessages(messages).at(-1)?.model ?? '',
    model: assistantMessages(messages).at(-1)?.model ?? '',
    thinkingUsed: Boolean(assistantMessages(messages).at(-1)?.thoughts),
    thinkingPowerApplied: 'off',
  };

  if (expected.minAssistantTurns !== undefined) {
    expect(assistantMessages(messages).length).toBeGreaterThanOrEqual(expected.minAssistantTurns);
  }

  assertUnifiedCallOutput(lastResultShape, messages, expected);

  if (expected.userPromptInTranscript && lastUser) {
    expect(lastUser.content).toContain(expected.userPromptInTranscript);
  }
}

/** Groq native thread follow-up payload expectations. */
export function assertGroqFollowUpPayload(
  secondPayload: { messages?: unknown[] },
  mode: 'compound-native' | 'gpt-oss-followup' | 'portable-rebuild',
): void {
  const messages = (secondPayload.messages ?? []) as Array<Record<string, unknown>>;
  const assistants = messages.filter((message) => message.role === 'assistant');
  expect(assistants.length).toBeGreaterThanOrEqual(1);

  if (mode === 'compound-native') {
    const withNative = assistants.find(
      (message) => message.reasoning || message.executed_tools,
    );
    expect(withNative).toBeDefined();
    return;
  }

  if (mode === 'gpt-oss-followup') {
    expect(assistants.some((message) => message.executed_tools)).toBe(false);
    const blob = JSON.stringify(messages);
    expect(blob.length).toBeGreaterThan(0);
    return;
  }

  const blob = JSON.stringify(messages);
  expect(blob).toMatch(/code_execution|web_search|tool_call/);
}
