import dotenv from 'dotenv';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { hasLiveTestKeys } from '../helpers/env.js';
import { callLlmAgentLive, callLlmLive } from '../helpers/live-call.js';
import { logLiveAgentResult, logLiveCallError, logLiveCallResult } from '../helpers/live-log.js';
import {
  ATTRIBUTE_UPDATED_STATUS,
  LIVE_SCENE_SYSTEM_INSTRUCTION,
  LIVE_SCENE_USER_PROMPT,
  liveSceneToolDeclarations,
  liveSceneToolHandlers,
  SCENE_OBJECT_NAMES,
} from '../helpers/live-scene-tools.js';

dotenv.config();

describe.skipIf(!hasLiveTestKeys())('LLM live smoke tests', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('single-turn: alternative history paragraph (fast tier)', async () => {
    let result;
    try {
      result = await callLlmLive({
        speedTier: 'fast',
        systemInstruction:
          'You are a creative historian. Write vivid, plausible prose. Reply with the full paragraph only—no preamble.',
        prompt:
          'Write a short paragraph (4–6 sentences) describing an alternative history where the Library of Alexandria was never destroyed and became a global network of knowledge by 1500 CE.',
        maxOutputTokens: 1024,
        includeThoughts: false,
      });
    } catch (error) {
      logLiveCallError('single-turn / fast', error);
      throw error;
    }

    logLiveCallResult('single-turn / fast', result);

    expect(result.registryKey.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThanOrEqual(200);
    expect(result.speedTierUsed).toBe('fast');
  }, 90_000);

  it('agent: book scene tool chain (moderate tier)', async () => {
    let result;
    try {
      result = await callLlmAgentLive({
        speedTier: 'moderate',
        systemInstruction: LIVE_SCENE_SYSTEM_INSTRUCTION,
        prompt: LIVE_SCENE_USER_PROMPT,
        tools: liveSceneToolDeclarations,
        toolHandlers: liveSceneToolHandlers,
        maxOutputTokens: 512,
        maxSteps: 10,
      });
    } catch (error) {
      logLiveCallError('agent / moderate / book scene', error);
      throw error;
    }

    logLiveAgentResult('agent / moderate / book scene', result);

    expect(['final_tool', 'natural']).toContain(result.terminationReason);
    expect(result.text.length).toBeGreaterThan(0);

    const inspectStep = result.steps.find((step) =>
      step.toolResults?.some((tr) => tr.name === 'get_attribute_object'),
    );
    expect(inspectStep).toBeDefined();
    const inspectResult = inspectStep!.toolResults!.find(
      (tr) => tr.name === 'get_attribute_object',
    )!;
    expect(SCENE_OBJECT_NAMES).toContain(inspectResult.response.name);

    const editStep = result.steps.find((step) =>
      step.toolResults?.some((tr) => tr.name === 'edit_object_attribute'),
    );
    expect(editStep).toBeDefined();
    const editResult = editStep!.toolResults!.find(
      (tr) => tr.name === 'edit_object_attribute',
    )!;
    expect(editResult.response.status).toBe(ATTRIBUTE_UPDATED_STATUS);
  }, 120_000);
});

describe('LLM live tests without API keys', () => {
  it.skipIf(hasLiveTestKeys())('requires GEMINI_API_KEY and GROQ_API_KEY', () => {
    expect(hasLiveTestKeys()).toBe(false);
  });
});
