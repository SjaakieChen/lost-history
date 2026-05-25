import { describe, expect, it } from 'vitest';
import { exportToMessages } from '../../server/llm/conversation/export.js';
import type { AgentStep, ChatMessage } from '../../shared/gemini-types.js';

describe('exportToMessages', () => {
  const base: ChatMessage[] = [{ role: 'user', content: 'Start' }];

  it('exports tool rounds with assistant tool_call blocks and tool role messages', () => {
    const steps: AgentStep[] = [
      {
        step: 1,
        model: 'test',
        functionCalls: [{ name: 'fetch_piece', args: { id: 'A' } }],
        toolResults: [{ name: 'fetch_piece', response: { piece: 'A' } }],
      },
      {
        step: 2,
        model: 'test',
        text: 'Done',
      },
    ];

    const messages = exportToMessages(base, steps, { includeToolSummary: true });
    expect(messages[0]).toEqual({ role: 'user', content: 'Start' });
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].content).toContain('<tool_call name="fetch_piece">');
    expect(messages[2]).toEqual({
      role: 'tool',
      toolName: 'fetch_piece',
      content: '{"piece":"A"}',
      model: 'test',
    });
    expect(messages[3]).toEqual({ role: 'assistant', content: 'Done', model: 'test' });
  });

  it('omits tool messages when includeToolSummary is false', () => {
    const steps: AgentStep[] = [
      {
        step: 1,
        model: 'test',
        functionCalls: [{ name: 'fetch_piece', args: { id: 'A' } }],
        toolResults: [{ name: 'fetch_piece', response: { piece: 'A' } }],
      },
      {
        step: 2,
        model: 'test',
        text: 'Done',
      },
    ];

    const messages = exportToMessages(base, steps, { includeToolSummary: false });
    expect(messages).toEqual([
      { role: 'user', content: 'Start' },
      { role: 'assistant', content: 'Done', model: 'test' },
    ]);
  });
});
