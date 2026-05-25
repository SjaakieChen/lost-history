import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createExhaustionContext,
  isExhausted,
  markExhausted,
  resetExhaustionState,
} from '../../server/gemini/availability.js';
import { callLlm } from '../../server/gemini/call-llm.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import { createTextResponse, quotaError } from '../helpers/mock-genai.js';

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

describe('request-scoped exhaustion', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
  });

  it('isolates exhaustion between separate ExhaustionContext instances', () => {
    const ctxA = createExhaustionContext();
    const ctxB = createExhaustionContext();

    markExhausted('model-a', undefined, undefined, 'test', false, ctxA);
    expect(isExhausted('model-a', Date.now(), ctxA)).toBe(true);
    expect(isExhausted('model-a', Date.now(), ctxB)).toBe(false);
  });

  it('parallel callLlm invocations do not share exhaustion', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === 'gemini-3.5-flash') {
        return Promise.reject(quotaError());
      }
      return Promise.resolve(createTextResponse('ok'));
    });
    vi.mocked(getGenAIClient).mockReturnValue({
      models: { get, generateContent },
    } as never);

    const [first, second] = await Promise.all([
      callLlm({ model: 'gemini-3.5-flash', prompt: 'A' }),
      callLlm({ model: 'gemini-3.5-flash', prompt: 'B' }),
    ]);

    expect(first.text).toBe('ok');
    expect(second.text).toBe('ok');
    expect(generateContent.mock.calls.filter((c) => c[0].model === 'gemini-3.5-flash').length)
      .toBe(2);
  });
});
