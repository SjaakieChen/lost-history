import type { LlmFunctionDeclaration } from '../../shared/gemini-types.js';

/** Single source of truth for function/tool JSON Schema passed to Gemini and Groq. */

const JSON_SCHEMA_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'null',
]);

function normalizeSchemaType(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return JSON_SCHEMA_TYPES.has(lower) ? lower : undefined;
  }
  return undefined;
}

function normalizePropertySchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...schema };
  const type = normalizeSchemaType(schema.type);
  if (type) {
    normalized.type = type;
  }

  if (type === 'array' && schema.items !== undefined) {
    const items = schema.items;
    if (typeof items === 'object' && items !== null && !Array.isArray(items)) {
      normalized.items = normalizePropertySchema(items as Record<string, unknown>);
    }
  }

  if (type === 'object' && schema.properties !== undefined) {
    const properties = schema.properties;
    if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
      const normalizedProperties: Record<string, unknown> = {};
      for (const [key, propSchema] of Object.entries(properties)) {
        if (typeof propSchema === 'object' && propSchema !== null && !Array.isArray(propSchema)) {
          normalizedProperties[key] = normalizePropertySchema(propSchema as Record<string, unknown>);
        } else {
          normalizedProperties[key] = propSchema;
        }
      }
      normalized.properties = normalizedProperties;
      if (!Array.isArray(schema.required)) {
        normalized.required = Object.keys(normalizedProperties);
      }
    }
    normalized.additionalProperties = schema.additionalProperties ?? false;
  }

  return normalized;
}

/** Normalizes OpenAPI-style parameters to Groq/OpenAI-compatible JSON Schema. */
export function normalizeToolParameters(
  parameters?: Record<string, unknown>,
): Record<string, unknown> {
  if (!parameters || typeof parameters !== 'object') {
    return {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    };
  }

  const base =
    typeof parameters === 'object' && !Array.isArray(parameters)
      ? normalizePropertySchema({ ...parameters, type: parameters.type ?? 'object' })
      : { type: 'object', properties: {} };

  if (base.type !== 'object') {
    return { type: 'object', properties: {}, additionalProperties: false };
  }

  const properties =
    typeof base.properties === 'object' &&
    base.properties !== null &&
    !Array.isArray(base.properties)
      ? (base.properties as Record<string, unknown>)
      : {};

  const required = Array.isArray(base.required)
    ? (base.required as unknown[]).filter((key): key is string => typeof key === 'string')
    : Object.keys(properties);

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: base.additionalProperties ?? false,
  };
}

/** Normalizes tool declarations for both Gemini functionDeclarations and Groq chat tools. */
export function normalizeToolDeclarations(
  tools: LlmFunctionDeclaration[],
): LlmFunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: normalizeToolParameters(tool.parameters),
  }));
}

export const FINAL_ANSWER_TOOL_NAME = 'submit_final_answer';

export function buildFinalAnswerToolDeclaration(
  name: string = FINAL_ANSWER_TOOL_NAME,
  description?: string,
): LlmFunctionDeclaration {
  return {
    name,
    description:
      description ??
      'Submit your final answer only after all prior tool calls have returned success and you verified the outcome. Preferred over plain text.',
    parameters: normalizeToolParameters({
      type: 'object',
      properties: {
        answer: {
          type: 'string',
          description: 'The final answer to return to the user.',
        },
        reasoning: {
          type: 'string',
          description: 'Optional brief reasoning summary.',
        },
      },
      required: ['answer'],
    }),
  };
}

export const MULTITURN_FETCH_PIECE_TOOL: LlmFunctionDeclaration = {
  name: 'fetch_piece',
  description: 'Fetches a puzzle piece by id.',
  parameters: normalizeToolParameters({
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Piece identifier.' },
    },
    required: ['id'],
  }),
};

export const MULTITURN_COMBINE_PIECES_TOOL: LlmFunctionDeclaration = {
  name: 'combine_pieces',
  description: 'Combines two pieces into one string.',
  parameters: normalizeToolParameters({
    type: 'object',
    properties: {
      pieces: {
        type: 'array',
        items: { type: 'string' },
        description: 'Piece ids to combine.',
      },
    },
    required: ['pieces'],
  }),
};

export const MULTITURN_CALIBRATION_TOOLS: LlmFunctionDeclaration[] = [
  MULTITURN_FETCH_PIECE_TOOL,
  MULTITURN_COMBINE_PIECES_TOOL,
];
