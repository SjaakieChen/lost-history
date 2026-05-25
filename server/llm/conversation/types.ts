import type { Content } from '@google/genai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { LlmProvider } from '../../../shared/gemini-types.js';

export type GeminiThreadState = {
  provider: 'gemini';
  contents: Content[];
};

export type GroqThreadState = {
  provider: 'groq';
  messages: ChatCompletionMessageParam[];
};

export type ProviderThreadState = GeminiThreadState | GroqThreadState;

export function getThreadProvider(state: ProviderThreadState): LlmProvider {
  return state.provider;
}
