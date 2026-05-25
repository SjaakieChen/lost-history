import type {

  AgentStep,

  AgentTerminationMode,

  CallLlmAgentOptions,

  CallLlmAgentResult,

  ChatMessage,

  GenerateTextUsage,

  LlmFunctionCall,

  LlmProvider,

} from '../../shared/gemini-types.js';

import {

  appendGeminiToolResponse,

  appendGroqToolResult,

  exportToMessages,

  rebuildThreadForProvider,

  type ProviderThreadState,

} from '../llm/conversation/index.js';

import {

  buildFinalAnswerToolDeclaration,

  FINAL_ANSWER_TOOL_NAME,

  normalizeToolDeclarations,

} from '../llm/tool-schema.js';

import { createExhaustionContext } from './availability.js';
import { isInvalidModelOutput, isRecoverableLlmFailure } from './failure-policy.js';
import { resolveTextModel } from './models.js';

import { serializeProviderThread } from '../llm/provider-request-snapshot.js';
import { callLlm, type InternalCallLlmOptions } from './call-llm.js';



const DEFAULT_MAX_STEPS = 10;

const DEFAULT_FINAL_ANSWER_TOOL = FINAL_ANSWER_TOOL_NAME;

/** Retry once on the same model before unlocking for tier failover. */
const MAX_STEP_ATTEMPTS = 2;



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



  parts.push(
    'After each tool call, wait for the tool result in the next turn before continuing. ' +
      'If a tool response includes ok: false or an error field, fix the problem (retry with corrected arguments or use another tool) before finishing. ' +
      'Do not end the interaction in the same turn as a mutation tool — verify outcomes first.',
  );

  if (usesFinalAnswerTool(termination)) {
    parts.push(
      `Only call \`${finalToolName}\` after every intended tool call has succeeded and you have confirmed the results. ` +
        'Do not reply with plain text unless you cannot use tools; plain text without a tool call is a fallback only.',
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



function finalToolSequenceIndex(toolSequence: string[], finalToolName: string): number {

  const index = toolSequence.indexOf(finalToolName);

  return index >= 0 ? index : toolSequence.length;

}



function selectCallsForSequenceStep(

  calls: LlmFunctionCall[],

  toolSequence: string[],

  sequenceProgress: number,

  finalToolName: string,

): LlmFunctionCall[] {

  const expected = toolSequence[sequenceProgress];

  if (!expected) {

    return calls;

  }



  const matching = calls.filter((call) => call.name === expected);

  if (matching.length > 0) {

    return [matching[0]];

  }



  const nonFinal = calls.find((call) => call.name !== finalToolName);

  if (nonFinal) {

    return [nonFinal];

  }



  const prematureFinal = calls.find((call) => call.name === finalToolName);

  return prematureFinal ? [prematureFinal] : calls.slice(0, 1);

}



function appendToolResultToThread(

  thread: ProviderThreadState,

  call: LlmFunctionCall,

  response: Record<string, unknown>,

): void {

  if (thread.provider === 'gemini') {

    appendGeminiToolResponse(thread, call.name, response, call.id);

    return;

  }



  const toolCallId = call.id ?? `call_${call.name}`;

  appendGroqToolResult(thread, toolCallId, call.name, response);

}



function collectBaseMessages(options: CallLlmAgentOptions): ChatMessage[] {

  const base: ChatMessage[] = [];

  if (options.messages?.length) {

    for (const message of options.messages) {

      if (message.role !== 'system') {

        base.push({ ...message });

      }

    }

  }

  if (options.prompt?.trim()) {

    base.push({ role: 'user', content: options.prompt.trim() });

  }

  return base;

}



function providerOfRegistryKey(registryKey: string): LlmProvider {

  return resolveTextModel(registryKey).info.provider ?? 'gemini';

}



function syncThreadAfterCall(

  thread: ProviderThreadState | undefined,

  resultThread: ProviderThreadState | undefined,

  resultRegistryKey: string,

  rebuildMessages: ChatMessage[],

  systemInstruction: string | undefined,

): ProviderThreadState | undefined {

  const resultProvider = providerOfRegistryKey(resultRegistryKey);



  if (resultThread) {

    if (thread && thread.provider !== resultThread.provider) {

      return rebuildThreadForProvider(rebuildMessages, systemInstruction, resolveTextModel(resultRegistryKey));

    }

    return resultThread;

  }



  if (thread && thread.provider !== resultProvider) {

    return rebuildThreadForProvider(rebuildMessages, systemInstruction, resolveTextModel(resultRegistryKey));

  }



  return thread;

}



function buildAgentDebugBundle(

  captureDebug: boolean,

  agentOptions: CallLlmAgentOptions,

  effectiveSystemInstruction: string | undefined,

  toolDeclarations: CallLlmAgentOptions['tools'],

  steps: AgentStep[],

  exportedMessages: ChatMessage[],

  thread: ProviderThreadState | undefined,

  accumulatedThoughts?: string,

  accumulatedUsage?: GenerateTextUsage,

): CallLlmAgentResult['debug'] | undefined {

  if (!captureDebug) {

    return undefined;

  }



  return {

    sceneSystemInstruction: agentOptions.systemInstruction,

    effectiveSystemInstruction,

    tools: toolDeclarations ?? [],

    messages: exportedMessages,

    steps,

    finalProviderThread: thread ? serializeProviderThread(thread) : undefined,

    thoughts: accumulatedThoughts,

    usage: accumulatedUsage,

  };

}



function buildAgentResult(

  lastResult: Awaited<ReturnType<typeof callLlm>>,

  options: {

    text: string;

    terminationReason: CallLlmAgentResult['terminationReason'];

    steps: AgentStep[];

    accumulatedThoughts?: string;

    accumulatedUsage?: GenerateTextUsage;

    allModelsAttempted: string[];

    exportedMessages: ChatMessage[];

    debug?: CallLlmAgentResult['debug'];

  },

): CallLlmAgentResult {

  return {

    text: options.text,

    thoughts: options.accumulatedThoughts,

    functionCalls: lastResult.functionCalls,

    model: lastResult.model,

    registryKey: lastResult.registryKey,

    thinkingUsed: lastResult.thinkingUsed,

    thinkingPowerApplied: lastResult.thinkingPowerApplied,

    finishReason: lastResult.finishReason,

    usage: options.accumulatedUsage,

    speedTierRequested: lastResult.speedTierRequested,

    speedTierUsed: lastResult.speedTierUsed,

    speedTierDowngraded: lastResult.speedTierDowngraded,

    modelsAttempted: options.allModelsAttempted,

    modelSelectedBy: lastResult.modelSelectedBy,

    terminationReason: options.terminationReason,

    steps: options.steps,

    stepCount: options.steps.length,

    messages: options.exportedMessages,

    debug: options.debug,

  };

}



export async function callLlmAgent(options: CallLlmAgentOptions): Promise<CallLlmAgentResult> {

  const captureDebug = options.debug === true;

  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  const termination = options.termination ?? 'both';

  const finalToolName = options.finalAnswerTool?.name ?? DEFAULT_FINAL_ANSWER_TOOL;

  const includeFinalTool = usesFinalAnswerTool(termination);



  const userTools = normalizeToolDeclarations(options.tools ?? []);

  const tools = includeFinalTool

    ? [

        ...userTools,

        buildFinalAnswerToolDeclaration(finalToolName, options.finalAnswerTool?.description),

      ]

    : userTools;



  if (tools.length === 0) {

    throw new Error('callLlmAgent requires at least one tool declaration.');

  }



  const toolSequence = options.toolSequence;

  let sequenceProgress = 0;

  const requiredBeforeFinal = toolSequence

    ? finalToolSequenceIndex(toolSequence, finalToolName)

    : 0;



  const baseMessages = collectBaseMessages(options);

  const systemInstruction = buildAgentSystemInstruction(

    options.systemInstruction,

    termination,

    finalToolName,

  );



  let thread: ProviderThreadState | undefined;

  const steps: AgentStep[] = [];

  let lockedRegistryKey: string | undefined;

  let accumulatedThoughts: string | undefined;

  let accumulatedUsage: GenerateTextUsage | undefined;

  const allModelsAttempted: string[] = [];

  const exhaustionCtx = createExhaustionContext();



  for (let step = 1; step <= maxSteps; step++) {

    const stepStarted = performance.now();

    const threadRebuildMessages =

      steps.length > 0 ? exportToMessages(baseMessages, steps, { includeToolSummary: true }) : undefined;



    let result: Awaited<ReturnType<typeof callLlm>> | undefined;

    let unlockForFailover = false;

    for (let stepAttempt = 0; stepAttempt < MAX_STEP_ATTEMPTS; stepAttempt += 1) {

      const callOptions: InternalCallLlmOptions = {

        ...options,

        capabilities: {
          ...options.capabilities,
          tools: true,
        },

        model: unlockForFailover ? options.model : (lockedRegistryKey ?? options.model),

        prompt: thread ? undefined : options.prompt,

        messages: thread ? undefined : options.messages,

        systemInstruction,

        tools,

        threadState: thread,

        threadRebuildMessages,

        exhaustionContext: exhaustionCtx,

        captureProviderRequest: captureDebug,

      };



      try {

        result = await callLlm(callOptions);

      } catch (error) {

        if (stepAttempt === 0 && isRecoverableLlmFailure(error)) {

          unlockForFailover = true;

          lockedRegistryKey = undefined;

          continue;

        }

        throw error;

      }



      if (isInvalidModelOutput(result)) {

        if (stepAttempt === 0) {

          unlockForFailover = true;

          lockedRegistryKey = undefined;

          continue;

        }

        throw new Error('Model returned no text and no function calls.');

      }

      break;

    }



    if (!result) {

      throw new Error('Model returned no text and no function calls.');

    }

    const stepDurationMs = Math.round(performance.now() - stepStarted);



    const rebuildMessages =

      threadRebuildMessages ?? exportToMessages(baseMessages, steps, { includeToolSummary: true });

    thread = syncThreadAfterCall(thread, result.threadState, result.registryKey, rebuildMessages, systemInstruction);



    lockedRegistryKey = result.registryKey;

    accumulatedThoughts = appendThoughts(accumulatedThoughts, result.thoughts);

    accumulatedUsage = mergeUsage(accumulatedUsage, result.usage);



    for (const attempted of result.modelsAttempted ?? []) {

      if (!allModelsAttempted.includes(attempted)) {

        allModelsAttempted.push(attempted);

      }

    }



    const agentStep: AgentStep = {

      step,

      model: result.registryKey,

      text: result.text !== 'No response text received.' ? result.text : undefined,

      thoughts: result.thoughts,

      functionCalls: result.functionCalls,

      executedTools: result.executedTools,

      finishReason: result.finishReason,

      durationMs: stepDurationMs,

      providerRequest: captureDebug ? result.providerRequest : undefined,

    };

    steps.push(agentStep);



    const exportedMessages = exportToMessages(baseMessages, steps, { includeToolSummary: true });



    const finalCall = result.functionCalls?.find((call) => call.name === finalToolName);

    const prematureFinal =

      Boolean(finalCall) &&

      Boolean(toolSequence) &&

      sequenceProgress < requiredBeforeFinal;



    if (includeFinalTool && finalCall && !prematureFinal) {

      const answer = extractFinalAnswer(finalCall);

      return buildAgentResult(result, {

        text: answer || result.text,

        terminationReason: 'final_tool',

        steps,

        accumulatedThoughts,

        accumulatedUsage,

        allModelsAttempted,

        exportedMessages,

        debug: buildAgentDebugBundle(

          captureDebug,

          options,

          systemInstruction,

          tools,

          steps,

          exportedMessages,

          thread,

          accumulatedThoughts,

          accumulatedUsage,

        ),

      });

    }



    if (result.functionCalls?.length) {

      if (!thread) {

        throw new Error('Model returned function calls without thread state.');

      }



      const toolResults: AgentStep['toolResults'] = [];



      const callsToRun = toolSequence

        ? selectCallsForSequenceStep(

            result.functionCalls,

            toolSequence,

            sequenceProgress,

            finalToolName,

          )

        : result.functionCalls;



      for (const call of callsToRun) {

        if (call.name === finalToolName) {

          if (prematureFinal) {

            const response = {

              error:

                'submit_final_answer is not allowed yet. Complete all prior tools in order first.',

            };

            toolResults.push({ name: call.name, response });

            appendToolResultToThread(thread, call, response);

          }

          continue;

        }



        const response = await executeToolHandler(

          call.name,

          call.args ?? {},

          options.toolHandlers,

        );

        toolResults.push({ name: call.name, response });

        appendToolResultToThread(thread, call, response);



        if (toolSequence && call.name === toolSequence[sequenceProgress]) {

          sequenceProgress += 1;

        }

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

        exportedMessages: exportToMessages(baseMessages, steps, { includeToolSummary: true }),

        debug: buildAgentDebugBundle(

          captureDebug,

          options,

          systemInstruction,

          tools,

          steps,

          exportToMessages(baseMessages, steps, { includeToolSummary: true }),

          thread,

          accumulatedThoughts,

          accumulatedUsage,

        ),

      });

    }



    if (result.text && result.text !== 'No response text received.' && termination === 'final_tool_only') {

      continue;

    }



    if (

      result.thoughts &&

      !result.functionCalls?.length &&

      (!result.text || result.text === 'No response text received.')

    ) {

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


