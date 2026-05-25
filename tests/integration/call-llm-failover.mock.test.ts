import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markExhausted, resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlm, LlmCapabilityError } from '../../server/gemini/call-llm.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import { GeminiQuotaError } from '../../server/gemini/rate-limit.js';
import {
  iterateSpeedTierBatches,
  iterateSpeedTierBatchesForFailover,
} from '../../server/gemini/model-selection.js';
import { getGroqClient } from '../../server/groq/client.js';
import {
  createFunctionCallResponse,
  createTextResponse,
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

vi.mock('../../server/groq/client.js', () => ({
  getGroqClient: vi.fn(),
}));

function installGemini(get: ReturnType<typeof vi.fn>, generateContent: ReturnType<typeof vi.fn>) {
  vi.mocked(getGenAIClient).mockReturnValue({
    models: { get, generateContent },
  } as never);
}

function installGroq(create: ReturnType<typeof vi.fn>) {
  vi.mocked(getGroqClient).mockReturnValue({
    chat: { completions: { create } },
  } as never);
}

describe('callLlm failover (matrix A)', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  it('A1: preferred model succeeds with registryKey and explicit metadata', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('ok'));
    installGemini(get, generateContent);

    const result = await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });

    expect(result.text).toBe('ok');
    expect(result.registryKey).toBe('gemini-2.5-flash-lite-medium');
    expect(result.modelSelectedBy).toBe('explicit');
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('A2: preferred quota then same-tier alternate succeeds', async () => {
    const preferredApi = 'gemini-2.5-flash-lite';
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === preferredApi) {
        return Promise.reject(quotaError());
      }
      return Promise.resolve(createTextResponse('tier win'));
    });
    installGemini(get, generateContent);

    const result = await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });

    expect(result.text).toBe('tier win');
    expect(result.modelSelectedBy).toBe('preferred_failover');
    expect(result.modelsAttempted!.length).toBeGreaterThanOrEqual(2);
  });

  it('A4: all models quota throws GeminiQuotaError', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockRejectedValue(quotaError());
    installGemini(get, generateContent);

    await expect(
      callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' }),
    ).rejects.toBeInstanceOf(GeminiQuotaError);
  });

  it('A5: preferred capability error does not failover', async () => {
    installGemini(vi.fn(), vi.fn());

    await expect(
      callLlm({
        model: 'gemini-2.5-flash-lite',
        prompt: 'Hi',
        structuredOutput: { responseJsonSchema: { type: 'object' } },
      }),
    ).rejects.toBeInstanceOf(LlmCapabilityError);
  });

  it('A6: speedTier only uses tier routing', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('tier'));
    installGemini(get, generateContent);

    const result = await callLlm({ speedTier: 'instant', prompt: 'Hi' });

    expect(result.modelSelectedBy).toBe('tier');
    expect(result.registryKey).toBeTruthy();
  });

  it('A7: preferred is not double-called in tier loop', async () => {
    const preferredApi = 'gemini-2.5-flash-lite';
    const get = vi.fn().mockResolvedValue({});
    const preferredCalls: string[] = [];
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === preferredApi) {
        preferredCalls.push(model);
        return Promise.reject(quotaError());
      }
      return Promise.resolve(createTextResponse('alt'));
    });
    installGemini(get, generateContent);

    await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });

    expect(preferredCalls).toHaveLength(1);
  });

  it('A8: locally exhausted preferred is skipped in tier loop after quota', async () => {
    markExhausted('gemini-2.5-flash-lite-medium');
    const preferredApi = 'gemini-2.5-flash-lite';
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === preferredApi) {
        return Promise.reject(quotaError());
      }
      return Promise.resolve(createTextResponse('after exhaust'));
    });
    installGemini(get, generateContent);

    const result = await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });

    expect(result.text).toBe('after exhaust');
    expect(result.registryKey).not.toBe('gemini-2.5-flash-lite-medium');
    expect(result.modelSelectedBy).toBe('preferred_failover');
  });

  it('A3: tier downgrade when instant tier is exhausted', async () => {
    const tierBatches = [...iterateSpeedTierBatches({ speedTier: 'instant' })];
    const instantCandidates = tierBatches[0].candidates;

    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn();
    for (let i = 0; i < instantCandidates.length; i += 1) {
      generateContent.mockRejectedValueOnce(quotaError());
    }
    generateContent.mockResolvedValueOnce(createTextResponse('downgraded'));
    installGemini(get, generateContent);

    const result = await callLlm({ speedTier: 'instant', prompt: 'Hi' });

    expect(result.text).toBe('downgraded');
    expect(result.speedTierDowngraded).toBe(true);
    expect(result.speedTierRequested).toBe('instant');
    expect(result.speedTierUsed).not.toBe('instant');
  });

  it('A9: ping 429 marks model unreachable without global exhaustion leak', async () => {
    const get = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'rate limit' })
      .mockResolvedValue({ name: 'gemini-2.5-flash-lite' });
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('reachable'));
    installGemini(get, generateContent);

    const result = await callLlm({ speedTier: 'instant', prompt: 'Hi' });

    expect(result.text).toBe('reachable');
    expect(get).toHaveBeenCalled();
  });

  it('policy block failovers and logs warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const preferredApi = 'gemini-2.5-flash-lite';
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === preferredApi) {
        const error = new Error('Content blocked by safety policy') as Error & { status: number };
        error.status = 400;
        return Promise.reject(error);
      }
      return Promise.resolve(createTextResponse('policy failover'));
    });
    installGemini(get, generateContent);

    const result = await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });

    expect(result.text).toBe('policy failover');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Policy/safety block'));
    warnSpy.mockRestore();
  });

  it('401 on preferred model failovers to tier candidate', async () => {
    const preferredApi = 'gemini-2.5-flash-lite';
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === preferredApi) {
        const error = new Error('Unauthorized') as Error & { status: number };
        error.status = 401;
        return Promise.reject(error);
      }
      return Promise.resolve(createTextResponse('auth failover'));
    });
    installGemini(get, generateContent);

    const result = await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });

    expect(result.text).toBe('auth failover');
    expect(result.modelSelectedBy).toBe('preferred_failover');
  });

  it('B1: tools required filters to function-calling models only', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(
      createFunctionCallResponse('lookup', { q: 'x' }),
    );
    installGemini(get, generateContent);

    const lookupTool = {
      name: 'lookup',
      description: 'lookup',
      parameters: { type: 'object', properties: {} },
    };

    const result = await callLlm({
      speedTier: 'instant',
      prompt: 'Use tool',
      tools: [lookupTool],
    });

    expect(result.functionCalls?.[0]?.name).toBe('lookup');
    expect(result.registryKey).toBeTruthy();
  });

  it('final error includes blockedModels when all candidates fail', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockRejectedValue(quotaError());
    installGemini(get, generateContent);

    try {
      await callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });
      expect.fail('expected quota error');
    } catch (error) {
      expect(error).toBeInstanceOf(GeminiQuotaError);
      const quotaErr = error as GeminiQuotaError;
      expect(quotaErr.blockedModels?.length).toBeGreaterThan(0);
    }
  });

  it('A10: Groq preferred quota can failover to Gemini tier candidate', async () => {
    const { getGroqApiKey } = await import('../../server/config.js');
    vi.mocked(getGroqApiKey).mockReturnValue('test-groq-key');
    process.env.GROQ_API_KEY = 'test-groq-key';

    const groqKey = 'openai/gpt-oss-20b';
    const create = vi.fn().mockRejectedValue(quotaError());
    installGroq(create);

    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('gemini backup'));
    installGemini(get, generateContent);

    const result = await callLlm({ model: groqKey, prompt: 'Hi' });

    expect(result.text).toBe('gemini backup');
    expect(result.modelSelectedBy).toBe('preferred_failover');
    expect(create).toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalled();
  });
});

describe('callLlm failover tier batches', () => {
  it('iterateSpeedTierBatchesForFailover skips preferred registry key', () => {
    const batches = [
      ...iterateSpeedTierBatchesForFailover(
        { speedTier: 'instant' },
        {},
        'instant',
        'gemini-3.1-flash-lite-minimal',
      ),
    ];
    const keys = batches.flatMap((batch) => batch.candidates.map((c) => c.registryKey));
    expect(keys).not.toContain('gemini-3.1-flash-lite-minimal');
  });
});
