import type {
  CallLlmOptions,
  LlmFunctionDeclaration,
  LlmProviderRequestSnapshot,
} from '../../shared/gemini-types.js';
import type { ResolvedTextModel } from '../gemini/models.js';
import {
  encodeGeminiContents,
  encodeGroqMessages,
  type GeminiThreadState,
  type GroqThreadState,
  type ProviderThreadState,
} from './conversation/index.js';

interface RequestConfigSlice {
  systemInstruction?: string;
  maxOutputTokens?: number;
  thinkingConfig?: unknown;
  toolsConfig?: unknown;
  structuredConfig?: unknown;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function serializeProviderThread(thread: ProviderThreadState): unknown {
  return cloneJson(thread);
}

export function buildProviderRequestSnapshot(
  candidate: ResolvedTextModel,
  thread: ProviderThreadState,
  requestConfig: RequestConfigSlice,
  options: Pick<CallLlmOptions, 'tools' | 'functionCallingMode'>,
): LlmProviderRequestSnapshot {
  const provider = candidate.info.provider ?? 'gemini';
  const providerMessages =
    provider === 'groq'
      ? encodeGroqMessages(thread as GroqThreadState)
      : encodeGeminiContents(thread as GeminiThreadState);

  return {
    provider,
    registryKey: candidate.registryKey,
    apiModelId: candidate.apiModelId,
    systemInstruction: requestConfig.systemInstruction,
    providerMessages: cloneJson(providerMessages),
    tools: options.tools as LlmFunctionDeclaration[] | undefined,
    functionCallingMode: options.functionCallingMode,
    maxOutputTokens: requestConfig.maxOutputTokens,
    thinkingConfig: requestConfig.thinkingConfig,
    toolsConfig: requestConfig.toolsConfig,
    structuredConfig: requestConfig.structuredConfig,
  };
}
