import { describe, expect, it } from 'vitest';
import { parseGroqExecutedTools } from '../../server/groq/groq-message.js';

describe('parseGroqExecutedTools', () => {
  it('normalizes python and search_results entries', () => {
    const tools = parseGroqExecutedTools([
      {
        name: 'python',
        type: 'function',
        arguments: 'print(1)',
        code_results: [{ text: '1' }],
      },
      {
        type: 'search',
        search_results: {
          results: [{ title: 'T', url: 'https://t.test', content: 'c', score: 0.5 }],
        },
      },
    ]);

    expect(tools).toHaveLength(2);
    expect(tools?.[0].codeResults?.[0].text).toBe('1');
    expect(tools?.[1].searchResults?.[0].url).toBe('https://t.test');
  });
});
