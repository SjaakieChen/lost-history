import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import {
  callLlm,
  resolveCallModel,
  CallLlmValidationError,
  LlmCapabilityError,
} from '../../server/gemini/call-llm.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import { SPEED_TIER_MODEL_ORDER } from '../../server/gemini/models.js';
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

function installClient(generateContent: ReturnType<typeof vi.fn>, get = vi.fn().mockResolvedValue({})) {
  vi.mocked(getGenAIClient).mockReturnValue({
    models: { get, generateContent },
  } as never);
  return { get, generateContent };
}

describe('callLlm validation (before API)', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
  });

  it('throws when prompt and messages are both missing', async () => {
    await expect(callLlm({ model: 'gemini-3.5-flash' })).rejects.toThrow(
      'Either prompt or messages is required.',
    );
  });

  it('throws when prompt is whitespace only', async () => {
    await expect(
      callLlm({ model: 'gemini-3.5-flash', prompt: '   ' }),
    ).rejects.toThrow('Either prompt or messages is required.');
  });

  it('throws when messages array is empty', async () => {
    await expect(
      callLlm({ model: 'gemini-3.5-flash', messages: [] }),
    ).rejects.toThrow('Either prompt or messages is required.');
  });

  it('throws CallLlmValidationError when tools provided without capabilities.tools', async () => {
    await expect(
      callLlm({
        model: 'gemini-3.5-flash',
        prompt: 'hello',
        tools: [{ name: 'fn', description: 'd' }],
      }),
    ).rejects.toThrow(CallLlmValidationError);
  });

  it('throws LlmCapabilityError for structuredJson on allam-2-7b-off', async () => {
    installClient(vi.fn());

    await expect(
      callLlm({
        model: 'allam-2-7b-off',
        prompt: 'hello',
        capabilities: { structuredJson: true },
        structuredOutput: { responseSchema: { type: 'object' } },
      }),
    ).rejects.toThrow(LlmCapabilityError);
  });

  it('throws LlmCapabilityError for strictJson on groq compound', async () => {
    installClient(vi.fn());

    await expect(
      callLlm({
        model: 'groq--compound-off',
        prompt: 'hello',
        capabilities: { structuredJson: true, strictJson: true },
        structuredOutput: { responseJsonSchema: { type: 'object' } },
      }),
    ).rejects.toMatchObject({
      name: 'LlmCapabilityError',
      model: 'groq--compound-off',
      capability: 'strictJson',
    });
  });

  it('passes function-calling capability check for gemini-3.5-flash before API', async () => {
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('ok'));
    installClient(generateContent);

    await callLlm({
      model: 'gemini-3.5-flash',
      prompt: 'hello',
      capabilities: { tools: true },
      tools: [{ name: 'get_answer', description: 'Returns an answer' }],
    });

    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('explicit model failovers on quota (A2)', async () => {
    const preferredApi = 'gemini-3.5-flash';
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      if (model === preferredApi) {
        return Promise.reject(quotaError());
      }
      return Promise.resolve(createTextResponse('failover ok'));
    });
    installClient(generateContent, get);

    const result = await callLlm({ model: 'gemini-3.5-flash', prompt: 'hello' });

    expect(result.text).toBe('failover ok');
    expect(result.modelSelectedBy).toBe('preferred_failover');
    expect(result.modelsAttempted!.length).toBeGreaterThanOrEqual(2);
    expect(generateContent.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('explicit model throws LlmCapabilityError without tier failover', async () => {
    installClient(vi.fn());

    await expect(
      callLlm({
        model: 'allam-2-7b-off',
        prompt: 'hello',
        capabilities: { structuredJson: true },
        structuredOutput: { responseJsonSchema: { type: 'object' } },
      }),
    ).rejects.toBeInstanceOf(LlmCapabilityError);
  });

  it('warns for models without free tier availability', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('ok'));
    installClient(generateContent);

    await callLlm({ model: 'gemini-3.1-pro-high', prompt: 'hello' });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('gemini-3.1-pro-high'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('free-tier quota'));
    warnSpy.mockRestore();
  });
});

describe('resolveCallModel', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('returns explicit model registry key', () => {
    expect(resolveCallModel({ model: 'gemini-3.5-flash' })).toBe('gemini-3.5-flash-medium');
  });

  it('returns strongest moderate tier default when speedTier is moderate', () => {
    expect(resolveCallModel({ speedTier: 'moderate' })).toBe(
      SPEED_TIER_MODEL_ORDER.moderate[0],
    );
  });

  it('falls back to default model id when no model or tier', () => {
    expect(resolveCallModel({})).toBe('gemini-3.1-flash-lite-low');
  });
});
