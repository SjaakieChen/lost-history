/** Serializable scene state for the scene agent API (server + client). */

export interface ScenePosition {
  x: number;
  depth: number;
  elevation: number;
}

export interface PlacedInstance {
  instanceId: string;
  catalogId: string;
  heightMeters?: number;
  position: ScenePosition;
}

export interface SceneViewerState {
  positionX: number;
  headYaw: number;
  headPitch: number;
}

export interface SceneSunState {
  azimuth: number;
  elevation: number;
}

export interface LandscapeSceneState {
  backgroundUrl: string;
  horizonRatio?: number;
  instances: PlacedInstance[];
  viewer: SceneViewerState;
  sun: SceneSunState;
}

/** Voxel definition stored in the object catalog (not sent via tools). */
export interface CatalogVoxel {
  id: number;
  x: number;
  y: number;
  z: number;
  c: string | number;
}

export interface SceneObjectCatalogEntry {
  catalogId: string;
  displayName: string;
  description: string;
  voxels: CatalogVoxel[];
  defaultHeightMeters: number;
}

export const DEFAULT_SCENE_VIEWER: SceneViewerState = {
  positionX: 0,
  headYaw: 0,
  headPitch: 0,
};

export const DEFAULT_SCENE_SUN: SceneSunState = {
  azimuth: 180,
  elevation: 45,
};

export function createDefaultSceneState(
  overrides?: Partial<LandscapeSceneState>,
): LandscapeSceneState {
  return {
    backgroundUrl: '/landscapes/default.svg',
    instances: [],
    viewer: { ...DEFAULT_SCENE_VIEWER },
    sun: { ...DEFAULT_SCENE_SUN },
    ...overrides,
  };
}
