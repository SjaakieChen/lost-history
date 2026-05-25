import { describe, expect, it } from 'vitest';
import { buildGroqResponseFormat } from '../../server/groq/generate.js';

describe('buildGroqResponseFormat', () => {
  const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  };

  it('uses strict json_schema when model supports strict JSON and schema is provided', () => {
    const format = buildGroqResponseFormat(
      { structuredOutput: { responseJsonSchema: schema } },
      { supportsStructuredOutput: true, supportsStrictJson: true },
    );
    expect(format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        strict: true,
        schema,
      },
    });
  });

  it('uses best-effort json_schema when only structured output is supported', () => {
    const format = buildGroqResponseFormat(
      { structuredOutput: { responseJsonSchema: schema } },
      { supportsStructuredOutput: true, supportsStrictJson: false },
    );
    expect(format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'structured_output',
        strict: false,
        schema,
      },
    });
  });

  it('falls back to json_object when structured output is requested without a schema', () => {
    const format = buildGroqResponseFormat(
      { structuredOutput: {} },
      { supportsStructuredOutput: true, supportsStrictJson: false },
    );
    expect(format).toEqual({ type: 'json_object' });
  });

  it('returns undefined when structured output is not requested', () => {
    expect(
      buildGroqResponseFormat({}, { supportsStructuredOutput: true, supportsStrictJson: true }),
    ).toBeUndefined();
  });
});
