import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetExhaustionState } from '../../server/gemini/availability.js';
import { callLlm } from '../../server/gemini/call-llm.js';
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

describe('callLlm with mocked Groq client', () => {
  beforeEach(() => {
    resetExhaustionState();
    vi.clearAllMocks();
    process.env.GROQ_API_KEY = 'test-groq-key';
  });

  it('calls Groq chat.completions for groq registry model', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'openai/gpt-oss-20b',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'Hello from Groq' },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
    installGroqClient(create);

    const result = await callLlm({
      model: 'openai/gpt-oss-20b',
      prompt: 'Say hello',
    });

    expect(result.text).toBe('Hello from Groq');
    expect(result.model).toBe('openai/gpt-oss-20b');
    expect(result.thinkingUsed).toBe(false);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'openai/gpt-oss-20b',
        messages: [{ role: 'user', content: 'Say hello' }],
      }),
    );
  });
});
