import type { Content } from '@google/genai';
import type {
  AgentStep,
  AgentTerminationMode,
  CallLlmAgentOptions,
  CallLlmAgentResult,
  CallLlmOptions,
  CallLlmResult,
  FinalAnswerToolConfig,
  GenerateTextUsage,
  LlmFunctionCall,
  LlmFunctionDeclaration,
} from '../../shared/gemini-types.js';
import {
  buildFunctionResponseContent,
  buildLlmContents,
  callLlm,
  normalizeLlmContentsToArray,
} from './call-llm.js';

const DEFAULT_MAX_STEPS = 10;
const DEFAULT_FINAL_ANSWER_TOOL = 'submit_final_answer';

export class AgentMaxStepsError extends Error {
  readonly name = 'AgentMaxStepsError';

  constructor(
    message: string,
    readonly steps: AgentStep[],
    readonly maxSteps: number,
  ) {
    super(message);
  }
}

function buildFinalAnswerTool(
  finalToolName: string,
  config?: FinalAnswerToolConfig,
): LlmFunctionDeclaration {
  return {
    name: finalToolName,
    description:
      config?.description ??
      'Submit your final answer when you have enough information. Preferred over replying with plain text.',
    parameters: {
      type: 'object',
      properties: {
        answer: {
          type: 'string',
          description: 'The final answer to return to the user.',
        },
        reasoning: {
          type: 'string',
          description: 'Optional brief reasoning summary.',
        },
      },
      required: ['answer'],
    },
  };
}

function usesFinalAnswerTool(termination: AgentTerminationMode): boolean {
  return termination === 'both' || termination === 'final_tool_only';
}

function buildAgentSystemInstruction(
  userInstruction: string | undefined,
  termination: AgentTerminationMode,
  finalToolName: string,
): string | undefined {
  const parts: string[] = [];

  if (userInstruction?.trim()) {
    parts.push(userInstruction.trim());
  }

  if (usesFinalAnswerTool(termination)) {
    parts.push(
      `When you have enough information, call \`${finalToolName}\` with your final answer. ` +
        'Do not reply with plain text unless you cannot use tools. ' +
        'Plain text without a tool call is accepted only as a fallback.',
    );
  }

  return parts.length > 0 ? parts.join('\n\n') : undefined;
}

function mergeUsage(
  accumulated: GenerateTextUsage | undefined,
  next: GenerateTextUsage | undefined,
): GenerateTextUsage | undefined {
  if (!next) {
    return accumulated;
  }

  if (!accumulated) {
    return { ...next };
  }

  return {
    promptTokens: (accumulated.promptTokens ?? 0) + (next.promptTokens ?? 0),
    candidatesTokens: (accumulated.candidatesTokens ?? 0) + (next.candidatesTokens ?? 0),
    totalTokens: (accumulated.totalTokens ?? 0) + (next.totalTokens ?? 0),
    thoughtsTokens: (accumulated.thoughtsTokens ?? 0) + (next.thoughtsTokens ?? 0),
  };
}

function appendThoughts(accumulated: string | undefined, next: string | undefined): string | undefined {
  if (!next) {
    return accumulated;
  }

  if (!accumulated) {
    return next;
  }

  return `${accumulated}\n${next}`;
}

function extractFinalAnswer(call: LlmFunctionCall): string {
  const answer = call.args?.answer;
  if (typeof answer === 'string' && answer.trim()) {
    return answer;
  }

  if (answer !== undefined && answer !== null) {
    return String(answer);
  }

  return '';
}

async function executeToolHandler(
  name: string,
  args: Record<string, unknown>,
  toolHandlers: CallLlmAgentOptions['toolHandlers'],
): Promise<Record<string, unknown>> {
  const handler = toolHandlers[name];
  if (!handler) {
    return { error: `No handler registered for tool "${name}".` };
  }

  try {
    return await handler(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown tool execution error';
    return { error: message };
  }
}

function buildAgentResult(
  lastResult: CallLlmResult,
  options: {
    text: string;
    terminationReason: CallLlmAgentResult['terminationReason'];
    steps: AgentStep[];
    accumulatedThoughts?: string;
    accumulatedUsage?: GenerateTextUsage;
    allModelsAttempted: string[];
  },
): CallLlmAgentResult {
  return {
    text: options.text,
    thoughts: options.accumulatedThoughts,
    functionCalls: lastResult.functionCalls,
    modelContent: lastResult.modelContent,
    model: lastResult.model,
    thinkingUsed: lastResult.thinkingUsed,
    thinkingPowerApplied: lastResult.thinkingPowerApplied,
    finishReason: lastResult.finishReason,
    usage: options.accumulatedUsage,
    thinkingPowerTierRequested: lastResult.thinkingPowerTierRequested,
    thinkingPowerTierUsed: lastResult.thinkingPowerTierUsed,
    tierDowngraded: lastResult.tierDowngraded,
    modelsAttempted: options.allModelsAttempted,
    modelSelectedBy: lastResult.modelSelectedBy,
    terminationReason: options.terminationReason,
    steps: options.steps,
    stepCount: options.steps.length,
  };
}

export async function callLlmAgent(options: CallLlmAgentOptions): Promise<CallLlmAgentResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const termination = options.termination ?? 'both';
  const finalToolName = options.finalAnswerTool?.name ?? DEFAULT_FINAL_ANSWER_TOOL;
  const includeFinalTool = usesFinalAnswerTool(termination);

  const userTools = options.tools ?? [];
  const tools = includeFinalTool
    ? [...userTools, buildFinalAnswerTool(finalToolName, options.finalAnswerTool)]
    : userTools;

  if (tools.length === 0) {
    throw new Error('callLlmAgent requires at least one tool declaration.');
  }

  let conversationContents: Content[] = normalizeLlmContentsToArray(buildLlmContents(options));
  const systemInstruction = buildAgentSystemInstruction(
    options.systemInstruction,
    termination,
    finalToolName,
  );

  const steps: AgentStep[] = [];
  let lockedModel: string | undefined;
  let accumulatedThoughts: string | undefined;
  let accumulatedUsage: GenerateTextUsage | undefined;
  const allModelsAttempted: string[] = [];

  for (let step = 1; step <= maxSteps; step++) {
    const result = await callLlm({
      ...options,
      model: lockedModel ?? options.model,
      prompt: undefined,
      messages: undefined,
      contents: conversationContents as CallLlmOptions['contents'],
      tools,
      systemInstruction,
    });

    lockedModel = result.model;
    accumulatedThoughts = appendThoughts(accumulatedThoughts, result.thoughts);
    accumulatedUsage = mergeUsage(accumulatedUsage, result.usage);

    for (const attempted of result.modelsAttempted ?? []) {
      if (!allModelsAttempted.includes(attempted)) {
        allModelsAttempted.push(attempted);
      }
    }

    const agentStep: AgentStep = {
      step,
      model: result.model,
      text: result.text !== 'No response text received.' ? result.text : undefined,
      thoughts: result.thoughts,
      functionCalls: result.functionCalls,
      finishReason: result.finishReason,
    };
    steps.push(agentStep);

    const finalCall = result.functionCalls?.find((call) => call.name === finalToolName);
    if (includeFinalTool && finalCall) {
      const answer = extractFinalAnswer(finalCall);
      return buildAgentResult(result, {
        text: answer || result.text,
        terminationReason: 'final_tool',
        steps,
        accumulatedThoughts,
        accumulatedUsage,
        allModelsAttempted,
      });
    }

    if (result.functionCalls?.length) {
      if (!result.modelContent) {
        throw new Error('Model returned function calls without modelContent.');
      }

      conversationContents = [...conversationContents, result.modelContent as Content];
      const toolResults: AgentStep['toolResults'] = [];

      for (const call of result.functionCalls) {
        if (call.name === finalToolName) {
          continue;
        }

        const response = await executeToolHandler(
          call.name,
          call.args ?? {},
          options.toolHandlers,
        );
        toolResults.push({ name: call.name, response });
        conversationContents.push(
          buildFunctionResponseContent(call.name, response, call.id) as Content,
        );
      }

      agentStep.toolResults = toolResults;
      continue;
    }

    if (result.text && result.text !== 'No response text received.' && termination !== 'final_tool_only') {
      return buildAgentResult(result, {
        text: result.text,
        terminationReason: 'natural',
        steps,
        accumulatedThoughts,
        accumulatedUsage,
        allModelsAttempted,
      });
    }

    if (result.text && result.text !== 'No response text received.' && termination === 'final_tool_only') {
      if (result.modelContent) {
        conversationContents = [...conversationContents, result.modelContent as Content];
      }
      continue;
    }

    if (result.modelContent) {
      conversationContents = [...conversationContents, result.modelContent as Content];
      continue;
    }

    throw new Error('Model returned no text and no function calls.');
  }

  throw new AgentMaxStepsError(
    `Agent loop exceeded maxSteps (${maxSteps}).`,
    steps,
    maxSteps,
  );
}

export type { CallLlmAgentOptions, CallLlmAgentResult, AgentStep };
