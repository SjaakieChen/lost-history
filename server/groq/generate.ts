import type OpenAI from 'openai';

import type {

  ChatCompletionCreateParamsNonStreaming,

  ChatCompletionMessageParam,

  ChatCompletionTool,

} from 'openai/resources/chat/completions.js';

import type { CallLlmOptions, GenerateTextUsage, LlmFunctionCall, TextModelInfo } from '../../shared/gemini-types.js';

import type { ExhaustionContext } from '../gemini/availability.js';

import type { ResolvedTextModel } from '../gemini/models.js';

import { withRateLimitAndRetry, isQuotaOrRateLimitError } from '../gemini/rate-limit.js';

import type { CapabilityActivation } from '../llm/call-capabilities.js';

import { normalizeToolParameters } from '../llm/tool-schema.js';

import { getGroqClient } from './client.js';

import {

  asGroqMessage,

  isCompoundRegistryKey,

  isGptOssApiModel,

  parseGroqExecutedTools,

  sanitizeGroqMessagesForApi,

} from './groq-message.js';



export interface GroqGenerateResult {

  text: string;

  thoughts?: string;

  functionCalls?: LlmFunctionCall[];

  executedTools?: import('../../shared/gemini-types.js').LlmExecutedTool[];

  model: string;

  finishReason?: string;

  usage?: GenerateTextUsage;

  assistantMessage?: OpenAI.Chat.Completions.ChatCompletionMessage;

}



function mapFunctionTools(options: CallLlmOptions): ChatCompletionTool[] {

  if (!options.tools?.length) {

    return [];

  }



  return options.tools.map((tool) => ({

    type: 'function' as const,

    function: {

      name: tool.name,

      description: tool.description,

      parameters: normalizeToolParameters(tool.parameters),

    },

  }));

}



function buildGroqTools(

  options: CallLlmOptions,

  resolved: ResolvedTextModel,

  activation: CapabilityActivation,

): ChatCompletionTool[] | undefined {

  const tools: ChatCompletionTool[] = mapFunctionTools(options);



  if (

    activation.codeExecution &&

    isGptOssApiModel(resolved.apiModelId) &&

    !isCompoundRegistryKey(resolved.registryKey)

  ) {

    tools.push({ type: 'code_interpreter' } as ChatCompletionTool);

  }



  return tools.length > 0 ? tools : undefined;

}



function resolveGroqToolChoice(

  options: CallLlmOptions,

  tools: ChatCompletionTool[] | undefined,

  resolved: ResolvedTextModel,

  activation: CapabilityActivation,

): ChatCompletionCreateParamsNonStreaming['tool_choice'] | undefined {

  if (!tools?.length) {

    return undefined;

  }



  const hasCodeInterpreter = tools.some(

    (tool) => (tool as { type?: string }).type === 'code_interpreter',

  );

  const hasFunctionTools = tools.some((tool) => tool.type === 'function');



  if (hasCodeInterpreter && !hasFunctionTools && activation.codeExecution) {

    return 'required';

  }



  if (options.functionCallingMode === 'NONE') {

    return 'none';

  }

  if (options.functionCallingMode === 'ANY') {

    return 'required';

  }

  return 'auto';

}



function mapFunctionCalls(

  message: OpenAI.Chat.Completions.ChatCompletionMessage,

): LlmFunctionCall[] | undefined {

  if (!message.tool_calls?.length) {

    return undefined;

  }



  return message.tool_calls

    .filter((call) => call.type === 'function')

    .map((call) => ({

      id: call.id,

      name: call.function.name,

      args: call.function.arguments

        ? (JSON.parse(call.function.arguments) as Record<string, unknown>)

        : {},

    }));

}



function resolveStructuredSchema(

  structuredOutput: CallLlmOptions['structuredOutput'],

): Record<string, unknown> | undefined {

  if (!structuredOutput) {

    return undefined;

  }

  const schema = structuredOutput.responseJsonSchema ?? structuredOutput.responseSchema;

  if (!schema || typeof schema !== 'object') {

    return undefined;

  }

  return schema as Record<string, unknown>;

}



/** Maps `structuredOutput` to Groq `response_format` (strict only when activation requests it). */

export function buildGroqResponseFormat(

  options: CallLlmOptions,

  info: Pick<TextModelInfo, 'supportsStructuredOutput' | 'supportsStrictJson'>,

  activation: Pick<CapabilityActivation, 'structuredJson' | 'strictJson'> = {

    structuredJson: false,

    strictJson: false,

  },

): ChatCompletionCreateParamsNonStreaming['response_format'] | undefined {

  if (!options.structuredOutput || !activation.structuredJson) {

    return undefined;

  }



  const schema = resolveStructuredSchema(options.structuredOutput);



  if (activation.strictJson && info.supportsStrictJson && schema) {

    return {

      type: 'json_schema',

      json_schema: {

        name: 'structured_output',

        strict: true,

        schema,

      },

    };

  }



  if (info.supportsStructuredOutput && schema) {

    return {

      type: 'json_schema',

      json_schema: {

        name: 'structured_output',

        strict: false,

        schema,

      },

    };

  }



  if (info.supportsStructuredOutput || info.supportsStrictJson) {

    return { type: 'json_object' };

  }



  return undefined;

}



export async function generateWithGroq(

  resolved: ResolvedTextModel,

  options: CallLlmOptions,

  messages: ChatCompletionMessageParam[],

  exhaustionCtx?: ExhaustionContext,

  activation: CapabilityActivation = {

    tools: false,

    webSearch: false,

    codeExecution: false,

    structuredJson: false,

    strictJson: false,

  },

): Promise<GroqGenerateResult> {

  const { apiModelId, info, registryKey } = resolved;

  const client = getGroqClient();

  const tools = buildGroqTools(options, resolved, activation);

  const outboundMessages = sanitizeGroqMessagesForApi(messages, apiModelId);



  const response = await withRateLimitAndRetry(

    registryKey,

    info.rateLimitHints,

    () =>

      client.chat.completions.create({

        model: apiModelId,

        messages: outboundMessages,

        max_tokens: options.maxOutputTokens,

        tools: tools?.length ? tools : undefined,

        tool_choice: resolveGroqToolChoice(options, tools, resolved, activation),

        response_format: buildGroqResponseFormat(options, info, activation),

      }),

    exhaustionCtx,

  );



  const choice = response.choices[0];

  const message = choice?.message;

  const groqMessage = asGroqMessage(message);

  const text = message?.content?.trim() ?? '';

  const thoughts = groqMessage?.reasoning?.trim() || undefined;

  const executedTools = parseGroqExecutedTools(groqMessage?.executed_tools);



  return {

    text: text || 'No response text received.',

    thoughts,

    functionCalls: message ? mapFunctionCalls(message) : undefined,

    executedTools,

    model: response.model ?? apiModelId,

    finishReason: choice?.finish_reason ?? undefined,

    usage: response.usage

      ? {

          promptTokens: response.usage.prompt_tokens,

          candidatesTokens: response.usage.completion_tokens,

          totalTokens: response.usage.total_tokens,

        }

      : undefined,

    assistantMessage: message,

  };

}



export async function pingGroqModel(apiModelId: string): Promise<boolean> {

  try {

    const client = getGroqClient();

    await client.chat.completions.create({

      model: apiModelId,

      messages: [{ role: 'user', content: 'hi' }],

      max_tokens: 1,

    });

    return true;

  } catch (error) {

    if (isQuotaOrRateLimitError(error)) {

      return false;

    }

    const status = (error as { status?: number }).status;

    const message = error instanceof Error ? error.message : String(error);

    if (status === 404 || /not found|does not exist/i.test(message)) {

      return false;

    }

    throw error;

  }

}


