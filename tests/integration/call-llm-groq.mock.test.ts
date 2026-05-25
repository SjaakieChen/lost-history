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
    expect(result.messages?.some((m) => m.role === 'assistant')).toBe(true);
  });

  it('sends code_interpreter when capabilities.codeExecution on GPT-OSS', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'openai/gpt-oss-20b',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '426758565',
            reasoning: 'computed with python',
            executed_tools: [
              {
                name: 'python',
                type: 'function',
                arguments: 'print(98765*4321)',
                code_results: [{ text: '426758565' }],
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    installGroqClient(create);

    const result = await callLlm({
      model: 'openai/gpt-oss-20b',
      capabilities: { codeExecution: true },
      prompt: 'What is 98765 * 4321? Reply with only the integer.',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([{ type: 'code_interpreter' }]),
        tool_choice: 'required',
      }),
    );
    expect(result.executedTools?.length).toBeGreaterThan(0);
    expect(result.thoughts).toContain('python');
    expect(result.messages?.[1].content).toContain('<code_execution>');
  });

  it('parses Compound executed_tools for web search', async () => {
    const create = vi.fn().mockResolvedValue({
      model: 'groq/compound-mini',
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: 'Today is 25 May 2026.',
            reasoning: 'search tool used',
            executed_tools: [
              {
                type: 'search',
                search_results: {
                  results: [
                    {
                      title: 'Time',
                      url: 'https://time.is',
                      content: 'UTC date',
                      score: 0.9,
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    });
    installGroqClient(create);

    const result = await callLlm({
      model: 'groq/compound-mini',
      capabilities: { webSearch: true },
      prompt: 'What is today in UTC?',
    });

    expect(result.executedTools?.[0].searchResults?.length).toBe(1);
    expect(result.messages?.[1].content).toContain('<web_search>');
  });
});
