import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markExhausted, resetExhaustionState } from '../../server/gemini/availability.js';
import { buildFunctionResponseContent, callLlm } from '../../server/gemini/call-llm.js';
import { GeminiQuotaError } from '../../server/gemini/rate-limit.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import {
  createFunctionCallResponse,
  createTextResponse,
  createThoughtResponse,
  quotaError,
} from '../helpers/mock-genai.js';

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

describe('buildFunctionResponseContent', () => {
  it('builds user role content with functionResponse', () => {
    const block = buildFunctionResponseContent('get_answer', { value: 42 });

    expect(block).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'get_answer', response: { value: 42 } } }],
    });
  });

  it('includes function call id when provided', () => {
    const block = buildFunctionResponseContent('get_answer', { value: 42 }, 'fc-99');

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
      thinkingPower: 'off',
    });

    expect(result.text).toBe('Hello world');
    expect(result.modelSelectedBy).toBe('explicit');
    expect(result.modelsAttempted).toEqual(['gemini-2.5-flash-lite']);
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledBefore(generateContent);
  });

  it('auto-selects strongest low-tier model by default', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(
      createTextResponse('Hello', { modelVersion: 'models/gemini-3.1-flash-lite' }),
    );
    installClient(get, generateContent);

    const result = await callLlm({ prompt: 'Hi', thinkingPowerTier: 'low' });

    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-3.1-flash-lite' }),
    );
    expect(result.modelSelectedBy).toBe('tier');
    expect(result.thinkingPowerTierUsed).toBe('low');
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('parses thoughts and function calls from response parts', async () => {
    const get = vi.fn().mockResolvedValue({});
    installClient(
      get,
      vi.fn().mockResolvedValue(createThoughtResponse('Let me think...', 'Final answer')),
    );

    const thoughtResult = await callLlm({
      model: 'gemini-2.5-flash-lite',
      prompt: 'Think then answer',
      thinkingPower: 'low',
    });

    expect(thoughtResult.thoughts).toBe('Let me think...');
    expect(thoughtResult.text).toBe('Final answer');
    expect(thoughtResult.thinkingUsed).toBe(true);

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
    const get = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === 'gemini-3.1-flash-lite') {
        return Promise.reject(quotaError());
      }
      return Promise.resolve({});
    });
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('fallback'));
    installClient(get, generateContent);

    const result = await callLlm({ thinkingPowerTier: 'low', prompt: 'Hi' });

    expect(get).toHaveBeenCalledTimes(3);
    expect(result.text).toBe('fallback');
    expect(result.modelsAttempted).toEqual(['gemini-2.5-flash-lite']);
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash-lite' }),
    );
  });

  it('failovers within tier when generateContent returns 429', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce(createTextResponse('second model'));
    installClient(get, generateContent);

    const result = await callLlm({ thinkingPowerTier: 'low', prompt: 'Hi' });

    expect(result.text).toBe('second model');
    expect(result.modelsAttempted?.length).toBe(2);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('downgrades tier when all medium models fail', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce(createTextResponse('low tier win'));

    installClient(get, generateContent);

    const result = await callLlm({ thinkingPowerTier: 'medium', prompt: 'Hi' });

    expect(result.text).toBe('low tier win');
    expect(result.tierDowngraded).toBe(true);
    expect(result.thinkingPowerTierRequested).toBe('medium');
    expect(result.thinkingPowerTierUsed).toBe('low');
  });

  it('throws when all tiers exhausted', async () => {
    markExhausted('gemini-3.1-flash-lite');
    markExhausted('gemini-2.5-flash-lite');
    markExhausted('gemini-2.0-flash-lite');
    markExhausted('gemini-3.5-flash');
    markExhausted('gemini-3-flash');
    markExhausted('gemini-2.5-flash');
    markExhausted('gemini-2.0-flash');

    await expect(callLlm({ thinkingPowerTier: 'medium', prompt: 'Hi' })).rejects.toBeInstanceOf(
      GeminiQuotaError,
    );
  });

  it('explicit model does not failover on quota error', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockRejectedValue(quotaError());
    installClient(get, generateContent);

    await expect(
      callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' }),
    ).rejects.toBeInstanceOf(GeminiQuotaError);

    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('structured output failover picks gemini-3.1-flash-lite from low tier', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(quotaError())
      .mockRejectedValueOnce(quotaError())
      .mockResolvedValueOnce(createTextResponse('{"ok":true}'));

    installClient(get, generateContent);

    const result = await callLlm({
      thinkingPowerTier: 'medium',
      prompt: 'JSON',
      structuredOutput: { responseJsonSchema: { type: 'object' } },
    });

    expect(result.text).toContain('ok');
    expect(result.thinkingPowerTierUsed).toBe('low');
    expect(generateContent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-lite',
        config: expect.objectContaining({ responseMimeType: 'application/json' }),
      }),
    );
  });

  it('builds contents from prompt as a string', async () => {
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('ok'));
    installClient(vi.fn().mockResolvedValue({}), generateContent);

    await callLlm({ model: 'gemini-2.5-flash-lite', prompt: '  hello  ' });

    expect(generateContent).toHaveBeenCalledWith(expect.objectContaining({ contents: 'hello' }));
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
