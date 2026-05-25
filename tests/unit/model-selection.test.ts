import { beforeEach, describe, expect, it } from 'vitest';
import { markExhausted, resetExhaustionState } from '../../server/gemini/availability.js';
import {
  getSpeedTierDowngradeChain,
  isSpeedTierDowngraded,
  iterateModelCandidates,
  iterateSpeedTierBatches,
} from '../../server/gemini/model-selection.js';
import { SPEED_TIER_MODEL_ORDER, TEXT_MODEL_REGISTRY } from '../../server/gemini/models.js';

describe('getSpeedTierDowngradeChain', () => {
  it('returns all tiers from instant', () => {
    expect(getSpeedTierDowngradeChain('instant')).toEqual([
      'instant',
      'fast',
      'moderate',
      'slow',
    ]);
  });

  it('returns moderate and slow from moderate', () => {
    expect(getSpeedTierDowngradeChain('moderate')).toEqual(['moderate', 'slow']);
  });

  it('returns slow only from slow', () => {
    expect(getSpeedTierDowngradeChain('slow')).toEqual(['slow']);
  });
});

describe('isSpeedTierDowngraded', () => {
  it('detects downgrade from moderate to slow', () => {
    expect(isSpeedTierDowngraded('moderate', 'slow')).toBe(true);
  });

  it('returns false when tier unchanged', () => {
    expect(isSpeedTierDowngraded('instant', 'instant')).toBe(false);
  });
});

describe('iterateModelCandidates', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('yields strongest first within instant tier', () => {
    const ids = [...iterateModelCandidates({ speedTier: 'instant' })].map(
      (c) => c.registryKey,
    );
    expect(ids.slice(0, 3)).toEqual(SPEED_TIER_MODEL_ORDER.instant.slice(0, 3));
  });

  it('yields explicit model only once', () => {
    const candidates = [...iterateModelCandidates({ model: 'gemini-3.5-flash' })];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].registryKey).toBe('gemini-3.5-flash-medium');
  });

  it('skips exhausted models', () => {
    const firstInstant = SPEED_TIER_MODEL_ORDER.instant[0];
    markExhausted(firstInstant);
    const ids = [...iterateModelCandidates({ speedTier: 'instant' })].map(
      (c) => c.registryKey,
    );
    expect(ids[0]).toBe(SPEED_TIER_MODEL_ORDER.instant[1]);
    expect(ids).not.toContain(firstInstant);
  });

  it('filters to structured-output models when schema required', () => {
    const ids = [
      ...iterateModelCandidates(
        {
          speedTier: 'instant',
          structuredOutput: { responseJsonSchema: { type: 'object' } },
        },
        { requireStructuredOutput: true },
      ),
    ].map((c) => c.registryKey);

    expect(ids).toContain('gemini-3.1-flash-lite-low');
    expect(
      ids.every(
        (id) =>
          TEXT_MODEL_REGISTRY[id].supportsStructuredOutput ||
          TEXT_MODEL_REGISTRY[id].supportsStrictJson,
      ),
    ).toBe(true);
  });

  it('includes slower tiers after slow tier candidates when starting at slow', () => {
    for (const id of SPEED_TIER_MODEL_ORDER.slow) {
      markExhausted(id);
    }

    const ids = [...iterateModelCandidates({ speedTier: 'slow' })].map((c) => c.registryKey);
    expect(ids).toHaveLength(0);
  });

  it('skips models without function calling when tools required', () => {
    const candidates = [
      ...iterateModelCandidates(
        { speedTier: 'instant', tools: [{ name: 'fn', description: 'd' }] },
        { requireFunctionCalling: true },
      ),
    ];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.info.supportsFunctionCalling)).toBe(true);
  });
});

describe('iterateSpeedTierBatches', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('yields moderate then slow batches only when starting at moderate', () => {
    const batches = [...iterateSpeedTierBatches({ speedTier: 'moderate' })];
    expect(batches.map((batch) => batch.tier)).toEqual(['moderate', 'slow']);
    expect(batches[0].candidates.every((c) => c.info.speedTier === 'moderate')).toBe(true);
    expect(batches[1].candidates.every((c) => c.info.speedTier === 'slow')).toBe(true);
  });

  it('yields nothing for explicit model', () => {
    expect([...iterateSpeedTierBatches({ model: 'gemini-3.5-flash' })]).toHaveLength(0);
  });
});
