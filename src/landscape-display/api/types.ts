import type { Voxel } from '../types.js';

/** Internal placement shape used by LandscapeSceneController and LandscapeViewer. */
export interface PlacedObjectSpec {
  voxels: Voxel[];
  heightMeters: number;
  x: number;
  depth: number;
  elevation: number;
}

export interface ObjectPosition {
  /** Lateral offset in meters (left negative, right positive). */
  x: number;
  /** Distance from viewer in meters (into the scene). */
  depth: number;
  /** Vertical elevation in meters. */
  elevation: number;
}

/** One placeable voxel object supplied by the game or LLM pipeline. */
export interface PlacedObjectInput {
  id: string;
  voxels: Voxel[];
  heightMeters: number;
  position: ObjectPosition;
  /** Narrative/debug only; not used by the renderer. */
  intent?: string;
}

export interface LandscapeSceneSnapshot {
  backgroundUrl: string;
  /** When omitted, horizon is auto-detected once at bootstrap. */
  horizonRatio?: number;
  objects: PlacedObjectInput[];
}

/** External voxel shape before normalization to viewer `Voxel`. */
export interface ExternalVoxelCoordinate {
  x: number;
  y: number;
  z: number;
  color: string | number;
}
