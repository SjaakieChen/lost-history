import { describe, expect, it } from 'vitest';
import {
  MULTITURN_CALIBRATION_TOOLS,
  normalizeToolDeclarations,
  normalizeToolParameters,
} from '../../server/llm/tool-schema.js';

describe('normalizeToolParameters', () => {
  it('produces Groq-valid object schema with typed properties', () => {
    const schema = normalizeToolParameters({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });

    expect(schema).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    });
  });

  it('normalizes array item types', () => {
    const schema = normalizeToolParameters({
      type: 'object',
      properties: {
        pieces: { type: 'array', items: { type: 'string' } },
      },
      required: ['pieces'],
    });

    expect(schema.properties).toEqual({
      pieces: { type: 'array', items: { type: 'string' } },
    });
    expect(schema.required).toEqual(['pieces']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('defaults missing parameters to empty object schema', () => {
    expect(normalizeToolParameters(undefined)).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });
});

describe('normalizeToolDeclarations', () => {
  it('normalizes each tool parameters block', () => {
    const tools = normalizeToolDeclarations([
      {
        name: 'fetch_piece',
        description: 'Fetches a piece',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    ]);

    expect(tools[0].parameters?.additionalProperties).toBe(false);
    expect(tools[0].parameters?.required).toEqual(['id']);
  });

  it('multiturn calibration tools are Groq-valid', () => {
    const tools = normalizeToolDeclarations(MULTITURN_CALIBRATION_TOOLS);
    for (const tool of tools) {
      expect(tool.parameters?.type).toBe('object');
      expect(tool.parameters?.additionalProperties).toBe(false);
      expect(Array.isArray(tool.parameters?.required)).toBe(true);
      const properties = tool.parameters?.properties as Record<string, Record<string, unknown>>;
      for (const prop of Object.values(properties)) {
        expect(typeof prop.type).toBe('string');
        expect(prop.type).not.toBe('Type');
      }
    }
  });
});
