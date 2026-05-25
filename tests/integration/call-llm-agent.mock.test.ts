import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlmAgent } from '../../server/gemini/call-llm-agent.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import {
  createFunctionCallResponse,
  createFunctionCallsResponse,
  createTextResponse,
  createThoughtResponse,
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

const getYearTool = {
  name: 'get_year',
  description: 'Returns a year for an event',
  parameters: {
    type: 'object',
    properties: { event: { type: 'string' } },
    required: ['event'],
  },
};

function installClient(get: ReturnType<typeof vi.fn>, generateContent: ReturnType<typeof vi.fn>) {
  vi.mocked(getGenAIClient).mockReturnValue({
    models: { get, generateContent },
  } as never);
}

describe('callLlmAgent with mocked GenAI client', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
  });

  it('runs tool rounds then terminates via submit_final_answer', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('get_year', { event: 'fall of Rome' }))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'Rome fell in 476 AD.' }),
      );
    installClient(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'When did Rome fall?',
      tools: [getYearTool],
      toolHandlers: {
        get_year: async () => ({ year: 476 }),
      },
    });

    expect(result.terminationReason).toBe('final_tool');
    expect(result.text).toBe('Rome fell in 476 AD.');
    expect(result.stepCount).toBe(2);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(result.steps[0].toolResults).toEqual([
      { name: 'get_year', response: { year: 476 } },
    ]);
  });

  it('terminates via natural text fallback when model skips submit_final_answer', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('get_year', { event: 'fall of Rome' }))
      .mockResolvedValueOnce(createTextResponse('Rome fell in 476 AD.'));
    installClient(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'When did Rome fall?',
      tools: [getYearTool],
      toolHandlers: {
        get_year: async () => ({ year: 476 }),
      },
    });

    expect(result.terminationReason).toBe('natural');
    expect(result.text).toBe('Rome fell in 476 AD.');
    expect(result.stepCount).toBe(2);
  });

  it('returns handler error in functionResponse for unknown tools and continues', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('missing_tool', { q: 'x' }))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'Recovered.' }),
      );
    installClient(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'Try a tool',
      tools: [getYearTool],
      toolHandlers: {
        get_year: async () => ({ year: 476 }),
      },
    });

    expect(result.text).toBe('Recovered.');
    expect(result.steps[0].toolResults?.[0].response.error).toContain('missing_tool');
  });

  it('executes parallel function calls in one turn', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(
        createFunctionCallsResponse([
          { name: 'get_year', args: { event: 'a' }, id: 'fc-a' },
          { name: 'get_year', args: { event: 'b' }, id: 'fc-b' },
        ]),
      )
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'Both years found.' }),
      );
    installClient(get, generateContent);

    const handler = vi.fn(async ({ event }: Record<string, unknown>) => ({
      year: event === 'a' ? 100 : 200,
    }));

    const result = await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'Get both years',
      tools: [getYearTool],
      toolHandlers: { get_year: handler },
    });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.steps[0].toolResults).toHaveLength(2);
    expect(result.terminationReason).toBe('final_tool');
  });

  it('throws AgentMaxStepsError when maxSteps is exceeded', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValue(createFunctionCallResponse('get_year', { event: 'loop' }));
    installClient(get, generateContent);

    await expect(
      callLlmAgent({
        model: 'gemini-3.5-flash',
        prompt: 'Loop forever',
        tools: [getYearTool],
        toolHandlers: { get_year: async () => ({ year: 1 }) },
        maxSteps: 2,
      }),
    ).rejects.toMatchObject({
      name: 'AgentMaxStepsError',
      maxSteps: 2,
      steps: expect.arrayContaining([expect.objectContaining({ step: 1 }), expect.objectContaining({ step: 2 })]),
    });
  });

  it('pins the same model across agent steps', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('get_year', { event: 'x' }))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'done' }),
      );
    installClient(get, generateContent);

    await callLlmAgent({
      model: 'gemini-3.5-flash',
      prompt: 'Pin model',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 1 }) },
    });

    const models = generateContent.mock.calls.map((call) => call[0].model);
    expect(models).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash']);
  });

  it('accumulates thoughts across steps', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createThoughtResponse('thinking step 1', ''))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'Final.' }),
      );
    installClient(get, generateContent);

    const result = await callLlmAgent({
      model: 'gemini-3.1-flash-lite-low',
      prompt: 'Think then answer',
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 1 }) },
    });

    expect(result.thoughts).toBe('thinking step 1');
    expect(result.steps[0].thoughts).toBe('thinking step 1');
  });
});
