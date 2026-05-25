import { describe, expect, it } from 'vitest';
import { resolveTextModel } from '../../server/gemini/models.js';
import { createThreadState } from '../../server/llm/conversation/bootstrap.js';
import { rebuildThreadForProvider } from '../../server/llm/conversation/rebuild.js';
import { normalizeImportedMessages } from '../../server/llm/conversation/import.js';
import type { ChatMessage } from '../../shared/gemini-types.js';

describe('rebuildThreadForProvider (matrix D3/F)', () => {
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' },
  ];

  it('D3: rebuilds valid Gemini thread from messages', () => {
    const resolved = resolveTextModel('gemini-2.5-flash-lite');
    const thread = rebuildThreadForProvider(messages, 'You are helpful', resolved);

    expect(thread.provider).toBe('gemini');
    if (thread.provider === 'gemini') {
      expect(thread.contents.length).toBeGreaterThan(0);
    }
  });

  it('D3: rebuilds valid Groq thread from messages', () => {
    const resolved = resolveTextModel('openai/gpt-oss-20b');
    const thread = rebuildThreadForProvider(messages, 'You are helpful', resolved);

    expect(thread.provider).toBe('groq');
    if (thread.provider === 'groq') {
      expect(thread.messages.length).toBeGreaterThan(0);
    }
  });

  it('F2: createThreadState preserves tool role when model supports function calling', () => {
    const resolved = resolveTextModel('gemini-2.5-flash-lite');
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Run tool' },
      { role: 'tool', toolName: 'get_year', content: '{"year":476}' },
    ];
    const thread = createThreadState(resolved, { messages });

    expect(thread.provider).toBe('gemini');
    if (thread.provider === 'gemini') {
      const hasToolResponse = thread.contents.some((content) =>
        content.parts?.some((part) => 'functionResponse' in part),
      );
      expect(hasToolResponse).toBe(true);
    }
  });

  it('F3: normalizeImportedMessages flattens tool to user when preserveToolRole false', () => {
    const imported: ChatMessage[] = [
      { role: 'user', content: 'Run tool' },
      { role: 'tool', toolName: 'get_year', content: '{"year":476}' },
    ];

    const normalized = normalizeImportedMessages(imported, { preserveToolRole: false });
    const toolAsUser = normalized.find((m) => m.role === 'user' && m.content.includes('[Tool result'));
    expect(toolAsUser).toBeDefined();
    expect(normalized.some((m) => m.role === 'tool')).toBe(false);
  });
});
