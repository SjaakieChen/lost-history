import { describe, expect, it } from 'vitest';
import { buildGroqResponseFormat } from '../../server/groq/generate.js';

describe('buildGroqResponseFormat', () => {
  const schema = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
  };

  const ossInfo = { supportsStructuredOutput: true, supportsStrictJson: true };
  const llamaInfo = { supportsStructuredOutput: true, supportsStrictJson: false };

  it('uses strict json_schema only when activation.strictJson is true', () => {
    const format = buildGroqResponseFormat(
      { structuredOutput: { responseJsonSchema: schema } },
      ossInfo,
      { structuredJson: true, strictJson: true },
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

  it('does not use strict when model supports strict but activation.strictJson is false', () => {
    const format = buildGroqResponseFormat(
      { structuredOutput: { responseJsonSchema: schema } },
      ossInfo,
      { structuredJson: true, strictJson: false },
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

  it('uses best-effort json_schema when only structured output is supported', () => {
    const format = buildGroqResponseFormat(
      { structuredOutput: { responseJsonSchema: schema } },
      llamaInfo,
      { structuredJson: true, strictJson: false },
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

  it('returns undefined when structuredJson activation is off', () => {
    expect(
      buildGroqResponseFormat(
        { structuredOutput: { responseJsonSchema: schema } },
        ossInfo,
        { structuredJson: false, strictJson: false },
      ),
    ).toBeUndefined();
  });

  it('falls back to json_object when structured output is requested without a schema', () => {
    const format = buildGroqResponseFormat(
      { structuredOutput: {} },
      llamaInfo,
      { structuredJson: true, strictJson: false },
    );
    expect(format).toEqual({ type: 'json_object' });
  });
});
