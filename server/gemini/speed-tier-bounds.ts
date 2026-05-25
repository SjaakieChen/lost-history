import type { SpeedTier } from '../../shared/gemini-types.js';

export interface SpeedTierBound {
  min?: number;
  max?: number;
}

export type SpeedTierBounds = Record<SpeedTier, SpeedTierBound>;

/**
 * Millisecond thresholds for total response time (p50).
 * Set each value after running `npm run calibrate:speed` and reviewing results.
 * Leave null until you decide bucket boundaries.
 */
export const SPEED_TIER_BOUNDS_MS: SpeedTierBounds | null = null;

export function areSpeedTierBoundsConfigured(): boolean {
  return SPEED_TIER_BOUNDS_MS !== null;
}

export function getSpeedTierBounds(): SpeedTierBounds {
  if (!SPEED_TIER_BOUNDS_MS) {
    throw new Error(
      'Speed tier bounds are not configured. Run npm run calibrate:speed, then set SPEED_TIER_BOUNDS_MS in server/gemini/speed-tier-bounds.ts.',
    );
  }
  return SPEED_TIER_BOUNDS_MS;
}
