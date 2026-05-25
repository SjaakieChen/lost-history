import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlmAgent } from '../../server/gemini/call-llm-agent.js';
import { getGenAIClient } from '../../server/gemini/client.js';
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


const getYearTool = {
  name: 'get_year',
  description: 'Returns a year for an event',
  parameters: {
    type: 'object',
    properties: { event: { type: 'string' } },
    required: ['event'],
  },
};

function installGemini(get: ReturnType<typeof vi.fn>, generateContent: ReturnType<typeof vi.fn>) {
  vi.mocked(getGenAIClient).mockReturnValue({
    models: { get, generateContent },
  } as never);
}

describe('callLlmAgent failover (matrix C/D)', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  it('C1: healthy run pins same registryKey across steps', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('get_year', { event: 'x' }))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'done' }),
      );
    installGemini(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'When?',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 476 }) },
    });

    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.steps.every((s) => s.model === result.registryKey)).toBe(true);
    expect(result.registryKey).toBe('gemini-3.5-flash-medium');
  });

  it('C2: step 1 preferred quota failovers and agent completes', async () => {
    const preferredApi = 'gemini-3.5-flash';
    let callCount = 0;
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      callCount += 1;
      if (model === preferredApi && callCount === 1) {
        return Promise.reject(quotaError());
      }
      if (callCount === 1 || callCount === 2) {
        return Promise.resolve(createFunctionCallResponse('get_year', { event: 'Rome' }));
      }
      return Promise.resolve(
        createFunctionCallResponse('submit_final_answer', { answer: '476' }),
      );
    });
    installGemini(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'When did Rome fall?',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 476 }) },
    });

    expect(result.terminationReason).toBe('final_tool');
    expect(result.modelsAttempted!.length).toBeGreaterThanOrEqual(1);
  });

  it('C3: step 2 pinned quota failovers and agent completes', async () => {
    const preferredApi = 'gemini-3.5-flash';
    let generateCalls = 0;
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      generateCalls += 1;
      if (generateCalls === 2 && model === preferredApi) {
        return Promise.reject(quotaError());
      }
      if (generateCalls === 1 || generateCalls === 3) {
        return Promise.resolve(createFunctionCallResponse('get_year', { event: 'x' }));
      }
      return Promise.resolve(
        createFunctionCallResponse('submit_final_answer', { answer: 'done' }),
      );
    });
    installGemini(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'Multi step',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 1 }) },
    });

    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.terminationReason).toBe('final_tool');
    expect(generateContent.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('C10: exported messages include tool transcript and per-step models', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('get_year', { event: 'x' }))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'done' }),
      );
    installGemini(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'Export test',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 1 }) },
    });

    const assistantWithTool = result.messages?.find(
      (m) => m.role === 'assistant' && m.content.includes('<tool_call'),
    );
    expect(assistantWithTool?.model).toBe(result.registryKey);
  });

  it('D1: cross-provider failover completes agent run', async () => {
    const groqKey = 'openai/gpt-oss-20b';
    const create = vi.fn().mockRejectedValue(quotaError());
    vi.mocked(getGroqClient).mockReturnValue({
      chat: { completions: { create } },
    } as never);

    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('get_year', { event: 'x' }))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'cross' }),
      );
    installGemini(get, generateContent);

    const result = await callLlmAgent({
      model: groqKey,
      prompt: 'Cross provider',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 1 }) },
    });

    expect(result.terminationReason).toBe('final_tool');
    expect(result.text).toBe('cross');
    expect(create).toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalled();
  });

  it('D2: same provider failover keeps agent on gemini registry keys', async () => {
    const preferredApi = 'gemini-3.5-flash';
    let step = 0;
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      step += 1;
      if (step === 2 && model === preferredApi) {
        return Promise.reject(quotaError());
      }
      if (step === 1 || step === 3) {
        return Promise.resolve(createFunctionCallResponse('get_year', { event: 'x' }));
      }
      return Promise.resolve(
        createFunctionCallResponse('submit_final_answer', { answer: 'ok' }),
      );
    });
    installGemini(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'Same provider failover',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 1 }) },
    });

    expect(result.steps.length).toBeGreaterThanOrEqual(2);
    expect(result.steps.every((s) => s.model.startsWith('gemini'))).toBe(true);
    expect(result.terminationReason).toBe('final_tool');
  });
});
