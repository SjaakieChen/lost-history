import type { Voxel } from '../types.js';
import type { PlacedObjectSpec } from './types.js';
import type {
  ExternalVoxelCoordinate,
  LandscapeSceneSnapshot,
  PlacedObjectInput,
} from './types.js';

export function toViewerVoxels(
  coords: ExternalVoxelCoordinate[] | Voxel[],
  idOffset = 0,
): Voxel[] {
  return coords.map((entry, index) => {
    if ('c' in entry) {
      return entry as Voxel;
    }
    const external = entry as ExternalVoxelCoordinate;
    return {
      id: idOffset + index,
      x: external.x,
      y: external.y,
      z: external.z,
      c: external.color,
    };
  });
}

export function placedObjectInputToSpec(input: PlacedObjectInput): PlacedObjectSpec {
  return {
    voxels: input.voxels,
    heightMeters: input.heightMeters,
    x: input.position.x,
    depth: input.position.depth,
    elevation: input.position.elevation,
  };
}

export function mapSnapshotToPlacedSpecs(
  snapshot: LandscapeSceneSnapshot,
): PlacedObjectSpec[] {
  return snapshot.objects.map(placedObjectInputToSpec);
}

export function normalizePlacedObjectInput(
  raw: Omit<PlacedObjectInput, 'voxels'> & {
    voxels: Voxel[] | ExternalVoxelCoordinate[];
  },
): PlacedObjectInput {
  return {
    ...raw,
    voxels: toViewerVoxels(raw.voxels),
  };
}
