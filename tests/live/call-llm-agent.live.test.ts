import dotenv from 'dotenv';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { hasLiveApiKey } from '../helpers/env.js';
import { callLlmAgentLive } from '../helpers/live-call.js';

dotenv.config();

const echoTool = {
  name: 'echo',
  description: 'Returns the input message unchanged',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
};

describe.skipIf(!hasLiveApiKey())('callLlmAgent live smoke tests', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('runs agent loop with echo tool and returns a final answer', async () => {
    const result = await callLlmAgentLive({
      thinkingPowerTier: 'low',
      systemInstruction:
        'Use the echo tool when asked. When done, call submit_final_answer with your conclusion.',
      prompt: 'Call echo with message "ping", then submit your final answer including the echo result.',
      tools: [echoTool],
      toolHandlers: {
        echo: async ({ message }) => ({ message: String(message ?? '') }),
      },
      thinkingPower: 'off',
      maxOutputTokens: 128,
      maxSteps: 6,
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.stepCount).toBeGreaterThanOrEqual(1);
    expect(result.steps.length).toBe(result.stepCount);
    expect(['final_tool', 'natural']).toContain(result.terminationReason);
    expect(result.model.length).toBeGreaterThan(0);
    expect(result.thinkingPowerTierRequested).toBe('low');
    expect(result.thinkingPowerTierUsed).toBe('low');
    // Turn 1 uses tier routing; later turns pin the chosen model (explicit).
    expect(['tier', 'explicit']).toContain(result.modelSelectedBy);

    const echoStep = result.steps.find((step) =>
      step.toolResults?.some((toolResult) => toolResult.name === 'echo'),
    );
    if (echoStep) {
      expect(echoStep.toolResults?.[0].response).toMatchObject({
        message: expect.any(String),
      });
    }
  }, 90_000);
});

describe('callLlmAgent live tests without API key', () => {
  it.skipIf(hasLiveApiKey())('skips when GEMINI_API_KEY is missing', () => {
    expect(hasLiveApiKey()).toBe(false);
  });
});
