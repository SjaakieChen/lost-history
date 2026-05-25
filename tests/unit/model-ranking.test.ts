import { beforeEach, describe, expect, it } from 'vitest';
import {
  compareRegistryStrength,
  getBaseSpeedTierOverride,
  getProbeSpeedTierOverride,
  resetGroqCatalogRankCache,
  resolveBaseSlug,
} from '../../server/gemini/model-ranking.js';
import { resolveProbeSpeedTier } from '../../server/gemini/speed-tier-classify.js';
import { SPEED_TIER_MODEL_ORDER, TEXT_MODEL_REGISTRY } from '../../server/gemini/models.js';

describe('model-ranking tier overrides', () => {
  it('maps base slugs to product tiers', () => {
    expect(getBaseSpeedTierOverride('openai--gpt-oss-120b')).toBe('moderate');
    expect(getBaseSpeedTierOverride('groq--compound')).toBe('fast');
    expect(getBaseSpeedTierOverride('groq--compound-mini')).toBe('instant');
  });

  it('maps gemini-3.1-flash-lite probes to custom tiers', () => {
    expect(getProbeSpeedTierOverride('gemini-3.1-flash-lite-low')).toBe('instant');
    expect(getProbeSpeedTierOverride('gemini-3.1-flash-lite-medium')).toBe('fast');
    expect(getProbeSpeedTierOverride('gemini-3.1-flash-lite-high')).toBe('moderate');
  });

  it('resolveProbeSpeedTier applies lite probe overrides', () => {
    expect(resolveProbeSpeedTier(undefined, 'low', 'gemini-3.1-flash-lite-low')).toBe('instant');
    expect(resolveProbeSpeedTier(undefined, 'medium', 'gemini-3.1-flash-lite-medium')).toBe(
      'fast',
    );
    expect(resolveProbeSpeedTier(undefined, 'high', 'gemini-3.1-flash-lite-high')).toBe(
      'moderate',
    );
    expect(resolveProbeSpeedTier(undefined, 'off', 'openai--gpt-oss-120b-off')).toBe('moderate');
    expect(resolveProbeSpeedTier(undefined, 'medium', 'gemini-3.5-flash-medium')).toBe(
      'moderate',
    );
  });
});

describe('compareRegistryStrength / SPEED_TIER_MODEL_ORDER', () => {
  beforeEach(() => {
    resetGroqCatalogRankCache();
  });

  it('does not register gemini-3.1-flash-lite-minimal', () => {
    expect(TEXT_MODEL_REGISTRY['gemini-3.1-flash-lite-minimal']).toBeUndefined();
    expect(TEXT_MODEL_REGISTRY['gemini-3.1-flash-lite-low']).toBeDefined();
  });

  it('instant tier: lite-low first, then 3.5 minimal, openai, compound-mini, scout last', () => {
    const instant = SPEED_TIER_MODEL_ORDER.instant;
    expect(instant[0]).toBe('gemini-3.1-flash-lite-low');
    expect(instant[1]).toBe('gemini-3.5-flash-minimal');
    expect(instant[2]).toBe('openai--gpt-oss-20b-off');
    expect(instant[3]).toBe('groq--compound-mini-off');
    const scoutIndex = instant.indexOf('meta-llama--llama-4-scout-17b-16e-instruct-off');
    const compoundMiniIndex = instant.indexOf('groq--compound-mini-off');
    expect(scoutIndex).toBeGreaterThan(-1);
    expect(scoutIndex).toBeGreaterThan(compoundMiniIndex);
  });

  it('fast tier: 3.5 low, lite medium, compound, qwen last', () => {
    const fast = SPEED_TIER_MODEL_ORDER.fast;
    expect(fast[0]).toBe('gemini-3.5-flash-low');
    expect(fast[1]).toBe('gemini-3.1-flash-lite-medium');
    expect(fast[2]).toBe('groq--compound-off');
    const qwenIndex = fast.indexOf('qwen--qwen3-32b-off');
    const compoundIndex = fast.indexOf('groq--compound-off');
    expect(qwenIndex).toBeGreaterThan(-1);
    expect(qwenIndex).toBeGreaterThan(compoundIndex);
  });

  it('moderate tier: 3.5 medium, 120b, lite high (no qwen or scout)', () => {
    const moderate = SPEED_TIER_MODEL_ORDER.moderate;
    expect(moderate[0]).toBe('gemini-3.5-flash-medium');
    expect(moderate[1]).toBe('openai--gpt-oss-120b-off');
    expect(moderate[2]).toBe('gemini-3.1-flash-lite-high');
    expect(moderate).not.toContain('qwen--qwen3-32b-off');
    expect(moderate).not.toContain('meta-llama--llama-4-scout-17b-16e-instruct-off');
    const llama70Index = moderate.indexOf('llama-3.3-70b-versatile-off');
    expect(llama70Index).toBeGreaterThan(-1);
  });

  it('places 120b above lite-high in moderate comparisons', () => {
    expect(
      compareRegistryStrength('openai--gpt-oss-120b-off', 'gemini-3.1-flash-lite-high'),
    ).toBeLessThan(0);
    expect(
      compareRegistryStrength('gemini-3.5-flash-medium', 'openai--gpt-oss-120b-off'),
    ).toBeLessThan(0);
  });

  it('resolveBaseSlug strips thinking suffix', () => {
    expect(resolveBaseSlug('gemini-3.5-flash-minimal')).toBe('gemini-3.5-flash');
    expect(resolveBaseSlug('gemini-3.1-flash-lite-low')).toBe('gemini-3.1-flash-lite');
    expect(resolveBaseSlug('groq--compound-off')).toBe('groq--compound');
  });
});
