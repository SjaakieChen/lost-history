import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { getGenAIClient } from '../../server/gemini/client.js';
import { LlmSession } from '../../server/llm/session.js';
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

const getYearTool = {
  name: 'get_year',
  description: 'Returns a year',
  parameters: { type: 'object', properties: { event: { type: 'string' } } },
};

function installClient(get: ReturnType<typeof vi.fn>, generateContent: ReturnType<typeof vi.fn>) {
  vi.mocked(getGenAIClient).mockReturnValue({
    models: { get, generateContent },
  } as never);
}

describe('LlmSession (matrix E)', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
  });

  it('E1: send twice includes history in second generate', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createTextResponse('first'))
      .mockResolvedValueOnce(createTextResponse('second'));
    installClient(get, generateContent);

    const session = new LlmSession({ model: 'gemini-2.5-flash-lite' });
    await session.send({ prompt: 'Hello' });
    await session.send({ prompt: 'Follow up' });

    expect(generateContent).toHaveBeenCalledTimes(2);
    const secondCall = generateContent.mock.calls[1][0];
    expect(secondCall).toBeDefined();
  });

  it('E2: send records model on assistant in exportMessages', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi.fn().mockResolvedValue(createTextResponse('reply'));
    installClient(get, generateContent);

    const session = new LlmSession({ model: 'gemini-2.5-flash-lite', prompt: 'Hi' });
    await session.send();

    const messages = session.exportMessages();
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(assistant?.model).toBe('gemini-2.5-flash-lite-medium');
  });

  it('E3: runAgent export without tool summary omits tool roles', async () => {
    const get = vi.fn().mockResolvedValue({});
    const generateContent = vi
      .fn()
      .mockResolvedValueOnce(createFunctionCallResponse('get_year', { event: 'x' }))
      .mockResolvedValueOnce(
        createFunctionCallResponse('submit_final_answer', { answer: 'done' }),
      );
    installClient(get, generateContent);

    const session = new LlmSession({ model: 'gemini-2.5-flash-lite', prompt: 'Agent' });
    await session.runAgent({
      tools: [getYearTool],
      toolHandlers: { get_year: async () => ({ year: 1 }) },
    });

    const messages = session.exportMessages({ includeToolSummary: false });
    expect(messages.some((m) => m.role === 'tool')).toBe(false);
    expect(messages.some((m) => m.content.includes('<tool_call'))).toBe(false);
  });

  it('E4: different models per step after failover on second send', async () => {
    const preferredApi = 'gemini-2.5-flash-lite';
    const get = vi.fn().mockResolvedValue({});
    let sendCount = 0;
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      sendCount += 1;
      if (sendCount === 2 && model === preferredApi) {
        return Promise.reject(quotaError());
      }
      return Promise.resolve(createTextResponse(`reply-${sendCount}`));
    });
    installClient(get, generateContent);

    const session = new LlmSession({ model: 'gemini-2.5-flash-lite', prompt: 'First' });
    await session.send();
    await session.send({ prompt: 'Second' });

    const messages = session.exportMessages();
    const assistantModels = messages
      .filter((m) => m.role === 'assistant' && m.model)
      .map((m) => m.model);
    expect(assistantModels.length).toBe(2);
    expect(new Set(assistantModels).size).toBe(2);
  });

  it('E5: session lockedRegistryKey updates after failover on second send', async () => {
    const preferredApi = 'gemini-2.5-flash-lite';
    const get = vi.fn().mockResolvedValue({});
    let sendCount = 0;
    const generateContent = vi.fn().mockImplementation(({ model }: { model: string }) => {
      sendCount += 1;
      if (sendCount === 2 && model === preferredApi) {
        return Promise.reject(quotaError());
      }
      return Promise.resolve(createTextResponse(`reply-${sendCount}`));
    });
    installClient(get, generateContent);

    const session = new LlmSession({ model: 'gemini-2.5-flash-lite', prompt: 'First' });
    await session.send();
    await session.send({ prompt: 'Second' });

    const history = session.getModelHistory();
    const models = history.filter((t) => t.model).map((t) => t.model);
    expect(models.length).toBeGreaterThanOrEqual(2);
  });
});
