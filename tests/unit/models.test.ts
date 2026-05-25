import { describe, expect, it } from 'vitest';
import {
  assertCapability,
  getDefaultModelId,
  getModelsBySpeedTier,
  LlmCapabilityError,
  resolveModelForSpeedTier,
  resolveTextModel,
  SPEED_TIER_MODEL_ORDER,
  supportsStructuredOutputCapability,
  TEXT_MODEL_REGISTRY,
} from '../../server/gemini/models.js';
import type { TextModelInfo } from '../../shared/gemini-types.js';

describe('resolveTextModel', () => {
  it('resolves base id to medium variant', () => {
    const resolved = resolveTextModel('gemini-2.5-flash-lite');
    expect(resolved.registryKey).toBe('gemini-2.5-flash-lite-medium');
    expect(resolved.apiModelId).toBe('gemini-2.5-flash-lite');
  });

  it('resolves base id to medium variant for gemini-3.5-flash', () => {
    const resolved = resolveTextModel('gemini-3.5-flash');
    expect(resolved.registryKey).toBe('gemini-3.5-flash-medium');
    expect(resolved.apiModelId).toBe('gemini-3.5-flash');
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
    expect(resolved.info.supportsStrictJson).toBe(true);
    expect(resolved.info.supportsThinking).toBe(true);
    expect(resolved.info.speedTier).toBe('moderate');
    expect(resolved.info.bakedThinkingPower).toBe('medium');
  });

  it('infers instant tier for lite passthrough models', () => {
    const resolved = resolveTextModel('gemini-2.5-custom-lite');
    expect(resolved.info.speedTier).toBe('instant');
    expect(resolved.info.thinkingMode).toBe('budget');
  });

  it('infers slow tier for pro passthrough models', () => {
    const resolved = resolveTextModel('gemini-2.5-custom-pro');
    expect(resolved.info.speedTier).toBe('slow');
  });
});

describe('strengthRank', () => {
  it('assigns rank 1 to first model in each speed tier order', () => {
    for (const tier of ['instant', 'fast', 'moderate', 'slow'] as const) {
      const firstId = SPEED_TIER_MODEL_ORDER[tier][0];
      if (firstId) {
        expect(TEXT_MODEL_REGISTRY[firstId].strengthRank).toBe(1);
      }
    }
  });
});

describe('resolveModelForSpeedTier', () => {
  it('picks strongest free-tier model for instant tier', () => {
    const resolved = resolveModelForSpeedTier('instant');
    expect(resolved.registryKey).toBe(SPEED_TIER_MODEL_ORDER.instant[0]);
    expect(resolved.info.freeTierAvailable).toBe(true);
  });

  it('picks strongest free-tier model for moderate tier', () => {
    const resolved = resolveModelForSpeedTier('moderate');
    expect(resolved.registryKey).toBe(SPEED_TIER_MODEL_ORDER.moderate[0]);
  });

  it('picks first slow-tier model when preferFreeTier is false', () => {
    const resolved = resolveModelForSpeedTier('slow', false);
    expect(resolved.registryKey).toBe(SPEED_TIER_MODEL_ORDER.slow[0]);
  });
});

describe('getModelsBySpeedTier', () => {
  it('returns instant-tier free models in strength order', () => {
    const ids = getModelsBySpeedTier('instant').map((model) => model.id);
    const expected = SPEED_TIER_MODEL_ORDER.instant.filter(
      (id) => TEXT_MODEL_REGISTRY[id].freeTierAvailable,
    );
    expect(ids).toEqual(expected);
  });

  it('returns moderate-tier free models in strength order', () => {
    const ids = getModelsBySpeedTier('moderate').map((model) => model.id);
    const expected = SPEED_TIER_MODEL_ORDER.moderate.filter(
      (id) => TEXT_MODEL_REGISTRY[id].freeTierAvailable,
    );
    expect(ids).toEqual(expected);
  });

  it('returns slow-tier models in strength order', () => {
    const ids = getModelsBySpeedTier('slow', { preferFreeTier: false }).map((model) => model.id);
    expect(ids).toEqual(SPEED_TIER_MODEL_ORDER.slow);
  });

  it('filters to structured-output capable models only', () => {
    const ids = getModelsBySpeedTier('instant', { requireStructuredOutput: true }).map(
      (m) => m.id,
    );
    expect(ids.every((id) => supportsStructuredOutputCapability(TEXT_MODEL_REGISTRY[id]))).toBe(
      true,
    );
    expect(ids).toContain('gemini-3.1-flash-lite-minimal');
  });

  it('filters to strict-json capable models only', () => {
    const ids = getModelsBySpeedTier('instant', { requireStrictJson: true }).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => TEXT_MODEL_REGISTRY[id].supportsStrictJson)).toBe(true);
    expect(ids).toContain('openai--gpt-oss-20b-off');
    expect(ids).toContain('gemini-3.1-flash-lite-minimal');
  });

  it('returns moderate models when function calling required', () => {
    const ids = getModelsBySpeedTier('moderate', { requireFunctionCalling: true }).map(
      (m) => m.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => TEXT_MODEL_REGISTRY[id].supportsFunctionCalling)).toBe(true);
  });
});

describe('assertCapability', () => {
  it('throws LlmCapabilityError for structuredOutput on gemini-2.5-flash-lite', () => {
    const info = TEXT_MODEL_REGISTRY['gemini-2.5-flash-lite-medium'];
    expect(() => assertCapability(info, 'structuredOutput')).toThrow(LlmCapabilityError);

    try {
      assertCapability(info, 'structuredOutput');
    } catch (error) {
      expect(error).toBeInstanceOf(LlmCapabilityError);
      const capabilityError = error as LlmCapabilityError;
      expect(capabilityError.model).toBe('gemini-2.5-flash-lite-medium');
      expect(capabilityError.capability).toBe('structuredOutput');
      expect(capabilityError.message).toContain('does not support structuredOutput');
    }
  });

  it('throws LlmCapabilityError for functionCalling when unsupported', () => {
    const info: TextModelInfo = {
      ...TEXT_MODEL_REGISTRY['gemini-2.5-flash-lite-medium'],
      supportsFunctionCalling: false,
    };

    expect(() => assertCapability(info, 'functionCalling')).toThrow(LlmCapabilityError);
  });

  it('throws LlmCapabilityError for thinking when unsupported', () => {
    const info: TextModelInfo = {
      ...TEXT_MODEL_REGISTRY['gemini-2.5-flash-lite-off'],
      supportsThinking: false,
    };
    expect(() => assertCapability(info, 'thinking')).toThrow(LlmCapabilityError);
  });

  it('does not throw when capability is supported', () => {
    const info = TEXT_MODEL_REGISTRY['gemini-3.1-flash-lite-minimal'];
    expect(() => assertCapability(info, 'structuredOutput')).not.toThrow();
    expect(() => assertCapability(info, 'functionCalling')).not.toThrow();
    expect(() => assertCapability(info, 'thinking')).not.toThrow();
  });
});

describe('getDefaultModelId', () => {
  it('returns env override or gemini-3.1-flash-lite-minimal', () => {
    const previous = process.env.GEMINI_DEFAULT_MODEL;
    delete process.env.GEMINI_DEFAULT_MODEL;
    expect(getDefaultModelId()).toBe('gemini-3.1-flash-lite-minimal');

    process.env.GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-lite-off';
    expect(getDefaultModelId()).toBe('gemini-2.5-flash-lite-off');

    if (previous === undefined) {
      delete process.env.GEMINI_DEFAULT_MODEL;
    } else {
      process.env.GEMINI_DEFAULT_MODEL = previous;
    }
  });
});
