import { describe, expect, it } from 'vitest';
import {
  mapSnapshotToPlacedSpecs,
  normalizePlacedObjectInput,
  placedObjectInputToSpec,
  toViewerVoxels,
} from '../../src/landscape-display/api/voxel-adapter.js';
import type { LandscapeSceneSnapshot } from '../../src/landscape-display/api/types.js';

describe('voxel-adapter', () => {
  it('maps color field to c for viewer voxels', () => {
    const voxels = toViewerVoxels([
      { x: 0, y: 0, z: 0, color: '#ff0000' },
      { x: 1, y: 0, z: 0, color: '#00ff00' },
    ]);
    expect(voxels[0]).toEqual({ id: 0, x: 0, y: 0, z: 0, c: '#ff0000' });
    expect(voxels[1].c).toBe('#00ff00');
  });

  it('maps snapshot objects to placed specs', () => {
    const snapshot: LandscapeSceneSnapshot = {
      backgroundUrl: '/landscapes/default.svg',
      objects: [
        {
          id: 'a',
          voxels: [{ id: 0, x: 0, y: 0, z: 0, c: '#000' }],
          heightMeters: 2,
          position: { x: 1, depth: 10, elevation: 0.5 },
        },
      ],
    };
    const specs = mapSnapshotToPlacedSpecs(snapshot);
    expect(specs).toEqual([
      {
        voxels: snapshot.objects[0].voxels,
        heightMeters: 2,
        x: 1,
        depth: 10,
        elevation: 0.5,
      },
    ]);
  });

  it('normalizePlacedObjectInput accepts external coordinates', () => {
    const input = normalizePlacedObjectInput({
      id: 'b',
      heightMeters: 1,
      position: { x: 0, depth: 5, elevation: 0 },
      voxels: [{ x: 0, y: 0, z: 0, color: '#abc' }],
    });
    expect(input.voxels[0].c).toBe('#abc');
    expect(placedObjectInputToSpec(input).depth).toBe(5);
  });
});
