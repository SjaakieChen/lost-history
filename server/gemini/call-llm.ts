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

  LlmContentBlock,

  LlmFunctionCall,

  ThinkingPower,

  ThinkingPowerTier,

} from '../../shared/gemini-types.js';

import { buildNoReachableModelsError, markExhausted, pingAllModels, isExhausted } from './availability.js';

import { getGenAIClient } from './client.js';

import {
  assertCapability,
  getDefaultModelId,
  LlmCapabilityError,
  resolveTextModel,
  type ResolvedTextModel,
} from './models.js';

import {
  collectModelCandidates,
  isTierDowngraded,
  resolveRequestedTier,
} from './model-selection.js';

import { formatQuotaError, GeminiQuotaError, isQuotaOrRateLimitError, parseQuotaErrorDetails, withRateLimitAndRetry } from './rate-limit.js';

import { buildThinkingConfig, isThinkingApplied } from './thinking.js';

export { LlmCapabilityError };



function resolveThinkingPower(options: CallLlmOptions): ThinkingPower {

  return options.thinkingPower ?? 'off';

}



function resolveSystemInstruction(options: CallLlmOptions): string | undefined {

  const fromMessages = options.messages?.find((message) => message.role === 'system')?.content;

  return options.systemInstruction?.trim() || fromMessages?.trim() || undefined;

}



export function buildLlmContents(options: CallLlmOptions): string | Content[] {

  if (options.contents?.length) {

    return options.contents as Content[];

  }



  if (options.messages?.length) {

    return options.messages

      .filter((message) => message.role !== 'system')

      .map((message) => ({

        role: message.role === 'assistant' ? 'model' : 'user',

        parts: [{ text: message.content }],

      }));

  }



  if (options.prompt?.trim()) {

    return options.prompt.trim();

  }



  throw new Error('Either contents, prompt, or messages is required.');

}



export function normalizeLlmContentsToArray(contents: string | Content[]): Content[] {

  if (typeof contents === 'string') {

    return [{ role: 'user', parts: [{ text: contents }] }];

  }

  return contents;

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



function toModelContent(response: GenerateContentResponse): LlmContentBlock | undefined {

  const content = response.candidates?.[0]?.content;

  if (!content) {

    return undefined;

  }



  return {

    role: content.role as LlmContentBlock['role'],

    parts: content.parts as LlmContentBlock['parts'],

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



export function buildFunctionResponseContent(

  name: string,

  response: Record<string, unknown>,

  id?: string,

): LlmContentBlock {

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



interface BuiltRequestConfig {

  systemInstruction?: string;

  temperature?: number;

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

    temperature: options.temperature,

    maxOutputTokens: options.maxOutputTokens,

    thinkingConfig,

  };



  if (options.tools?.length) {

    config.toolsConfig = {

      tools: [{ functionDeclarations: options.tools }],

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

): Promise<GenerateContentResponse> {

  const { apiModelId, info, registryKey } = resolved;



  if (!info.freeTierAvailable) {

    console.warn(

      `Model "${registryKey}" may have 0 free-tier quota. The request may fail with a quota error.`,

    );

  }



  const ai = getGenAIClient();



  return withRateLimitAndRetry(registryKey, info.rateLimitHints, () =>

    ai.models.generateContent({

      model: apiModelId,

      contents,

      config: {

        systemInstruction: requestConfig.systemInstruction,

        temperature: requestConfig.temperature,

        maxOutputTokens: requestConfig.maxOutputTokens,

        thinkingConfig: requestConfig.thinkingConfig,

        ...requestConfig.toolsConfig,

        ...requestConfig.structuredConfig,

      },

    }),

  );

}



function buildResult(

  response: GenerateContentResponse,

  resolved: ResolvedTextModel,

  thinkingPower: ThinkingPower,

  thinkingConfig: ReturnType<typeof buildThinkingConfig>,

  metadata: {

    requestedTier: ThinkingPowerTier;

    modelsAttempted: string[];

    modelSelectedBy: 'explicit' | 'tier';

  },

): CallLlmResult {

  const { text, thoughts, functionCalls } = parseResponseParts(response);



  return {

    text: text || 'No response text received.',

    thoughts,

    functionCalls,

    modelContent: toModelContent(response),

    model: response.modelVersion?.replace(/^models\//, '') || resolved.apiModelId,

    thinkingUsed: isThinkingApplied(thinkingConfig),

    thinkingPowerApplied: thinkingPower,

    finishReason: response.candidates?.[0]?.finishReason,

    usage: mapUsage(response),

    thinkingPowerTierRequested: metadata.requestedTier,

    thinkingPowerTierUsed: resolved.tier,

    tierDowngraded: isTierDowngraded(metadata.requestedTier, resolved.tier),

    modelsAttempted: metadata.modelsAttempted,

    modelSelectedBy: metadata.modelSelectedBy,

  };

}



export async function callLlm(options: CallLlmOptions): Promise<CallLlmResult> {

  const thinkingPower = resolveThinkingPower(options);

  const contents = buildLlmContents(options);

  const requestedTier = resolveRequestedTier(options);

  const explicitModel = Boolean(options.model?.trim());

  const modelsAttempted: string[] = [];



  const candidateOptions = {

    requireFunctionCalling: Boolean(options.tools?.length),

    requireStructuredOutput: Boolean(options.structuredOutput),

  };



  let lastError: unknown;

  const allCandidates = collectModelCandidates(options, candidateOptions);
  const reachableKeys = await pingAllModels(
    allCandidates.map((candidate) => ({
      apiModelId: candidate.apiModelId,
      registryKey: candidate.registryKey,
      rateLimitHints: candidate.info.rateLimitHints,
    })),
  );

  const candidates = allCandidates.filter((candidate) =>
    reachableKeys.has(candidate.registryKey),
  );

  if (candidates.length === 0) {
    const locallyExhausted = allCandidates
      .filter((candidate) => isExhausted(candidate.registryKey))
      .map((candidate) => candidate.registryKey);
  // #region agent log
  fetch('http://127.0.0.1:7631/ingest/130840d0-116a-49e4-9207-dfd55fe50a73',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ae9da3'},body:JSON.stringify({sessionId:'ae9da3',hypothesisId:'H4',location:'call-llm.ts:callLlm',message:'zero reachable candidates',data:{explicitModel,requestedTier,allCandidateKeys:allCandidates.map((c)=>c.registryKey),reachableKeys:[...reachableKeys],locallyExhausted,hasTools:Boolean(options.tools?.length)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
    throw buildNoReachableModelsError({
      explicitModel,
      requestedTier,
      allCandidates,
      reachableKeys,
    });
  }

  for (const candidate of candidates) {

    modelsAttempted.push(candidate.registryKey);



    let requestConfig: BuiltRequestConfig;

    try {

      requestConfig = buildRequestConfig(options, candidate, thinkingPower);

    } catch (error) {

      if (explicitModel) {

        throw error;

      }

      lastError = error;

      continue;

    }



    try {

      const response = await executeOnModel(candidate, contents, requestConfig);



      return buildResult(response, candidate, thinkingPower, requestConfig.thinkingConfig, {

        requestedTier,

        modelsAttempted,

        modelSelectedBy: explicitModel ? 'explicit' : 'tier',

      });

    } catch (error) {

      lastError = error;

      const isQuotaFailure =
        error instanceof GeminiQuotaError || isQuotaOrRateLimitError(error);

      if (explicitModel) {
        if (error instanceof GeminiQuotaError) {
          throw error;
        }
        if (isQuotaOrRateLimitError(error)) {
          throw formatQuotaError(candidate.registryKey, error, candidate.info.rateLimitHints);
        }
        throw error;
      }

      if (isQuotaFailure) {
        const parsed = parseQuotaErrorDetails(error);
        markExhausted(
          candidate.registryKey,
          candidate.info.rateLimitHints,
          parsed.retryAfterMs,
          'generate:429',
          parsed.dailyQuotaExhausted,
        );
        continue;
      }

      throw error;
    }

  }



  if (lastError instanceof GeminiQuotaError) {

    throw lastError;

  }



  if (lastError instanceof LlmCapabilityError) {

    throw lastError;

  }



  if (lastError instanceof Error) {

    throw new GeminiQuotaError(

      `All models exhausted for tier "${requestedTier}". Attempted: ${modelsAttempted.join(', ') || 'none'}. ${lastError.message}`,

      modelsAttempted.at(-1) ?? requestedTier,

    );

  }



  throw new GeminiQuotaError(

    `All models exhausted for tier "${requestedTier}". Attempted: ${modelsAttempted.join(', ') || 'none'}.`,

    modelsAttempted.at(-1) ?? requestedTier,

  );

}



/** Resolve model id from explicit model or default. */

export function resolveCallModel(options: CallLlmOptions): string {

  if (options.model?.trim()) {

    return resolveTextModel(options.model.trim()).registryKey;

  }



  const candidates = collectModelCandidates(options, {
    requireFunctionCalling: Boolean(options.tools?.length),
    requireStructuredOutput: Boolean(options.structuredOutput),
  });

  if (candidates.length > 0) {
    return candidates[0].registryKey;
  }



  return getDefaultModelId();

}



export type { CallLlmOptions, CallLlmResult, ChatMessage, LlmContentBlock, LlmFunctionCall };


