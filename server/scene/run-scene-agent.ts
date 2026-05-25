import type { ChatMessage, SpeedTier } from '../../shared/gemini-types.js';
import type { CallLlmAgentResult } from '../../shared/gemini-types.js';
import type { LandscapeSceneState } from '../../shared/scene-agent-types.js';
import { callLlmAgent } from '../gemini/call-llm-agent.js';
import { LlmCapabilityError, resolveTextModel } from '../gemini/models.js';
import {
  createSceneToolHandlers,
  prepareSceneStateForAgent,
  SCENE_AGENT_SYSTEM_INSTRUCTION,
  SCENE_AGENT_TOOL_DECLARATIONS,
} from './scene-agent-tools.js';
import { cloneSceneState } from './scene-state.js';

export interface RunSceneAgentOptions {
  prompt?: string;
  messages?: ChatMessage[];
  model?: string;
  speedTier?: SpeedTier;
  sceneState: LandscapeSceneState;
  maxSteps?: number;
  /** Include native provider payloads in the response (dev dashboard). */
  debug?: boolean;
}

export interface SceneAgentResult extends CallLlmAgentResult {
  sceneState: LandscapeSceneState;
}

export async function runSceneAgent(options: RunSceneAgentOptions): Promise<SceneAgentResult> {
  if (!options.prompt?.trim() && !options.messages?.length) {
    throw new Error('Either prompt or messages is required.');
  }

  if (options.model?.trim()) {
    const resolved = resolveTextModel(options.model.trim());
    if (!resolved.info.supportsFunctionCalling) {
      throw new LlmCapabilityError(
        `Model "${resolved.registryKey}" does not support function calling.`,
        resolved.registryKey,
        'functionCalling',
      );
    }
  }

  const sceneState = prepareSceneStateForAgent(options.sceneState);
  const toolHandlers = createSceneToolHandlers(sceneState);

  const agentResult = await callLlmAgent({
    model: options.model,
    speedTier: options.speedTier ?? 'moderate',
    prompt: options.prompt?.trim(),
    messages: options.messages,
    systemInstruction: SCENE_AGENT_SYSTEM_INSTRUCTION,
    tools: SCENE_AGENT_TOOL_DECLARATIONS,
    toolHandlers,
    maxSteps: options.maxSteps ?? 12,
    maxOutputTokens: 1024,
    debug: options.debug,
  });

  return {
    ...agentResult,
    sceneState: cloneSceneState(sceneState),
  };
}
