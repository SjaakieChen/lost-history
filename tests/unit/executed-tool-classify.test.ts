import { describe, expect, it } from 'vitest';
import { assertUnifiedCallOutput } from '../helpers/capability-output-expectations.js';
import type { CallLlmResult, ChatMessage } from '../../shared/gemini-types.js';

describe('executed tool transcript alignment', () => {
  it('Groq search tool with output does not require code_execution tag', () => {
    const result: CallLlmResult = {
      text: "Today's UTC calendar date is 25 May 2026.",
      registryKey: 'groq--compound-mini-off',
      model: 'groq/compound-mini',
      thinkingUsed: false,
      thinkingPowerApplied: 'off',
      executedTools: [
        {
          type: 'search',
          output: 'Title: UTC Time Now\nURL: https://www.utctime.net',
          searchResults: [{ title: 'UTC Time Now', url: 'https://www.utctime.net' }],
        },
      ],
    };
    const messages: ChatMessage[] = [
      { role: 'user', content: 'UTC date?' },
      {
        role: 'assistant',
        content: `${result.text}\n\n<web_search>\n{"sources":[{"title":"UTC Time Now","url":"https://www.utctime.net"}]}\n</web_search>`,
        model: result.registryKey,
      },
    ];

    expect(() =>
      assertUnifiedCallOutput(result, messages, { registryPattern: /^groq--compound/ }),
    ).not.toThrow();
  });
});
