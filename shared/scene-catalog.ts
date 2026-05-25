import { exampleVoxelData } from '../src/landscape-display/example-voxel-data.js';
import type { CatalogVoxel, SceneObjectCatalogEntry } from './scene-agent-types.js';

function smallStack(color: string, height: number): CatalogVoxel[] {
  const voxels: CatalogVoxel[] = [];
  let id = 0;
  for (let y = 0; y < height; y += 1) {
    voxels.push({ id: id++, x: 0, y, z: 0, c: color });
  }
  return voxels;
}

function smallCluster(colors: string[]): CatalogVoxel[] {
  const voxels: CatalogVoxel[] = [];
  let id = 0;
  colors.forEach((c, i) => {
    voxels.push({ id: id++, x: i % 2, y: 0, z: Math.floor(i / 2), c });
  });
  return voxels;
}

export const SCENE_OBJECT_CATALOG: SceneObjectCatalogEntry[] = [
  {
    catalogId: 'example_prop',
    displayName: 'Example prop',
    description: 'Large bundled voxel prop for smoke tests and focal points.',
    voxels: exampleVoxelData,
    defaultHeightMeters: 2,
  },
  {
    catalogId: 'red_candle',
    displayName: 'Red candle',
    description: 'A melted wax candle, suitable near the foreground.',
    voxels: smallStack('#8b2500', 4),
    defaultHeightMeters: 0.4,
  },
  {
    catalogId: 'ancient_scroll',
    displayName: 'Ancient scroll',
    description: 'A torn parchment scroll, low and wide.',
    voxels: smallCluster(['#c4a574', '#a08050', '#8b6914']),
    defaultHeightMeters: 0.25,
  },
  {
    catalogId: 'silver_inkwell',
    displayName: 'Silver inkwell',
    description: 'A small spilled inkwell, metallic sheen.',
    voxels: smallCluster(['#b0b0b8', '#707078', '#404048']),
    defaultHeightMeters: 0.35,
  },
];

const catalogById = new Map(
  SCENE_OBJECT_CATALOG.map((entry) => [entry.catalogId, entry]),
);

export function getCatalogEntry(catalogId: string): SceneObjectCatalogEntry | undefined {
  return catalogById.get(catalogId);
}

export function listCatalogEntries(): SceneObjectCatalogEntry[] {
  return [...SCENE_OBJECT_CATALOG];
}
