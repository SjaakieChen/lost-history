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

  LlmProviderRequestSnapshot,

  SpeedTier,

  ThinkingPower,

} from '../../shared/gemini-types.js';
import { buildProviderRequestSnapshot } from '../llm/provider-request-snapshot.js';

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
import {
  assertResolvedModelSupportsCapabilities,
  CallLlmValidationError,
  resolveCallCapabilities,
  validateCallLlmOptions,
  type CapabilityActivation,
} from '../llm/call-capabilities.js';
import { generateWithGroq } from '../groq/generate.js';
import { getGroqApiKey } from '../config.js';
import { parseGeminiGroundingMetadata } from './grounding.js';
import { buildTranscriptTurnFromResult } from '../llm/conversation/transcript.js';

export { CallLlmValidationError, LlmCapabilityError };

/** Server-only options (thread state is not accepted over HTTP). */
export interface InternalCallLlmOptions extends CallLlmOptions {
  threadState?: ProviderThreadState;
  /** Portable messages used to rebuild thread when provider changes during failover. */
  threadRebuildMessages?: ChatMessage[];
  /** Shared exhaustion cache for callLlmAgent / LlmSession; created per call when omitted. */
  exhaustionContext?: ExhaustionContext;
  /** Capture native provider request payload on this call (dev debug). */
  captureProviderRequest?: boolean;
  /** Resolved specialist activation (set by callLlm). */
  capabilityActivation?: CapabilityActivation;
}

export interface InternalCallLlmResult extends CallLlmResult {
  threadState?: ProviderThreadState;
  providerRequest?: LlmProviderRequestSnapshot;
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



function buildGeminiToolsConfig(
  options: CallLlmOptions,
  activation: CapabilityActivation,
): Record<string, unknown> | undefined {
  const toolEntries: Record<string, unknown>[] = [];

  if (activation.webSearch) {
    toolEntries.push({ googleSearch: {} });
  }

  if (activation.tools && options.tools?.length) {
    toolEntries.push({
      functionDeclarations: normalizeToolDeclarations(options.tools),
    });
  }

  if (toolEntries.length === 0) {
    return undefined;
  }

  const config: Record<string, unknown> = { tools: toolEntries };

  if (activation.tools && options.functionCallingMode) {
    config.toolConfig = {
      functionCallingConfig: { mode: mapFunctionCallingMode(options.functionCallingMode) },
    };
  }

  return config;
}

function buildRequestConfig(

  options: CallLlmOptions,

  resolved: ResolvedTextModel,

  thinkingPower: ThinkingPower,

  activation: CapabilityActivation,

): BuiltRequestConfig {

  if (activation.tools) {
    assertCapability(resolved.info, 'functionCalling');
  }

  if (activation.webSearch) {
    assertCapability(resolved.info, 'webSearch');
  }

  if (activation.codeExecution) {
    assertCapability(resolved.info, 'codeExecution');
  }

  if (activation.structuredJson) {
    assertCapability(resolved.info, 'structuredOutput');
  }

  if (activation.strictJson) {
    assertCapability(resolved.info, 'strictJson');
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



  const toolsConfig = buildGeminiToolsConfig(options, activation);
  if (toolsConfig) {
    config.toolsConfig = toolsConfig;
  }



  if (activation.structuredJson && options.structuredOutput) {

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

function resolveUserPromptForTranscript(options: InternalCallLlmOptions): string {
  if (options.prompt?.trim()) {
    return options.prompt.trim();
  }
  const history = options.messages ?? options.threadRebuildMessages;
  if (!history?.length) {
    return '';
  }
  const lastUser = [...history].reverse().find((message) => message.role === 'user');
  return lastUser?.content?.trim() ?? '';
}

function attachTranscriptToResult(
  result: InternalCallLlmResult,
  options: InternalCallLlmOptions,
): InternalCallLlmResult {
  const userPrompt = resolveUserPromptForTranscript(options);
  if (!userPrompt) {
    return result;
  }
  return {
    ...result,
    messages: buildTranscriptTurnFromResult({ userPrompt, result }),
  };
}

function buildGroqResult(
  groqResult: Awaited<ReturnType<typeof generateWithGroq>>,
  resolved: ResolvedTextModel,
  metadata: ModelSelectionMetadata,
  options: InternalCallLlmOptions,
  threadState?: ProviderThreadState,
): InternalCallLlmResult {
  const base: InternalCallLlmResult = {
    text: groqResult.text,
    thoughts: groqResult.thoughts,
    functionCalls: groqResult.functionCalls,
    executedTools: groqResult.executedTools,
    model: groqResult.model,
    registryKey: resolved.registryKey,
    thinkingUsed: Boolean(groqResult.thoughts?.trim()),
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
  return attachTranscriptToResult(base, options);
}



function buildResult(
  response: GenerateContentResponse,
  resolved: ResolvedTextModel,
  thinkingPower: ThinkingPower,
  thinkingConfig: ReturnType<typeof buildThinkingConfig>,
  metadata: ModelSelectionMetadata,
  options: InternalCallLlmOptions,
  activation: CapabilityActivation,
  threadState?: ProviderThreadState,
): InternalCallLlmResult {
  const { text, thoughts, functionCalls } = parseResponseParts(response);
  const candidate = response.candidates?.[0] as Record<string, unknown> | undefined;
  const executedTools = activation.webSearch
    ? parseGeminiGroundingMetadata(candidate)
    : undefined;

  const base: InternalCallLlmResult = {
    text: text || 'No response text received.',
    thoughts,
    functionCalls,
    executedTools,
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
  return attachTranscriptToResult(base, options);
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
  const providerRequest = options.captureProviderRequest
    ? buildProviderRequestSnapshot(candidate, thread, requestConfig, options)
    : undefined;

  if (provider === 'groq') {
    if (thread.provider !== 'groq') {
      throw new Error('Groq model requires Groq thread state.');
    }
    const groqResult = await generateWithGroq(
      candidate,
      options,
      encodeGroqMessages(thread),
      exhaustionCtx,
      options.capabilityActivation,
    );
    if (groqResult.assistantMessage) {
      appendGroqAssistantMessage(thread, groqResult.assistantMessage);
    }
    const groqBuilt = buildGroqResult(groqResult, candidate, metadata, options, thread);
    return providerRequest ? { ...groqBuilt, providerRequest } : groqBuilt;
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
  const geminiBuilt = buildResult(
    response,
    candidate,
    thinkingPower,
    requestConfig.thinkingConfig,
    metadata,
    options,
    options.capabilityActivation ?? {
      tools: false,
      webSearch: false,
      codeExecution: false,
      structuredJson: false,
      strictJson: false,
    },
    thread,
  );
  return providerRequest ? { ...geminiBuilt, providerRequest } : geminiBuilt;
}



export async function callLlm(options: InternalCallLlmOptions): Promise<InternalCallLlmResult> {
  if (!options.threadState && !options.prompt?.trim() && !options.messages?.length) {
    throw new Error('Either prompt or messages is required.');
  }

  validateCallLlmOptions(options);
  const resolvedCapabilities = resolveCallCapabilities(options);
  const callOptions: InternalCallLlmOptions = {
    ...options,
    capabilityActivation: resolvedCapabilities.activation,
  };

  const exhaustionCtx = callOptions.exhaustionContext ?? createExhaustionContext();

  const requestedTier = resolveRequestedSpeedTier(callOptions);
  const modelsAttempted: string[] = [];
  const candidateOptions = resolvedCapabilities.candidateFilters;

  let lastError: unknown;
  const allCandidatesForError: ResolvedTextModel[] = [];
  const allReachableKeys = new Set<string>();
  let preferredCandidate: ResolvedTextModel | undefined;
  let usedPreferredFailover = false;

  if (callOptions.model?.trim()) {
    preferredCandidate = resolveTextModel(callOptions.model.trim());
    assertResolvedModelSupportsCapabilities(
      preferredCandidate,
      resolvedCapabilities.activation,
    );
    if (!modelsAttempted.includes(preferredCandidate.registryKey)) {
      modelsAttempted.push(preferredCandidate.registryKey);
    }

    try {
      const requestConfig = buildRequestConfig(
        callOptions,
        preferredCandidate,
        preferredCandidate.info.bakedThinkingPower,
        resolvedCapabilities.activation,
      );
      return await executeResolvedCall(
        preferredCandidate,
        callOptions,
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
    callOptions,
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
        requestConfig = buildRequestConfig(
          callOptions,
          candidate,
          thinkingPower,
          resolvedCapabilities.activation,
        );
      } catch (error) {
        lastError = error;
        continue;
      }

      try {
        const result = await executeResolvedCall(
          candidate,
          callOptions,
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



  validateCallLlmOptions(options);
  const { candidateFilters } = resolveCallCapabilities(options);
  const tier = resolveRequestedSpeedTier(options);
  const candidates = iterateSpeedTierBatchesForFailover(
    options,
    candidateFilters,
    tier,
  ).next().value?.candidates ?? [];

  if (candidates.length > 0) {
    return candidates[0].registryKey;
  }

  return getDefaultModelId();
}



export type { CallLlmOptions, CallLlmResult, ChatMessage, LlmFunctionCall };


