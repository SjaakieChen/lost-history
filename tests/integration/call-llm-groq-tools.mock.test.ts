import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlm, type InternalCallLlmOptions } from '../../server/gemini/call-llm.js';
import { createGroqThread } from '../../server/llm/conversation/groq-thread.js';
import { getGroqClient } from '../../server/groq/client.js';

vi.mock('../../server/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/config.js')>();
  return {
    ...actual,
    getGroqApiKey: vi.fn(() => 'test-groq-key'),
  };
});

vi.mock('../../server/gemini/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/gemini/rate-limit.js')>();
  return {
    ...actual,
    withRateLimitAndRetry: vi.fn((_key, _hints, operation: () => Promise<unknown>) => operation()),
  };
});

vi.mock('../../server/groq/client.js', () => ({
  getGroqClient: vi.fn(),
}));

function installGroqClient(create: ReturnType<typeof vi.fn>) {
  vi.mocked(getGroqClient).mockReturnValue({
    chat: { completions: { create } },
  } as never);
}

describe('callLlm Groq tool thread', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  it('sends assistant tool_calls and tool result messages on follow-up turn', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({
        model: 'llama-3.1-8b-instant',
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'get_year', arguments: '{"event":"x"}' },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        model: 'llama-3.1-8b-instant',
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: '1900' },
          },
        ],
      });
    installGroqClient(create);

    const thread = createGroqThread([
      { role: 'user', content: 'Year?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_year', arguments: '{"event":"x"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"year":1900}' },
    ]);

    const options: InternalCallLlmOptions = {
      model: 'llama-3.1-8b-instant',
      threadState: thread,
      tools: [
        {
          name: 'get_year',
          description: 'Get year',
          parameters: { type: 'object', properties: { event: { type: 'string' } } },
        },
      ],
    };

    await callLlm(options);

    expect(create).toHaveBeenCalledTimes(1);
    const messages = create.mock.calls[0][0].messages;
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: 'Year?' }),
        expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'call_1' }),
      ]),
    );
  });
});
