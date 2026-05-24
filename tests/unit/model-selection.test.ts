import { beforeEach, describe, expect, it } from 'vitest';
import { markExhausted, resetExhaustionState } from '../../server/gemini/availability.js';
import {
  getTierDowngradeChain,
  isTierDowngraded,
  iterateModelCandidates,
} from '../../server/gemini/model-selection.js';

describe('getTierDowngradeChain', () => {
  it('returns high, medium, low from high', () => {
    expect(getTierDowngradeChain('high')).toEqual(['high', 'medium', 'low']);
  });

  it('returns medium, low from medium', () => {
    expect(getTierDowngradeChain('medium')).toEqual(['medium', 'low']);
  });

  it('returns low only from low', () => {
    expect(getTierDowngradeChain('low')).toEqual(['low']);
  });
});

describe('isTierDowngraded', () => {
  it('detects downgrade from medium to low', () => {
    expect(isTierDowngraded('medium', 'low')).toBe(true);
  });

  it('returns false when tier unchanged', () => {
    expect(isTierDowngraded('low', 'low')).toBe(false);
  });
});

describe('iterateModelCandidates', () => {
  beforeEach(() => {
    resetExhaustionState();
  });

  it('yields strongest first within low tier', () => {
    const ids = [...iterateModelCandidates({ thinkingPowerTier: 'low' })].map(
      (c) => c.registryKey,
    );
    expect(ids.slice(0, 3)).toEqual([
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite',
    ]);
  });

  it('yields explicit model only once', () => {
    const candidates = [...iterateModelCandidates({ model: 'gemini-2.0-flash' })];
    expect(candidates).toHaveLength(1);
    expect(candidates[0].registryKey).toBe('gemini-2.0-flash');
  });

  it('skips exhausted models', () => {
    markExhausted('gemini-3.1-flash-lite');
    const ids = [...iterateModelCandidates({ thinkingPowerTier: 'low' })].map(
      (c) => c.registryKey,
    );
    expect(ids[0]).toBe('gemini-2.5-flash-lite');
    expect(ids).not.toContain('gemini-3.1-flash-lite');
  });

  it('filters to structured-output models when schema required', () => {
    const ids = [
      ...iterateModelCandidates(
        {
          thinkingPowerTier: 'low',
          structuredOutput: { responseJsonSchema: { type: 'object' } },
        },
        { requireStructuredOutput: true },
      ),
    ].map((c) => c.registryKey);

    expect(ids).toEqual(['gemini-3.1-flash-lite']);
  });

  it('includes medium models after high tier when starting at high', () => {
    markExhausted('gemini-3.1-pro');
    markExhausted('gemini-2.5-pro');

    const ids = [...iterateModelCandidates({ thinkingPowerTier: 'high' })].map(
      (c) => c.registryKey,
    );

    expect(ids[0]).toBe('gemini-3.5-flash');
    expect(ids).toContain('gemini-3.1-flash-lite');
  });

  it('skips models without function calling when tools required', () => {
    const candidates = [
      ...iterateModelCandidates(
        { thinkingPowerTier: 'low', tools: [{ name: 'fn', description: 'd' }] },
        { requireFunctionCalling: true },
      ),
    ];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.info.supportsFunctionCalling)).toBe(true);
  });
});
