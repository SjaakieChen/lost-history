/** Frozen scene physics — do not change after LandscapeScene init. */
export const LANDSCAPE_SCENE_CONSTANTS = {
  humanHeight: 1.7,
  backgroundDistance: 200,
  virtualDistance: 2000,
  initialViewWindowSize: 800,
  maxHeadYaw: 30,
  maxHeadPitch: 15,
} as const;

export type LandscapeSceneConstants = typeof LANDSCAPE_SCENE_CONSTANTS;
