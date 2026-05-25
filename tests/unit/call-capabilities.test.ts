import { describe, expect, it } from 'vitest';
import {
  CallLlmValidationError,
  resolveCallCapabilities,
  validateCallLlmOptions,
} from '../../server/llm/call-capabilities.js';

describe('validateCallLlmOptions', () => {
  it('rejects tools without capabilities.tools', () => {
    expect(() =>
      validateCallLlmOptions({
        prompt: 'hi',
        tools: [{ name: 'fn', description: 'd' }],
      }),
    ).toThrow(CallLlmValidationError);
  });

  it('rejects structuredOutput without capabilities', () => {
    expect(() =>
      validateCallLlmOptions({
        prompt: 'hi',
        structuredOutput: { responseJsonSchema: { type: 'object' } },
      }),
    ).toThrow(CallLlmValidationError);
  });

  it('rejects strictJson without structuredJson', () => {
    expect(() =>
      validateCallLlmOptions({
        prompt: 'hi',
        capabilities: { strictJson: true },
        structuredOutput: { responseJsonSchema: { type: 'object' } },
      }),
    ).toThrow(CallLlmValidationError);
  });

  it('accepts tools with capabilities.tools and tools array', () => {
    expect(() =>
      validateCallLlmOptions({
        prompt: 'hi',
        capabilities: { tools: true },
        tools: [{ name: 'fn', description: 'd' }],
      }),
    ).not.toThrow();
  });
});

describe('resolveCallCapabilities', () => {
  it('maps strictJson to requireStrictJson and activation', () => {
    const resolved = resolveCallCapabilities({
      prompt: 'hi',
      capabilities: { structuredJson: true, strictJson: true },
      structuredOutput: { responseJsonSchema: { type: 'object' } },
    });
    expect(resolved.candidateFilters.requireStrictJson).toBe(true);
    expect(resolved.candidateFilters.requireStructuredOutput).toBe(true);
    expect(resolved.activation.strictJson).toBe(true);
    expect(resolved.activation.structuredJson).toBe(true);
  });

  it('maps webSearch to requireWebSearch', () => {
    const resolved = resolveCallCapabilities({
      prompt: 'hi',
      capabilities: { webSearch: true },
    });
    expect(resolved.candidateFilters.requireWebSearch).toBe(true);
    expect(resolved.activation.webSearch).toBe(true);
  });
});
