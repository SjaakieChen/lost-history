import { describe, expect, it } from 'vitest';
import {
  classifyP50ToSpeedTier,
  heuristicSpeedTierForThinking,
} from '../../server/gemini/speed-tier-classify.js';
import type { SpeedTierBounds } from '../../server/gemini/speed-tier-bounds.js';

describe('heuristicSpeedTierForThinking', () => {
  it('maps thinking presets to speed tiers before calibration', () => {
    expect(heuristicSpeedTierForThinking('minimal')).toBe('instant');
    expect(heuristicSpeedTierForThinking('off')).toBe('instant');
    expect(heuristicSpeedTierForThinking('low')).toBe('fast');
    expect(heuristicSpeedTierForThinking('medium')).toBe('moderate');
    expect(heuristicSpeedTierForThinking('high')).toBe('slow');
  });
});

describe('classifyP50ToSpeedTier', () => {
  const bounds: SpeedTierBounds = {
    instant: { max: 2500 },
    fast: { min: 2500, max: 6000 },
    moderate: { min: 6000, max: 15000 },
    slow: { min: 15000 },
  };

  it('classifies p50 into buckets', () => {
    expect(classifyP50ToSpeedTier(1200, bounds)).toBe('instant');
    expect(classifyP50ToSpeedTier(4000, bounds)).toBe('fast');
    expect(classifyP50ToSpeedTier(9000, bounds)).toBe('moderate');
    expect(classifyP50ToSpeedTier(20000, bounds)).toBe('slow');
  });

  it('returns null when no bucket matches', () => {
    expect(classifyP50ToSpeedTier(6000, bounds)).toBe('moderate');
  });
});
