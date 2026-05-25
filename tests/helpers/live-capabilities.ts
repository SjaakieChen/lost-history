import type { LlmFunctionDeclaration, LlmStructuredOutput } from '../../shared/gemini-types.js';

/** Pinned models for capability live smoke tests (registry ids). */
export const LIVE_GEMINI_WEB_SEARCH_MODEL = 'gemini-3.5-flash-medium';
export const LIVE_GEMINI_TOOLS_MODEL = 'gemini-3.5-flash-medium';
export const LIVE_GEMINI_STRUCTURED_MODEL = 'gemini-3.1-flash-lite-low';
export const LIVE_GROQ_WEB_SEARCH_MODEL = 'groq--compound-mini-off';
export const LIVE_GROQ_CODE_EXECUTION_MODEL = 'groq--compound-off';
export const LIVE_GROQ_CODE_EXECUTION_OSS_MODEL = 'openai--gpt-oss-20b-off';
export const LIVE_GROQ_TOOLS_MODEL = 'llama-3.1-8b-instant-off';
export const LIVE_GROQ_STRICT_JSON_MODEL = 'openai--gpt-oss-20b-off';
/** GPT-OSS supports json_schema (best-effort or strict); Llama 70B does not. */
export const LIVE_GROQ_STRUCTURED_JSON_MODEL = 'openai--gpt-oss-120b-off';

export const LIVE_PICK_NUMBER_TOOL: LlmFunctionDeclaration = {
  name: 'pick_number',
  description: 'Returns a random integer from 1 to 100 inclusive.',
  parameters: { type: 'object', properties: {} },
};

export const LIVE_COUNTRY_SCHEMA: LlmStructuredOutput = {
  responseJsonSchema: {
    type: 'object',
    properties: {
      capital: { type: 'string' },
      country: { type: 'string' },
    },
    required: ['capital', 'country'],
    additionalProperties: false,
  },
};

/** Parse model text that may be wrapped in markdown fences. */
export function parseJsonFromModelText(text: string): unknown {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(trimmed);
  const payload = fence ? fence[1].trim() : trimmed;
  return JSON.parse(payload) as unknown;
}
