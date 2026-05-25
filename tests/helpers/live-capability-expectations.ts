import type { CallLlmResult, ChatMessage } from '../../shared/gemini-types.js';
import {
  assertUnifiedCallOutput,
  assertSessionExport,
  assistantMessages,
  combinedAssistantContent,
  type SpecialistTagName,
  type TranscriptExpectations,
} from './capability-output-expectations.js';

export type AssertCapabilityTranscriptOptions = {
  result: CallLlmResult;
  messages: ChatMessage[];
} & TranscriptExpectations;

/** Live smoke: object-style wrapper around `assertUnifiedCallOutput(result, messages, expected)`. */
export function assertCapabilityTranscript(options: AssertCapabilityTranscriptOptions): void {
  const { result, messages, ...expected } = options;
  assertUnifiedCallOutput(result, messages, expected);
}

export {
  assertSessionExport,
  assistantMessages,
  combinedAssistantContent,
  type SpecialistTagName,
  type TranscriptExpectations,
};

import type { ChatMessage } from '../../shared/gemini-types.js';

export function lastAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'assistant');
}
