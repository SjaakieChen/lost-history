import { describe, expect, it } from 'vitest';
import { parseGeminiGroundingMetadata } from '../../server/gemini/grounding.js';

describe('parseGeminiGroundingMetadata', () => {
  it('reads webSearchQueries and groundingChunks', () => {
    const tools = parseGeminiGroundingMetadata({
      groundingMetadata: {
        webSearchQueries: ['news today', 'weather'],
        groundingChunks: [
          { web: { uri: 'https://news.example/a', title: 'News A' } },
          { web: { uri: 'https://news.example/b', title: 'News B' } },
        ],
      },
    });

    expect(tools).toHaveLength(1);
    expect(tools?.[0].searchQueries).toEqual(['news today', 'weather']);
    expect(tools?.[0].searchResults).toHaveLength(2);
    expect(tools?.[0].searchResults?.[0].url).toContain('news.example');
  });

  it('returns undefined when metadata absent', () => {
    expect(parseGeminiGroundingMetadata(undefined)).toBeUndefined();
    expect(parseGeminiGroundingMetadata({})).toBeUndefined();
  });
});
