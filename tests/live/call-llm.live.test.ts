import dotenv from 'dotenv';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { hasLiveApiKey } from '../helpers/env.js';
import { callLlmLive } from '../helpers/live-call.js';

dotenv.config();

const LIVE_MODEL = 'gemini-2.5-flash-lite';

describe.skipIf(!hasLiveApiKey())('callLlm live smoke tests', () => {
  beforeEach(() => {
    resetExhaustionState();
  });
  it('returns text for explicit model with metadata', async () => {
    const result = await callLlmLive({
      model: LIVE_MODEL,
      prompt: 'Reply with exactly one word: hello',
      thinkingPower: 'off',
      maxOutputTokens: 16,
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.model).toContain('gemini-2.5-flash-lite');
    expect(result.thinkingUsed).toBe(false);
    expect(result.thinkingPowerApplied).toBe('off');
    expect(result.modelSelectedBy).toBe('explicit');
    expect(result.modelsAttempted).toContain('gemini-2.5-flash-lite');
  }, 30_000);

  it('tier auto-select includes tier routing metadata', async () => {
    const result = await callLlmLive({
      thinkingPowerTier: 'low',
      prompt: 'Reply with one word: ok',
      thinkingPower: 'off',
      maxOutputTokens: 16,
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.modelSelectedBy).toBe('tier');
    expect(result.thinkingPowerTierRequested).toBe('low');
    expect(result.thinkingPowerTierUsed).toBe('low');
  }, 30_000);

  it('accepts thinkingPower low on budget-mode model', async () => {
    const result = await callLlmLive({
      model: LIVE_MODEL,
      prompt: 'Reply with one word: ok',
      thinkingPower: 'low',
      maxOutputTokens: 16,
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.thinkingPowerApplied).toBe('low');
  }, 30_000);

  it('handles a minimal function-calling round trip structure', async () => {
    const first = await callLlmLive({
      model: LIVE_MODEL,
      prompt: 'If helpful, call get_answer with query "ping". Otherwise reply with pong.',
      tools: [
        {
          name: 'get_answer',
          description: 'Returns an answer string for a query',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
      maxOutputTokens: 64,
    });

    expect(first.text.length + (first.functionCalls?.length ?? 0)).toBeGreaterThan(0);
    expect(first.modelContent?.role).toBe('model');

    if (first.functionCalls?.length) {
      const call = first.functionCalls[0];
      const second = await callLlmLive({
        model: LIVE_MODEL,
        contents: [
          { role: 'user', parts: [{ text: 'If helpful, call get_answer with query "ping".' }] },
          first.modelContent!,
          {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: call.name,
                  response: { answer: 'pong' },
                  ...(call.id ? { id: call.id } : {}),
                },
              },
            ],
          },
        ],
        tools: [{ name: 'get_answer', description: 'Returns an answer string for a query' }],
        maxOutputTokens: 64,
      });

      expect(second.text.length).toBeGreaterThan(0);
    }
  }, 60_000);

  it.skipIf(process.env.LIVE_TEST_FAILOVER !== '1')(
    'optional live tier failover smoke',
    async () => {
      const result = await callLlmLive({
        thinkingPowerTier: 'medium',
        prompt: 'Reply with one word: hi',
        maxOutputTokens: 8,
      });
      expect(result.modelSelectedBy).toBe('tier');
    },
    30_000,
  );
});

describe('callLlm live tests without API key', () => {
  it.skipIf(hasLiveApiKey())('skips when GEMINI_API_KEY is missing', () => {
    expect(hasLiveApiKey()).toBe(false);
  });
});
