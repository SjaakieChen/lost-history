import { vi } from 'vitest';

export function groqTextResponse(
  content: string,
  overrides: {
    reasoning?: string;
    executed_tools?: unknown[];
    model?: string;
  } = {},
) {
  return {
    model: overrides.model ?? 'groq/compound',
    choices: [
      {
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content,
          ...(overrides.reasoning ? { reasoning: overrides.reasoning } : {}),
          ...(overrides.executed_tools ? { executed_tools: overrides.executed_tools } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

export function groqCodeExecutionResponse(product = '426758565') {
  return groqTextResponse(product, {
    model: 'openai/gpt-oss-20b',
    reasoning: 'ran python',
    executed_tools: [
      {
        name: 'python',
        type: 'function',
        arguments: 'print(98765*4321)',
        code_results: [{ text: product }],
      },
    ],
  });
}

export function groqWebSearchResponse(answer = 'Today is 25 May 2026.') {
  return groqTextResponse(answer, {
    model: 'groq/compound-mini',
    reasoning: 'used search',
    executed_tools: [
      {
        type: 'search',
        search_results: {
          results: [
            {
              title: 'Time',
              url: 'https://time.is',
              content: 'UTC',
              score: 0.9,
            },
          ],
        },
      },
    ],
  });
}

export function installGroqClientMock(create: ReturnType<typeof vi.fn>) {
  return {
    chat: { completions: { create } },
  };
}
