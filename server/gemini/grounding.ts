import type { LlmExecutedTool, LlmSearchResult } from '../../shared/gemini-types.js';

type GroundingChunkWeb = {
  uri?: string;
  title?: string;
};

type GroundingChunk = {
  web?: GroundingChunkWeb;
};

type GroundingMetadataRaw = {
  webSearchQueries?: string[];
  web_search_queries?: string[];
  groundingChunks?: GroundingChunk[];
  grounding_chunks?: GroundingChunk[];
};

function readQueries(meta: GroundingMetadataRaw): string[] {
  const queries = meta.webSearchQueries ?? meta.web_search_queries;
  return Array.isArray(queries) ? queries.filter((q) => typeof q === 'string') : [];
}

function readChunks(meta: GroundingMetadataRaw): GroundingChunk[] {
  const chunks = meta.groundingChunks ?? meta.grounding_chunks;
  return Array.isArray(chunks) ? chunks : [];
}

export function parseGeminiGroundingMetadata(
  candidate: Record<string, unknown> | undefined,
): LlmExecutedTool[] | undefined {
  if (!candidate) {
    return undefined;
  }

  const meta = (candidate.groundingMetadata ?? candidate.grounding_metadata) as
    | GroundingMetadataRaw
    | undefined;
  if (!meta || typeof meta !== 'object') {
    return undefined;
  }

  const queries = readQueries(meta);
  const chunks = readChunks(meta);
  const searchResults: LlmSearchResult[] = [];

  for (const chunk of chunks) {
    const web = chunk.web;
    if (web?.uri || web?.title) {
      searchResults.push({
        title: web.title,
        url: web.uri,
      });
    }
  }

  if (queries.length === 0 && searchResults.length === 0) {
    return undefined;
  }

  return [
    {
      name: 'google_search',
      type: 'web_search',
      searchQueries: queries,
      searchResults,
    },
  ];
}
