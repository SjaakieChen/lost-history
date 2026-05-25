import { describe, expect, it } from 'vitest';
import { createThreadState } from '../../server/llm/conversation/bootstrap.js';
import { normalizeImportedMessages } from '../../server/llm/conversation/import.js';
import { resolveTextModel } from '../../server/gemini/models.js';
import type { ChatMessage } from '../../shared/gemini-types.js';

const transcriptWithSpecialists: ChatMessage[] = [
  { role: 'user', content: 'Search and compute' },
  {
    role: 'assistant',
    content: [
      'Answer here.',
      '',
      '<web_search>',
      '{"queries":["q1"],"sources":[{"title":"S","url":"https://s.test"}]}',
      '</web_search>',
      '',
      '<code_execution>',
      '{"code":"print(1)","output":"1","type":"python"}',
      '</code_execution>',
    ].join('\n'),
    thoughts: 'reasoning blob',
    model: 'groq--compound-off',
  },
];

describe('normalizeImportedMessages — specialist tags', () => {
  it('preserveToolRole: keeps tags as separate assistant lines + visible text', () => {
    const normalized = normalizeImportedMessages(transcriptWithSpecialists, {
      preserveToolRole: true,
    });

    expect(normalized.some((message) => message.content === 'Answer here.')).toBe(true);
    expect(normalized.some((message) => message.content.includes('<web_search>'))).toBe(true);
    expect(normalized.some((message) => message.content.includes('<code_execution>'))).toBe(true);
    expect(normalized.find((message) => message.thoughts === 'reasoning blob')).toBeDefined();
  });

  it('preserveToolRole false: flattens specialist tags to user summary lines', () => {
    const normalized = normalizeImportedMessages(transcriptWithSpecialists, {
      preserveToolRole: false,
    });

    expect(normalized.some((message) => message.content.startsWith('[Web search'))).toBe(true);
    expect(normalized.some((message) => message.content.startsWith('[Code execution'))).toBe(true);
    expect(normalized.some((message) => message.content.includes('<web_search>'))).toBe(false);
  });

  it('Groq rebuild from portable transcript includes flattened code context', () => {
    const normalized = normalizeImportedMessages(transcriptWithSpecialists, {
      preserveToolRole: false,
    });
    const resolved = resolveTextModel('openai/gpt-oss-20b');
    const thread = createThreadState(resolved, { messages: normalized, prompt: 'Follow up' });

    expect(thread.provider).toBe('groq');
    if (thread.provider === 'groq') {
      const blob = JSON.stringify(thread.messages);
      expect(blob).toMatch(/Code execution|Web search|Follow up/);
    }
  });

  it('Gemini rebuild from portable transcript encodes user summaries', () => {
    const normalized = normalizeImportedMessages(transcriptWithSpecialists, {
      preserveToolRole: false,
    });
    const resolved = resolveTextModel('gemini-3.5-flash');
    const thread = createThreadState(resolved, { messages: normalized });

    expect(thread.provider).toBe('gemini');
    if (thread.provider === 'gemini') {
      const blob = JSON.stringify(thread.contents);
      expect(blob).toMatch(/Code execution|Web search/);
    }
  });
});
