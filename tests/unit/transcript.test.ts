import { describe, expect, it } from 'vitest';
import { buildTranscriptTurnFromResult } from '../../server/llm/conversation/transcript.js';

describe('buildTranscriptTurnFromResult', () => {
  it('embeds specialist tags and thoughts on assistant message', () => {
    const messages = buildTranscriptTurnFromResult({
      userPrompt: 'Search and compute',
      result: {
        text: 'The answer is 42.',
        thoughts: 'Used search then python.',
        registryKey: 'groq--compound-off',
        executedTools: [
          {
            searchQueries: ['foo'],
            searchResults: [{ title: 'Bar', url: 'https://bar.test' }],
          },
          { type: 'python', output: '42', arguments: 'print(42)' },
        ],
      },
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('The answer is 42.');
    expect(messages[1].content).toContain('<web_search>');
    expect(messages[1].content).toContain('<code_execution>');
    expect(messages[1].thoughts).toContain('python');
    expect(messages[1].model).toBe('groq--compound-off');
  });
});
