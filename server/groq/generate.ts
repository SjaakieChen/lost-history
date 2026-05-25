import type OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions.js';
import type { CallLlmOptions, GenerateTextUsage, LlmFunctionCall } from '../../shared/gemini-types.js';
import type { ExhaustionContext } from '../gemini/availability.js';
import type { ResolvedTextModel } from '../gemini/models.js';
import { withRateLimitAndRetry, isQuotaOrRateLimitError } from '../gemini/rate-limit.js';
import { normalizeToolParameters } from '../llm/tool-schema.js';
import { getGroqClient } from './client.js';

export interface GroqGenerateResult {
  text: string;
  functionCalls?: LlmFunctionCall[];
  model: string;
  finishReason?: string;
  usage?: GenerateTextUsage;
  assistantMessage?: OpenAI.Chat.Completions.ChatCompletionMessage;
}

function mapTools(options: CallLlmOptions): ChatCompletionTool[] | undefined {
  if (!options.tools?.length) {
    return undefined;
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

function resolveToolChoice(
  options: CallLlmOptions,
  tools: ChatCompletionTool[] | undefined,
): 'none' | 'auto' | 'required' | undefined {
  if (!tools?.length) {
    return undefined;
  }
  if (options.functionCallingMode === 'NONE') {
    return 'none';
  }
  if (options.functionCallingMode === 'ANY') {
    return 'required';
  }
  return 'auto';
}

export async function generateWithGroq(
  resolved: ResolvedTextModel,
  options: CallLlmOptions,
  messages: ChatCompletionMessageParam[],
  exhaustionCtx?: ExhaustionContext,
): Promise<GroqGenerateResult> {
  const { apiModelId, info, registryKey } = resolved;
  const client = getGroqClient();
  const tools = mapTools(options);

  const response = await withRateLimitAndRetry(
    registryKey,
    info.rateLimitHints,
    () =>
      client.chat.completions.create({
        model: apiModelId,
        messages,
        max_tokens: options.maxOutputTokens,
        tools: tools?.length ? tools : undefined,
        tool_choice: resolveToolChoice(options, tools),
        response_format: options.structuredOutput ? { type: 'json_object' } : undefined,
      }),
    exhaustionCtx,
  );

  const choice = response.choices[0];
  const message = choice?.message;
  const text = message?.content?.trim() ?? '';

  return {
    text: text || 'No response text received.',
    functionCalls: message ? mapFunctionCalls(message) : undefined,
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
