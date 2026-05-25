import { beforeEach, describe, expect, it } from 'vitest';
import {
  compareRegistryStrength,
  getBaseSpeedTierOverride,
  resetGroqCatalogRankCache,
  resolveBaseSlug,
} from '../../server/gemini/model-ranking.js';
import {
  resolveProbeSpeedTier,
} from '../../server/gemini/speed-tier-classify.js';
import { SPEED_TIER_MODEL_ORDER } from '../../server/gemini/models.js';

describe('model-ranking tier overrides', () => {
  it('maps base slugs to product tiers', () => {
    expect(getBaseSpeedTierOverride('openai--gpt-oss-120b')).toBe('moderate');
    expect(getBaseSpeedTierOverride('groq--compound')).toBe('fast');
    expect(getBaseSpeedTierOverride('groq--compound-mini')).toBe('instant');
  });

  it('resolveProbeSpeedTier applies overrides before thinking heuristics', () => {
    expect(resolveProbeSpeedTier(undefined, 'off', 'openai--gpt-oss-120b-off')).toBe('moderate');
    expect(resolveProbeSpeedTier(undefined, 'off', 'groq--compound-off')).toBe('fast');
    expect(resolveProbeSpeedTier(undefined, 'off', 'groq--compound-mini-off')).toBe('instant');
    expect(resolveProbeSpeedTier(undefined, 'medium', 'gemini-3.5-flash-medium')).toBe('moderate');
  });
});

describe('compareRegistryStrength / SPEED_TIER_MODEL_ORDER', () => {
  beforeEach(() => {
    resetGroqCatalogRankCache();
  });

  it('instant tier: gemini 3.5, then 3.1 lite, then openai, then compound-mini', () => {
    const instant = SPEED_TIER_MODEL_ORDER.instant;
    expect(instant[0]).toBe('gemini-3.5-flash-minimal');
    expect(instant[1]).toBe('gemini-3.1-flash-lite-minimal');
    expect(instant[2]).toBe('openai--gpt-oss-20b-off');
    expect(instant[3]).toBe('groq--compound-mini-off');
  });

  it('fast tier: gemini 3.5 low, 3.1 lite low, compound', () => {
    const fast = SPEED_TIER_MODEL_ORDER.fast;
    expect(fast[0]).toBe('gemini-3.5-flash-low');
    expect(fast[1]).toBe('gemini-3.1-flash-lite-low');
    expect(fast[2]).toBe('groq--compound-off');
  });

  it('moderate tier: 3.5 medium, 120b, 3.1 lite medium', () => {
    const moderate = SPEED_TIER_MODEL_ORDER.moderate;
    expect(moderate[0]).toBe('gemini-3.5-flash-medium');
    expect(moderate[1]).toBe('openai--gpt-oss-120b-off');
    expect(moderate[2]).toBe('gemini-3.1-flash-lite-medium');
  });

  it('places 120b above lite in moderate comparisons', () => {
    expect(
      compareRegistryStrength('openai--gpt-oss-120b-off', 'gemini-3.1-flash-lite-medium'),
    ).toBeLessThan(0);
    expect(
      compareRegistryStrength('gemini-3.5-flash-medium', 'openai--gpt-oss-120b-off'),
    ).toBeLessThan(0);
  });

  it('resolveBaseSlug strips thinking suffix', () => {
    expect(resolveBaseSlug('gemini-3.5-flash-minimal')).toBe('gemini-3.5-flash');
    expect(resolveBaseSlug('groq--compound-off')).toBe('groq--compound');
  });
});
