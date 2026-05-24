import { describe, expect, it } from 'vitest';
import {
  assertCapability,
  getDefaultModelId,
  getModelsByTier,
  LlmCapabilityError,
  resolveModelForTier,
  resolveTextModel,
  TEXT_MODEL_REGISTRY,
} from '../../server/gemini/models.js';
import type { TextModelInfo } from '../../shared/gemini-types.js';

describe('resolveTextModel', () => {
  it('resolves registry id', () => {
    const resolved = resolveTextModel('gemini-2.5-flash-lite');
    expect(resolved.registryKey).toBe('gemini-2.5-flash-lite');
    expect(resolved.apiModelId).toBe('gemini-2.5-flash-lite');
    expect(resolved.info.displayName).toBe('Gemini 2.5 Flash Lite');
  });

  it('resolves alias to canonical registry key', () => {
    const resolved = resolveTextModel('gemini-2.0-flash-lite-001');
    expect(resolved.registryKey).toBe('gemini-2.0-flash-lite');
    expect(resolved.apiModelId).toBe('gemini-2.0-flash-lite');
  });

  it('resolves apiModelId when different from registry id', () => {
    const resolved = resolveTextModel('gemini-3-flash');
    expect(resolved.registryKey).toBe('gemini-3-flash');
    expect(resolved.apiModelId).toBe('gemini-3-flash-preview');
  });

  it('throws when model id is empty', () => {
    expect(() => resolveTextModel('')).toThrow('Model id is required.');
    expect(() => resolveTextModel('   ')).toThrow('Model id is required.');
  });

  it('passthrough unknown model id with inferred capabilities', () => {
    const resolved = resolveTextModel('gemini-3-unknown-test');
    expect(resolved.registryKey).toBe('gemini-3-unknown-test');
    expect(resolved.info.thinkingMode).toBe('levels');
    expect(resolved.info.supportsStructuredOutput).toBe(true);
    expect(resolved.info.supportsThinking).toBe(true);
    expect(resolved.info.thinkingPowerTier).toBe('medium');
  });

  it('infers low tier for lite passthrough models', () => {
    const resolved = resolveTextModel('gemini-2.5-custom-lite');
    expect(resolved.info.thinkingPowerTier).toBe('low');
    expect(resolved.info.thinkingMode).toBe('budget');
  });

  it('infers high tier for pro passthrough models', () => {
    const resolved = resolveTextModel('gemini-2.5-custom-pro');
    expect(resolved.info.thinkingPowerTier).toBe('high');
  });
});

describe('strengthRank', () => {
  it('assigns rank 1 to strongest model in each tier', () => {
    expect(TEXT_MODEL_REGISTRY['gemini-3.1-flash-lite'].strengthRank).toBe(1);
    expect(TEXT_MODEL_REGISTRY['gemini-3.5-flash'].strengthRank).toBe(1);
    expect(TEXT_MODEL_REGISTRY['gemini-3.1-pro'].strengthRank).toBe(1);
  });
});

describe('resolveModelForTier', () => {
  it('picks strongest free-tier model for low tier', () => {
    const resolved = resolveModelForTier('low');
    expect(resolved.registryKey).toBe('gemini-3.1-flash-lite');
    expect(resolved.info.freeTierAvailable).toBe(true);
  });

  it('picks strongest free-tier model for medium tier', () => {
    const resolved = resolveModelForTier('medium');
    expect(resolved.registryKey).toBe('gemini-3.5-flash');
  });

  it('falls back to paid model when preferFreeTier is false', () => {
    const resolved = resolveModelForTier('high', false);
    expect(resolved.registryKey).toBe('gemini-3.1-pro');
    expect(resolved.info.freeTierAvailable).toBe(false);
  });

  it('uses first high-tier model when no free tier is available', () => {
    const resolved = resolveModelForTier('high');
    expect(resolved.info.freeTierAvailable).toBe(false);
    expect(resolved.registryKey).toBe('gemini-3.1-pro');
  });
});

describe('getModelsByTier', () => {
  it('returns low-tier models in strength order', () => {
    const ids = getModelsByTier('low').map((model) => model.id);
    expect(ids).toEqual([
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite',
    ]);
  });

  it('returns medium-tier models in strength order', () => {
    const ids = getModelsByTier('medium').map((model) => model.id);
    expect(ids).toEqual([
      'gemini-3.5-flash',
      'gemini-3-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
    ]);
  });

  it('returns high-tier models in strength order', () => {
    const ids = getModelsByTier('high', { preferFreeTier: false }).map((model) => model.id);
    expect(ids).toEqual(['gemini-3.1-pro', 'gemini-2.5-pro']);
  });

  it('filters to structured-output capable models only', () => {
    const ids = getModelsByTier('low', { requireStructuredOutput: true }).map((m) => m.id);
    expect(ids).toEqual(['gemini-3.1-flash-lite']);
  });

  it('returns all medium models when function calling required', () => {
    const ids = getModelsByTier('medium', { requireFunctionCalling: true }).map((m) => m.id);
    expect(ids).toHaveLength(4);
  });
});

describe('assertCapability', () => {
  it('throws LlmCapabilityError for structuredOutput on gemini-2.0-flash', () => {
    const info = TEXT_MODEL_REGISTRY['gemini-2.0-flash'];
    expect(() => assertCapability(info, 'structuredOutput')).toThrow(LlmCapabilityError);

    try {
      assertCapability(info, 'structuredOutput');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmCapabilityError);
      const capabilityError = error as LlmCapabilityError;
      expect(capabilityError.model).toBe('gemini-2.0-flash');
      expect(capabilityError.capability).toBe('structuredOutput');
      expect(capabilityError.message).toContain('does not support structuredOutput');
    }
  });

  it('throws LlmCapabilityError for functionCalling when unsupported', () => {
    const info: TextModelInfo = {
      ...TEXT_MODEL_REGISTRY['gemini-2.0-flash-lite'],
      supportsFunctionCalling: false,
    };

    expect(() => assertCapability(info, 'functionCalling')).toThrow(LlmCapabilityError);

    try {
      assertCapability(info, 'functionCalling');
    } catch (error) {
      const capabilityError = error as LlmCapabilityError;
      expect(capabilityError.capability).toBe('functionCalling');
    }
  });

  it('throws LlmCapabilityError for thinking when unsupported', () => {
    const info = TEXT_MODEL_REGISTRY['gemini-2.0-flash-lite'];
    expect(() => assertCapability(info, 'thinking')).toThrow(LlmCapabilityError);
  });

  it('does not throw when capability is supported', () => {
    const info = TEXT_MODEL_REGISTRY['gemini-3.1-flash-lite'];
    expect(() => assertCapability(info, 'structuredOutput')).not.toThrow();
    expect(() => assertCapability(info, 'functionCalling')).not.toThrow();
    expect(() => assertCapability(info, 'thinking')).not.toThrow();
  });
});

describe('getDefaultModelId', () => {
  it('returns env override or gemini-3.1-flash-lite', () => {
    const previous = process.env.GEMINI_DEFAULT_MODEL;
    delete process.env.GEMINI_DEFAULT_MODEL;
    expect(getDefaultModelId()).toBe('gemini-3.1-flash-lite');

    process.env.GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash-lite';
    expect(getDefaultModelId()).toBe('gemini-2.0-flash-lite');

    if (previous === undefined) {
      delete process.env.GEMINI_DEFAULT_MODEL;
    } else {
      process.env.GEMINI_DEFAULT_MODEL = previous;
    }
  });
});
