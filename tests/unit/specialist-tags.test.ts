import { describe, expect, it } from 'vitest';
import {
  formatCodeExecutionBlock,
  formatExecutedToolsAsTags,
  formatWebSearchBlock,
  parseCodeExecutionBlocks,
  parseWebSearchBlocks,
  stripSpecialistBlocks,
} from '../../server/llm/conversation/specialist-tags.js';
import type { LlmExecutedTool } from '../../shared/gemini-types.js';

describe('specialist-tags', () => {
  it('round-trips web_search blocks', () => {
    const block = formatWebSearchBlock({
      queries: ['latest news'],
      sources: [{ title: 'Example', url: 'https://example.com' }],
    });
    const parsed = parseWebSearchBlocks(block);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].queries).toEqual(['latest news']);
    expect(parsed[0].sources?.[0]?.url).toBe('https://example.com');
  });

  it('round-trips code_execution blocks', () => {
    const block = formatCodeExecutionBlock({
      code: 'print(42)',
      output: '42',
      type: 'python',
    });
    const parsed = parseCodeExecutionBlocks(block);
    expect(parsed[0].output).toBe('42');
    expect(stripSpecialistBlocks(`Answer\n\n${block}`)).toBe('Answer');
  });

  it('formats executed tools as tags', () => {
    const tools: LlmExecutedTool[] = [
      {
        type: 'python',
        output: '426758565',
        arguments: 'print(98765*4321)',
      },
      {
        searchQueries: ['utc date'],
        searchResults: [{ title: 'Time', url: 'https://time.is' }],
      },
    ];
    const tags = formatExecutedToolsAsTags(tools);
    expect(tags).toContain('<code_execution>');
    expect(tags).toContain('<web_search>');
  });
});
