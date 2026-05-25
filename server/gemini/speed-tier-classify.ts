import type { SpeedTier, ThinkingPower } from '../../shared/gemini-types.js';
import { getBaseSpeedTierOverride, resolveBaseSlug } from './model-ranking.js';
import type { SpeedTierBounds } from './speed-tier-bounds.js';
import { areSpeedTierBoundsConfigured, getSpeedTierBounds } from './speed-tier-bounds.js';

const SPEED_TIER_ORDER: SpeedTier[] = ['instant', 'fast', 'moderate', 'slow'];

/** Pre-calibration fallback only — replaced once SPEED_TIER_BOUNDS_MS is set. */
export function heuristicSpeedTierForThinking(bakedThinkingPower: ThinkingPower): SpeedTier {
  switch (bakedThinkingPower) {
    case 'off':
    case 'minimal':
      return 'instant';
    case 'low':
      return 'fast';
    case 'medium':
      return 'moderate';
    case 'high':
      return 'slow';
    default:
      return 'moderate';
  }
}

export function classifyP50ToSpeedTier(p50Ms: number, bounds: SpeedTierBounds): SpeedTier | null {
  for (const tier of SPEED_TIER_ORDER) {
    const { min, max } = bounds[tier];
    const aboveMin = min === undefined || p50Ms >= min;
    const belowMax = max === undefined || p50Ms < max;
    if (aboveMin && belowMax) {
      return tier;
    }
  }
  return null;
}

export function resolveProbeSpeedTier(
  p50Ms: number | undefined,
  bakedThinkingPower: ThinkingPower,
  probeKey?: string,
): SpeedTier {
  if (probeKey) {
    const override = getBaseSpeedTierOverride(resolveBaseSlug(probeKey));
    if (override) {
      return override;
    }
  }

  if (p50Ms !== undefined && areSpeedTierBoundsConfigured()) {
    const classified = classifyP50ToSpeedTier(p50Ms, getSpeedTierBounds());
    if (classified) {
      return classified;
    }
  }
  return heuristicSpeedTierForThinking(bakedThinkingPower);
}

export function getSpeedTierDowngradeChain(start: SpeedTier): SpeedTier[] {
  const startIndex = SPEED_TIER_ORDER.indexOf(start);
  if (startIndex === -1) {
    return [start];
  }
  return SPEED_TIER_ORDER.slice(startIndex);
}

export function isSpeedTierDowngraded(requested: SpeedTier, used: SpeedTier): boolean {
  const requestedIndex = SPEED_TIER_ORDER.indexOf(requested);
  const usedIndex = SPEED_TIER_ORDER.indexOf(used);
  return usedIndex > requestedIndex;
}

export { SPEED_TIER_ORDER };
