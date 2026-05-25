import type {
  LandscapeSceneState,
  PlacedInstance,
  SceneObjectCatalogEntry,
  ScenePosition,
} from '../../shared/scene-agent-types.js';
import {
  createDefaultSceneState,
  DEFAULT_SCENE_SUN,
  DEFAULT_SCENE_VIEWER,
} from '../../shared/scene-agent-types.js';
import { getCatalogEntry } from '../../shared/scene-catalog.js';

const LANDSCAPE_SCENE_CONSTANTS = {
  humanHeight: 1.7,
  backgroundDistance: 200,
  virtualDistance: 2000,
  maxHeadYaw: 30,
  maxHeadPitch: 15,
} as const;

export function cloneSceneState(state: LandscapeSceneState): LandscapeSceneState {
  return structuredClone(state);
}

export function normalizeSceneState(input: LandscapeSceneState): LandscapeSceneState {
  const base = createDefaultSceneState();
  return {
    backgroundUrl: input.backgroundUrl?.trim() || base.backgroundUrl,
    horizonRatio: input.horizonRatio,
    instances: Array.isArray(input.instances) ? input.instances.map(normalizeInstance) : [],
    viewer: {
      positionX: Number(input.viewer?.positionX ?? DEFAULT_SCENE_VIEWER.positionX),
      headYaw: Number(input.viewer?.headYaw ?? DEFAULT_SCENE_VIEWER.headYaw),
      headPitch: Number(input.viewer?.headPitch ?? DEFAULT_SCENE_VIEWER.headPitch),
    },
    sun: {
      azimuth: Number(input.sun?.azimuth ?? DEFAULT_SCENE_SUN.azimuth),
      elevation: Number(input.sun?.elevation ?? DEFAULT_SCENE_SUN.elevation),
    },
  };
}

function normalizeInstance(instance: PlacedInstance): PlacedInstance {
  return {
    instanceId: String(instance.instanceId ?? '').trim(),
    catalogId: String(instance.catalogId ?? '').trim(),
    heightMeters:
      instance.heightMeters !== undefined ? Number(instance.heightMeters) : undefined,
    position: normalizePosition(instance.position),
  };
}

function normalizePosition(position: ScenePosition | undefined): ScenePosition {
  return {
    x: Number(position?.x ?? 0),
    depth: Number(position?.depth ?? 0),
    elevation: Number(position?.elevation ?? 0),
  };
}

export function resolveInstanceHeight(
  catalogId: string,
  heightMeters: number | undefined,
): { height: number; error?: string } {
  const entry = getCatalogEntry(catalogId);
  if (!entry) {
    return { height: 0, error: `Unknown catalogId "${catalogId}".` };
  }
  const height = heightMeters ?? entry.defaultHeightMeters;
  if (!Number.isFinite(height) || height <= 0) {
    return { height: 0, error: 'heightMeters must be a positive number.' };
  }
  return { height };
}

export function placeInstance(
  state: LandscapeSceneState,
  instance: PlacedInstance,
): { ok: true } | { ok: false; error: string } {
  if (!instance.instanceId) {
    return { ok: false, error: 'instanceId is required.' };
  }
  if (state.instances.some((i) => i.instanceId === instance.instanceId)) {
    return { ok: false, error: `instanceId "${instance.instanceId}" is already placed.` };
  }
  const entry = getCatalogEntry(instance.catalogId);
  if (!entry) {
    return {
      ok: false,
      error: `Unknown catalogId "${instance.catalogId}". Call list_available_objects first.`,
    };
  }
  const heightResult = resolveInstanceHeight(instance.catalogId, instance.heightMeters);
  if (heightResult.error) {
    return { ok: false, error: heightResult.error };
  }
  if (instance.position.depth <= 0) {
    return { ok: false, error: 'depth must be positive (meters into the scene).' };
  }

  state.instances.push({
    ...instance,
    heightMeters: heightResult.height,
  });
  return { ok: true };
}

export function moveInstance(
  state: LandscapeSceneState,
  instanceId: string,
  position: ScenePosition,
): { ok: true } | { ok: false; error: string } {
  const found = state.instances.find((i) => i.instanceId === instanceId);
  if (!found) {
    return { ok: false, error: `No instance "${instanceId}".` };
  }
  if (position.depth <= 0) {
    return { ok: false, error: 'depth must be positive.' };
  }
  found.position = normalizePosition(position);
  return { ok: true };
}

export function removeInstance(
  state: LandscapeSceneState,
  instanceId: string,
): { ok: true } | { ok: false; error: string } {
  const index = state.instances.findIndex((i) => i.instanceId === instanceId);
  if (index < 0) {
    return { ok: false, error: `No instance "${instanceId}".` };
  }
  state.instances.splice(index, 1);
  return { ok: true };
}

export function clearInstances(state: LandscapeSceneState): void {
  state.instances.length = 0;
}

export function setBackground(state: LandscapeSceneState, url: string): { ok: true } | { ok: false; error: string } {
  const trimmed = url.trim();
  if (!trimmed) {
    return { ok: false, error: 'url is required.' };
  }
  state.backgroundUrl = trimmed;
  return { ok: true };
}

export function setViewerPosition(
  state: LandscapeSceneState,
  x: number,
): { ok: true; clampedX: number } {
  const maxX = estimateMaxViewerX(state);
  const clampedX = Math.max(-maxX, Math.min(maxX, x));
  state.viewer.positionX = clampedX;
  return { ok: true, clampedX };
}

export function setHeadLook(
  state: LandscapeSceneState,
  yaw: number,
  pitch: number,
): { ok: true; yaw: number; pitch: number } {
  const yawClamped = Math.max(
    -LANDSCAPE_SCENE_CONSTANTS.maxHeadYaw,
    Math.min(LANDSCAPE_SCENE_CONSTANTS.maxHeadYaw, yaw),
  );
  const pitchClamped = Math.max(
    0,
    Math.min(LANDSCAPE_SCENE_CONSTANTS.maxHeadPitch, pitch),
  );
  state.viewer.headYaw = yawClamped;
  state.viewer.headPitch = pitchClamped;
  return { ok: true, yaw: yawClamped, pitch: pitchClamped };
}

export function setSunPosition(
  state: LandscapeSceneState,
  azimuth: number,
  elevation: number,
): { ok: true } {
  state.sun.azimuth = azimuth;
  state.sun.elevation = Math.max(0, Math.min(90, elevation));
  return { ok: true };
}

/** Rough placement limit when background arc length is unknown (server-side estimate). */
export function estimatePlacementLimit(depth: number, buffer = 2): number {
  if (depth <= 0) return 0;
  const arcLength = 200 * (21 / 9);
  const sliceHalfWidth = (arcLength * depth) / LANDSCAPE_SCENE_CONSTANTS.backgroundDistance;
  return sliceHalfWidth + buffer;
}

function estimateMaxViewerX(_state: LandscapeSceneState): number {
  const arcLength = 200 * (21 / 9);
  const ratio = LANDSCAPE_SCENE_CONSTANTS.backgroundDistance / LANDSCAPE_SCENE_CONSTANTS.virtualDistance;
  return Math.max(5, arcLength * 0.25 * ratio);
}

export function getSceneConstantsForTools(): typeof LANDSCAPE_SCENE_CONSTANTS {
  return LANDSCAPE_SCENE_CONSTANTS;
}
