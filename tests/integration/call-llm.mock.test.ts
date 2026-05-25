import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markExhausted, resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlm } from '../../server/gemini/call-llm.js';
import { buildGeminiFunctionResponseContent } from '../../server/llm/conversation/gemini-thread.js';
import { GeminiQuotaError } from '../../server/gemini/rate-limit.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import { iterateSpeedTierBatches } from '../../server/gemini/model-selection.js';
import { SPEED_TIER_MODEL_ORDER, TEXT_MODEL_REGISTRY } from '../../server/gemini/models.js';
import {
  createFunctionCallResponse,
  createTextResponse,
  createThoughtResponse,
  quotaError,
} from '../helpers/mock-genai.js';

vi.mock('../../server/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/config.js')>();
  return {
    ...actual,
    getGroqApiKey: vi.fn(() => undefined),
  };
});

vi.mock('../../server/gemini/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/gemini/rate-limit.js')>();
  return {
    ...actual,
    withRateLimitAndRetry: vi.fn((_key, _hints, operation: () => Promise<unknown>) => operation()),
  };
});

vi.mock('../../server/gemini/client.js', () => ({
  getGenAIClient: vi.fn(),
}));

function installClient(get: ReturnType<typeof vi.fn>, generateContent: ReturnType<typeof vi.fn>) {
  vi.mocked(getGenAIClient).mockReturnValue({
    models: { get, generateContent },
  } as never);
}

function geminiInstantKeys(): string[] {
  return SPEED_TIER_MODEL_ORDER.instant.filter(
    (id) => (TEXT_MODEL_REGISTRY[id].provider ?? 'gemini') === 'gemini',
  );
}

function geminiInstantPingCount(): number {
  const batches = [...iterateSpeedTierBatches({ speedTier: 'instant' })];
  return (
    batches[0]?.candidates.filter((candidate) => candidate.info.provider !== 'groq').length ?? 0
  );
}

describe('buildGeminiFunctionResponseContent', () => {
  it('builds user role content with functionResponse', () => {
    const block = buildGeminiFunctionResponseContent('get_answer', { value: 42 });

    expect(block).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'get_answer', response: { value: 42 } } }],
    });
  });

  it('includes function call id when provided', () => {
    const block = buildGeminiFunctionResponseContent('get_answer', { value: 42 }, 'fc-99');

    expect(block.parts?.[0]).toEqual({
      functionResponse: { name: 'get_answer', response: { value: 42 }, id: 'fc-99' },
    });
  });
});

describe('callLlm with mocked GenAI client', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
  });

  it('parses plain text response with routing metadata', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('Hello world'));
    installClient(get, generateContent);

    const result = await callLlm({
      model: 'gemini-2.5-flash-lite',
      prompt: 'Say hello',
    });

    expect(result.text).toBe('Hello world');
    expect(result.modelSelectedBy).toBe('explicit');
    expect(result.modelsAttempted).toEqual(['gemini-2.5-flash-lite-medium']);
    expect(result.thinkingPowerApplied).toBe('medium');
    expect(get).not.toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('auto-selects strongest instant-tier model by default', async () => {
    const get = vi.fn().mockResolvedValue({});
    const firstInstant = geminiInstantKeys()[0];
    const apiModelId = TEXT_MODEL_REGISTRY[firstInstant].apiModelId;
    const generateContent = vi.fn().mockResolvedValue(
      createTextResponse('Hello', { modelVersion: `models/${apiModelId}` }),
    );
    installClient(get, generateContent);

    const result = await callLlm({ prompt: 'Hi', speedTier: 'instant' });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: apiModelId }),
    );
    expect(result.modelSelectedBy).toBe('tier');
    expect(result.speedTierUsed).toBe('instant');
    expect(get).toHaveBeenCalledTimes(geminiInstantPingCount());
  });

  it('parses thoughts and function calls from response parts', async () => {
    const get = vi.fn().mockResolvedValue({});
    installClient(
      get,
      vi.fn().mockResolvedValue(createThoughtResponse('Let me think...', 'Final answer')),
    );

    const thoughtResult = await callLlm({
      model: 'gemini-2.5-flash-lite-low',
      prompt: 'Think then answer',
    });

    expect(thoughtResult.thoughts).toBe('Let me think...');
    expect(thoughtResult.text).toBe('Final answer');
    expect(thoughtResult.thinkingUsed).toBe(true);
    expect(thoughtResult.thinkingPowerApplied).toBe('low');

    installClient(
      get,
      vi.fn().mockResolvedValue(createFunctionCallResponse('get_answer', { query: 'test' })),
    );

    const fcResult = await callLlm({
      model: 'gemini-2.5-flash-lite',
      prompt: 'Use the tool',
      tools: [{ name: 'get_answer', description: 'Gets an answer' }],
    });

    expect(fcResult.functionCalls).toEqual([
      { id: 'fc-1', name: 'get_answer', args: { query: 'test' } },
    ]);
  });

  it('skips model when ping returns 429 and tries next in tier', async () => {
    const firstInstant = geminiInstantKeys()[0];
    const secondInstant = geminiInstantKeys()[1];
    const firstApi = TEXT_MODEL_REGISTRY[firstInstant].apiModelId;
    const secondApi = TEXT_MODEL_REGISTRY[secondInstant].apiModelId;

    const get = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === firstApi) {
        return Promise.reject(quotaError());
      }
      return Promise.resolve({});
    });
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('fallback'));
    installClient(get, generateContent);

    const result = await callLlm({ speedTier: 'instant', prompt: 'Hi' });

    expect(result.text).toBe('fallback');
    expect(result.modelsAttempted).toEqual([secondInstant]);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: secondApi }),
    );
    expect(get).toHaveBeenCalledTimes(geminiInstantPingCount());
  });

  it('failovers within tier when generateContent returns 429', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce(createTextResponse('second model'));
    installClient(get, generateContent);

    const result = await callLlm({ speedTier: 'instant', prompt: 'Hi' });

    expect(result.text).toBe('second model');
    expect(result.modelsAttempted?.length).toBe(2);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('downgrades speed tier when all moderate models fail', async () => {
    const tierBatches = [...iterateSpeedTierBatches({ speedTier: 'moderate' })];
    const moderateCandidates = tierBatches[0].candidates;
    const slowCandidates = tierBatches[1].candidates;

    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn();
    for (let i = 0; i < moderateCandidates.length; i += 1) {
      generateContent.mockRejectedValueOnce(quotaError());
    }
    generateContent.mockResolvedValueOnce(createTextResponse('slow tier win'));

    installClient(get, generateContent);

    const result = await callLlm({ speedTier: 'moderate', prompt: 'Hi' });

    expect(result.text).toBe('slow tier win');
    expect(result.speedTierDowngraded).toBe(true);
    expect(result.speedTierRequested).toBe('moderate');
    expect(result.speedTierUsed).toBe('slow');
    expect(get).toHaveBeenCalledTimes(moderateCandidates.length + slowCandidates.length);
    expect(get.mock.calls.length).toBeGreaterThan(moderateCandidates.length);
  });

  it('throws when all tiers exhausted', async () => {
    const get = vi.fn().mockRejectedValue({ status: 429, message: 'rate limit' });
    const generateContent = vi.fn().mockRejectedValue(quotaError());
    installClient(get, generateContent);

    await expect(callLlm({ speedTier: 'moderate', prompt: 'Hi' })).rejects.toBeInstanceOf(
      GeminiQuotaError,
    );
  });


  it('structured output uses capable registry model', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('{"ok":true}'));
    installClient(get, generateContent);

    const result = await callLlm({
      model: 'gemini-3.1-flash-lite-minimal',
      prompt: 'JSON',
      structuredOutput: { responseJsonSchema: { type: 'object' } },
    });

    expect(result.text).toContain('ok');
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-lite',
        config: expect.objectContaining({ responseMimeType: 'application/json' }),
      }),
    );
  });

  it('encodes prompt as Gemini user content', async () => {
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('ok'));
    installClient(vi.fn().mockResolvedValue({}), generateContent);

    await callLlm({ model: 'gemini-2.5-flash-lite', prompt: '  hello  ' });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      }),
    );
  });

  it('returns fallback text when response has no text parts', async () => {
    installClient(
      vi.fn().mockResolvedValue({}),
      vi.fn().mockResolvedValue({
        modelVersion: 'models/gemini-2.5-flash-lite',
        candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [] } }],
      }),
    );

    const result = await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });
    expect(result.text).toBe('No response text received.');
  });
});
