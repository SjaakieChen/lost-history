import {

  FunctionCallingConfigMode,

  type Content,

  type GenerateContentResponse,

} from '@google/genai';

import type {

  CallLlmOptions,

  CallLlmResult,

  ChatMessage,

  GenerateTextUsage,

  LlmFunctionCall,

  SpeedTier,

  ThinkingPower,

} from '../../shared/gemini-types.js';

import {
  buildNoReachableModelsError,
  createExhaustionContext,
  type ExhaustionContext,
  markExhausted,
  pingAllModels,
} from './availability.js';
import {
  isPolicyBlockedError,
  isRecoverableLlmFailure,
  logPolicyBlocked,
} from './failure-policy.js';

import { getGenAIClient } from './client.js';

import {
  assertCapability,
  getDefaultModelId,
  LlmCapabilityError,
  resolveTextModel,
  type ResolvedTextModel,
} from './models.js';

import {
  iterateSpeedTierBatchesForFailover,
  isSpeedTierDowngraded,
  resolveRequestedSpeedTier,
} from './model-selection.js';

import { formatQuotaError, GeminiQuotaError, isQuotaOrRateLimitError, parseQuotaErrorDetails, withRateLimitAndRetry } from './rate-limit.js';

import { buildThinkingConfig, isThinkingApplied } from './thinking.js';
import { normalizeToolDeclarations } from '../llm/tool-schema.js';
import {
  appendGeminiModelResponse,
  createThreadState,
  encodeGeminiContents,
  encodeGroqMessages,
  appendGroqAssistantMessage,
  type ProviderThreadState,
} from '../llm/conversation/index.js';
import { generateWithGroq } from '../groq/generate.js';
import { getGroqApiKey } from '../config.js';

export { LlmCapabilityError };

/** Server-only options (thread state is not accepted over HTTP). */
export interface InternalCallLlmOptions extends CallLlmOptions {
  threadState?: ProviderThreadState;
  /** Portable messages used to rebuild thread when provider changes during failover. */
  threadRebuildMessages?: ChatMessage[];
  /** Shared exhaustion cache for callLlmAgent / LlmSession; created per call when omitted. */
  exhaustionContext?: ExhaustionContext;
}

export interface InternalCallLlmResult extends CallLlmResult {
  threadState?: ProviderThreadState;
}



function resolveSystemInstruction(options: CallLlmOptions): string | undefined {

  const fromMessages = options.messages?.find((message) => message.role === 'system')?.content;

  return options.systemInstruction?.trim() || fromMessages?.trim() || undefined;

}



function resolveThreadForCall(
  candidate: ResolvedTextModel,
  options: InternalCallLlmOptions,
): ProviderThreadState {
  const provider = candidate.info.provider ?? 'gemini';

  if (options.threadState) {
    if (options.threadState.provider === provider) {
      return options.threadState;
    }
    const rebuildFrom = options.threadRebuildMessages ?? options.messages;
    if (rebuildFrom?.length || options.prompt?.trim()) {
      return createThreadState(candidate, {
        messages: rebuildFrom,
        prompt: options.threadState ? undefined : options.prompt,
        systemInstruction: options.systemInstruction,
      });
    }
    throw new Error(
      `threadState provider "${options.threadState.provider}" does not match model provider "${provider}" and no rebuild messages were provided.`,
    );
  }

  return createThreadState(candidate, options);
}

function handleRecoverableFailure(
  candidate: ResolvedTextModel,
  error: unknown,
  exhaustionCtx: ExhaustionContext,
): void {
  if (isPolicyBlockedError(error)) {
    logPolicyBlocked(candidate.registryKey, error);
  }

  if (error instanceof GeminiQuotaError || isQuotaOrRateLimitError(error)) {
    const parsed = parseQuotaErrorDetails(error);
    markExhausted(
      candidate.registryKey,
      candidate.info.rateLimitHints,
      parsed.retryAfterMs,
      'generate:429',
      parsed.dailyQuotaExhausted,
      exhaustionCtx,
    );
  }
}

function mapUsage(response: GenerateContentResponse): GenerateTextUsage | undefined {

  const usage = response.usageMetadata;

  if (!usage) {

    return undefined;

  }



  return {

    promptTokens: usage.promptTokenCount,

    candidatesTokens: usage.candidatesTokenCount,

    totalTokens: usage.totalTokenCount,

    thoughtsTokens: usage.thoughtsTokenCount,

  };

}



function parseResponseParts(response: GenerateContentResponse): {

  text: string;

  thoughts?: string;

  functionCalls?: LlmFunctionCall[];

} {

  const parts = response.candidates?.[0]?.content?.parts ?? [];

  let text = '';

  let thoughts = '';

  const functionCalls: LlmFunctionCall[] = [];



  for (const part of parts) {

    if (part.functionCall?.name) {

      functionCalls.push({

        id: part.functionCall.id,

        name: part.functionCall.name,

        args: (part.functionCall.args as Record<string, unknown> | undefined) ?? {},

      });

      continue;

    }



    if (!part.text) {

      continue;

    }



    if (part.thought) {

      thoughts += thoughts ? `\n${part.text}` : part.text;

    } else {

      text += part.text;

    }

  }



  if (!text && response.text) {

    text = response.text;

  }



  return {

    text,

    thoughts: thoughts || undefined,

    functionCalls: functionCalls.length > 0 ? functionCalls : undefined,

  };

}



function mapFunctionCallingMode(

  mode: CallLlmOptions['functionCallingMode'],

): FunctionCallingConfigMode | undefined {

  if (!mode) {

    return undefined;

  }



  return FunctionCallingConfigMode[mode];

}



interface BuiltRequestConfig {

  systemInstruction?: string;

  maxOutputTokens?: number;

  thinkingConfig: ReturnType<typeof buildThinkingConfig>;

  toolsConfig?: Record<string, unknown>;

  structuredConfig?: Record<string, unknown>;

}



function buildRequestConfig(

  options: CallLlmOptions,

  resolved: ResolvedTextModel,

  thinkingPower: ThinkingPower,

): BuiltRequestConfig {

  if (options.tools?.length) {

    assertCapability(resolved.info, 'functionCalling');

  }



  if (options.structuredOutput) {

    assertCapability(resolved.info, 'structuredOutput');

  }



  const thinkingConfig = buildThinkingConfig(

    resolved.info.thinkingMode,

    thinkingPower,

    options.includeThoughts,

  );



  const config: BuiltRequestConfig = {

    systemInstruction: resolveSystemInstruction(options),

    maxOutputTokens: options.maxOutputTokens,

    thinkingConfig,

  };



  if (options.tools?.length) {

    config.toolsConfig = {

      tools: [{ functionDeclarations: normalizeToolDeclarations(options.tools) }],

      toolConfig: options.functionCallingMode

        ? { functionCallingConfig: { mode: mapFunctionCallingMode(options.functionCallingMode) } }

        : undefined,

    };

  }



  if (options.structuredOutput) {

    config.structuredConfig = {

      responseMimeType: 'application/json',

      ...(options.structuredOutput.responseJsonSchema !== undefined

        ? { responseJsonSchema: options.structuredOutput.responseJsonSchema }

        : options.structuredOutput.responseSchema !== undefined

          ? { responseSchema: options.structuredOutput.responseSchema }

          : {}),

    };

  }



  return config;

}



async function executeOnModel(

  resolved: ResolvedTextModel,

  contents: string | Content[],

  requestConfig: BuiltRequestConfig,

  exhaustionCtx: ExhaustionContext,

): Promise<GenerateContentResponse | 'groq'> {

  const { apiModelId, info, registryKey } = resolved;

  const provider = info.provider ?? 'gemini';



  if (provider === 'groq') {

    if (!getGroqApiKey()) {

      throw new Error('Add GROQ_API_KEY to .env to use Groq models.');

    }

    return 'groq';

  }



  if (!info.freeTierAvailable) {

    console.warn(

      `Model "${registryKey}" may have 0 free-tier quota. The request may fail with a quota error.`,

    );

  }



  const ai = getGenAIClient();



  return withRateLimitAndRetry(
    registryKey,
    info.rateLimitHints,
    () =>
      ai.models.generateContent({
        model: apiModelId,
        contents,
        config: {
          systemInstruction: requestConfig.systemInstruction,
          maxOutputTokens: requestConfig.maxOutputTokens,
          thinkingConfig: requestConfig.thinkingConfig,
          ...requestConfig.toolsConfig,
          ...requestConfig.structuredConfig,
        },
      }),
    exhaustionCtx,
  );
}



type ModelSelectionMetadata = {
  requestedTier: SpeedTier;
  modelsAttempted: string[];
  modelSelectedBy: CallLlmResult['modelSelectedBy'];
};

function buildGroqResult(
  groqResult: Awaited<ReturnType<typeof generateWithGroq>>,
  resolved: ResolvedTextModel,
  metadata: ModelSelectionMetadata,
  threadState?: ProviderThreadState,
): InternalCallLlmResult {
  return {
    text: groqResult.text,
    functionCalls: groqResult.functionCalls,
    model: groqResult.model,
    registryKey: resolved.registryKey,
    thinkingUsed: false,
    thinkingPowerApplied: resolved.info.bakedThinkingPower,
    finishReason: groqResult.finishReason,
    usage: groqResult.usage,
    speedTierRequested: metadata.requestedTier,
    speedTierUsed: resolved.tier,
    speedTierDowngraded: isSpeedTierDowngraded(metadata.requestedTier, resolved.tier),
    modelsAttempted: metadata.modelsAttempted,
    modelSelectedBy: metadata.modelSelectedBy,
    threadState,
  };
}



function buildResult(
  response: GenerateContentResponse,
  resolved: ResolvedTextModel,
  thinkingPower: ThinkingPower,
  thinkingConfig: ReturnType<typeof buildThinkingConfig>,
  metadata: ModelSelectionMetadata,
  threadState?: ProviderThreadState,
): InternalCallLlmResult {
  const { text, thoughts, functionCalls } = parseResponseParts(response);

  return {
    text: text || 'No response text received.',
    thoughts,
    functionCalls,
    model: response.modelVersion?.replace(/^models\//, '') || resolved.apiModelId,
    registryKey: resolved.registryKey,
    thinkingUsed: isThinkingApplied(thinkingConfig),
    thinkingPowerApplied: thinkingPower,
    finishReason: response.candidates?.[0]?.finishReason,
    usage: mapUsage(response),
    speedTierRequested: metadata.requestedTier,
    speedTierUsed: resolved.tier,
    speedTierDowngraded: isSpeedTierDowngraded(metadata.requestedTier, resolved.tier),
    modelsAttempted: metadata.modelsAttempted,
    modelSelectedBy: metadata.modelSelectedBy,
    threadState,
  };
}

async function executeResolvedCall(
  candidate: ResolvedTextModel,
  options: InternalCallLlmOptions,
  requestConfig: BuiltRequestConfig,
  metadata: ModelSelectionMetadata,
  exhaustionCtx: ExhaustionContext,
): Promise<InternalCallLlmResult> {
  const thinkingPower = candidate.info.bakedThinkingPower;
  const thread = resolveThreadForCall(candidate, options);
  const provider = candidate.info.provider ?? 'gemini';

  if (provider === 'groq') {
    if (thread.provider !== 'groq') {
      throw new Error('Groq model requires Groq thread state.');
    }
    const groqResult = await generateWithGroq(
      candidate,
      options,
      encodeGroqMessages(thread),
      exhaustionCtx,
    );
    if (groqResult.assistantMessage) {
      appendGroqAssistantMessage(thread, groqResult.assistantMessage);
    }
    return buildGroqResult(groqResult, candidate, metadata, thread);
  }

  if (thread.provider !== 'gemini') {
    throw new Error('Gemini model requires Gemini thread state.');
  }

  const contents = encodeGeminiContents(thread);
  const response = await executeOnModel(candidate, contents, requestConfig, exhaustionCtx);
  if (response === 'groq') {
    throw new Error('Unexpected Groq marker from Gemini execute path.');
  }
  appendGeminiModelResponse(thread, response);
  return buildResult(
    response,
    candidate,
    thinkingPower,
    requestConfig.thinkingConfig,
    metadata,
    thread,
  );
}



export async function callLlm(options: InternalCallLlmOptions): Promise<InternalCallLlmResult> {
  if (!options.threadState && !options.prompt?.trim() && !options.messages?.length) {
    throw new Error('Either prompt or messages is required.');
  }

  const exhaustionCtx = options.exhaustionContext ?? createExhaustionContext();

  const requestedTier = resolveRequestedSpeedTier(options);
  const modelsAttempted: string[] = [];
  const candidateOptions = {
    requireFunctionCalling: Boolean(options.tools?.length),
    requireStructuredOutput: Boolean(options.structuredOutput),
  };

  let lastError: unknown;
  const allCandidatesForError: ResolvedTextModel[] = [];
  const allReachableKeys = new Set<string>();
  let preferredCandidate: ResolvedTextModel | undefined;
  let usedPreferredFailover = false;

  if (options.model?.trim()) {
    preferredCandidate = resolveTextModel(options.model.trim());
    if (!modelsAttempted.includes(preferredCandidate.registryKey)) {
      modelsAttempted.push(preferredCandidate.registryKey);
    }

    try {
      const requestConfig = buildRequestConfig(
        options,
        preferredCandidate,
        preferredCandidate.info.bakedThinkingPower,
      );
      return await executeResolvedCall(
        preferredCandidate,
        options,
        requestConfig,
        {
          requestedTier,
          modelsAttempted: [...modelsAttempted],
          modelSelectedBy: 'explicit',
        },
        exhaustionCtx,
      );
    } catch (error) {
      lastError = error;
      if (error instanceof LlmCapabilityError) {
        throw error;
      }
      if (!isRecoverableLlmFailure(error)) {
        throw error;
      }
      handleRecoverableFailure(preferredCandidate, error, exhaustionCtx);
      usedPreferredFailover = true;
    }
  }

  const startTier = preferredCandidate?.info.speedTier ?? requestedTier;
  const skipRegistryKey = preferredCandidate?.registryKey;

  for (const { candidates: tierCandidates } of iterateSpeedTierBatchesForFailover(
    options,
    candidateOptions,
    startTier,
    skipRegistryKey,
    exhaustionCtx,
  )) {
    allCandidatesForError.push(...tierCandidates);

    const reachableKeys = await pingAllModels(
      tierCandidates.map((candidate) => ({
        apiModelId: candidate.apiModelId,
        registryKey: candidate.registryKey,
        rateLimitHints: candidate.info.rateLimitHints,
        provider: candidate.info.provider,
      })),
      exhaustionCtx,
    );

    for (const key of reachableKeys) {
      allReachableKeys.add(key);
    }

    const reachable = tierCandidates.filter((candidate) =>
      reachableKeys.has(candidate.registryKey),
    );

    if (reachable.length === 0) {
      continue;
    }

    for (const candidate of reachable) {
      modelsAttempted.push(candidate.registryKey);

      const thinkingPower = candidate.info.bakedThinkingPower;

      let requestConfig: BuiltRequestConfig;

      try {
        requestConfig = buildRequestConfig(options, candidate, thinkingPower);
      } catch (error) {
        lastError = error;
        continue;
      }

      try {
        const result = await executeResolvedCall(
          candidate,
          options,
          requestConfig,
          {
            requestedTier,
            modelsAttempted,
            modelSelectedBy: usedPreferredFailover ? 'preferred_failover' : 'tier',
          },
          exhaustionCtx,
        );
        return result;
      } catch (error) {
        lastError = error;

        if (error instanceof LlmCapabilityError) {
          throw error;
        }

        if (isRecoverableLlmFailure(error)) {
          handleRecoverableFailure(candidate, error, exhaustionCtx);
          continue;
        }

        throw error;
      }
    }
  }

  if (modelsAttempted.length === 0 && allCandidatesForError.length > 0) {
    throw buildNoReachableModelsError(
      {
        explicitModel: Boolean(preferredCandidate),
        requestedTier,
        allCandidates: allCandidatesForError,
        reachableKeys: allReachableKeys,
      },
      exhaustionCtx,
    );
  }

  if (lastError instanceof GeminiQuotaError) {

    throw lastError;

  }



  if (lastError instanceof LlmCapabilityError) {

    throw lastError;

  }



  if (lastError instanceof Error) {
    const exhaustedError = buildNoReachableModelsError(
      {
        explicitModel: Boolean(preferredCandidate),
        requestedTier,
        allCandidates: allCandidatesForError,
        reachableKeys: allReachableKeys,
      },
      exhaustionCtx,
    );
    throw new GeminiQuotaError(
      `All models exhausted for tier "${requestedTier}". Attempted: ${modelsAttempted.join(', ') || 'none'}. ${lastError.message}`,
      modelsAttempted.at(-1) ?? requestedTier,
      {
        failureKind: exhaustedError.failureKind,
        blockedModels: exhaustedError.blockedModels,
        retryAfterMs: exhaustedError.retryAfterMs,
      },
    );
  }

  throw buildNoReachableModelsError(
    {
      explicitModel: Boolean(preferredCandidate),
      requestedTier,
      allCandidates: allCandidatesForError,
      reachableKeys: allReachableKeys,
    },
    exhaustionCtx,
  );

}



/** Resolve model id from explicit model or default. */

export function resolveCallModel(options: CallLlmOptions): string {

  if (options.model?.trim()) {

    return resolveTextModel(options.model.trim()).registryKey;

  }

  if (!options.speedTier) {

    return getDefaultModelId();

  }



  const tier = resolveRequestedSpeedTier(options);
  const candidates = iterateSpeedTierBatchesForFailover(options, {
    requireFunctionCalling: Boolean(options.tools?.length),
    requireStructuredOutput: Boolean(options.structuredOutput),
  }, tier).next().value?.candidates ?? [];

  if (candidates.length > 0) {
    return candidates[0].registryKey;
  }

  return getDefaultModelId();
}



export type { CallLlmOptions, CallLlmResult, ChatMessage, LlmFunctionCall };


