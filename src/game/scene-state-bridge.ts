import type { LandscapeSceneSnapshot, PlacedObjectInput } from '../landscape-display/api/types.js';
import type { LandscapeSceneController } from '../landscape-display/api/LandscapeSceneController.js';
import type { LandscapeSceneState } from '../../shared/scene-agent-types.js';
import { getCatalogEntry } from '../../shared/scene-catalog.js';

export function sceneStateToSnapshot(state: LandscapeSceneState): LandscapeSceneSnapshot {
  const objects: PlacedObjectInput[] = [];

  for (const instance of state.instances) {
    const entry = getCatalogEntry(instance.catalogId);
    if (!entry) {
      continue;
    }
    objects.push({
      id: instance.instanceId,
      voxels: entry.voxels.map((v) => ({
        id: v.id,
        x: v.x,
        y: v.y,
        z: v.z,
        c: v.c,
      })),
      heightMeters: instance.heightMeters ?? entry.defaultHeightMeters,
      position: { ...instance.position },
    });
  }

  return {
    backgroundUrl: state.backgroundUrl,
    horizonRatio: state.horizonRatio,
    objects,
  };
}

export function applySceneControls(
  controller: LandscapeSceneController,
  state: LandscapeSceneState,
): void {
  if (controller.isDisposed()) {
    return;
  }
  controller.setViewerPosition(state.viewer.positionX);
  controller.setHeadLook(state.viewer.headYaw, state.viewer.headPitch);
  controller.setSunPosition(state.sun.azimuth, state.sun.elevation);
}
