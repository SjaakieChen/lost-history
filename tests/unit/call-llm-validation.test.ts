import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlm, resolveCallModel, LlmCapabilityError } from '../../server/gemini/call-llm.js';
import { GeminiQuotaError } from '../../server/gemini/rate-limit.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import { createTextResponse, quotaError } from '../helpers/mock-genai.js';

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

  it('throws when prompt, messages, and contents are all missing', async () => {
    await expect(callLlm({ model: 'gemini-2.5-flash-lite' })).rejects.toThrow(
      'Either contents, prompt, or messages is required.',
    );
  });

  it('throws when prompt is whitespace only', async () => {
    await expect(
      callLlm({ model: 'gemini-2.5-flash-lite', prompt: '   ' }),
    ).rejects.toThrow('Either contents, prompt, or messages is required.');
  });

  it('throws when messages array is empty', async () => {
    await expect(
      callLlm({ model: 'gemini-2.5-flash-lite', messages: [] }),
    ).rejects.toThrow('Either contents, prompt, or messages is required.');
  });

  it('throws when contents array is empty', async () => {
    await expect(
      callLlm({ model: 'gemini-2.5-flash-lite', contents: [] }),
    ).rejects.toThrow('Either contents, prompt, or messages is required.');
  });

  it('throws LlmCapabilityError for structuredOutput on gemini-2.5-flash-lite', async () => {
    installClient(vi.fn());

    await expect(
      callLlm({
        model: 'gemini-2.5-flash-lite',
        prompt: 'hello',
        structuredOutput: { responseSchema: { type: 'object' } },
      }),
    ).rejects.toThrow(LlmCapabilityError);
  });

  it('throws LlmCapabilityError for structuredOutput on gemini-2.0-flash', async () => {
    installClient(vi.fn());

    await expect(
      callLlm({
        model: 'gemini-2.0-flash',
        prompt: 'hello',
        structuredOutput: { responseJsonSchema: { type: 'object' } },
      }),
    ).rejects.toMatchObject({
      name: 'LlmCapabilityError',
      model: 'gemini-2.0-flash',
      capability: 'structuredOutput',
    });
  });

  it('passes function-calling capability check for gemini-2.0-flash before API', async () => {
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('ok'));
    installClient(generateContent);

    await callLlm({
      model: 'gemini-2.0-flash',
      prompt: 'hello',
      tools: [{ name: 'get_answer', description: 'Returns an answer' }],
    });

    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('explicit model throws on quota without trying other models', async () => {
    const generateContent = vi.fn().mockRejectedValue(quotaError());
    installClient(generateContent);

    await expect(
      callLlm({ model: 'gemini-2.5-flash-lite', prompt: 'hello' }),
    ).rejects.toBeInstanceOf(GeminiQuotaError);

    expect(generateContent).toHaveBeenCalledOnce();
  });

  it('warns for models without free tier availability', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('ok'));
    installClient(generateContent);

    await callLlm({ model: 'gemini-2.5-pro', prompt: 'hello' });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('gemini-2.5-pro'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('free-tier quota'));
    warnSpy.mockRestore();
  });
});

describe('resolveCallModel', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('returns explicit model registry key', () => {
    expect(resolveCallModel({ model: 'gemini-3-flash' })).toBe('gemini-3-flash');
  });

  it('returns strongest tier default when thinkingPowerTier is medium', () => {
    expect(resolveCallModel({ thinkingPowerTier: 'medium' })).toBe('gemini-3.5-flash');
  });

  it('falls back to default model id when no model or tier', () => {
    expect(resolveCallModel({})).toBe('gemini-3.1-flash-lite');
  });
});
