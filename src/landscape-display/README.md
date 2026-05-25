# @journey/landscape-display

Migration-ready **2.5D landscape viewer** with voxel mesh placement, cylindrical parallax background, shadow mapping, and **horizon auto-detection** in `LandscapeViewer` (when `horizonRatio` is omitted).

Copy this folder into a React + Vite project. See [MIGRATION.md](./MIGRATION.md).

## Quick test (in this monorepo)

```bash
pnpm dev
```

Open http://localhost:3000/packages/landscape-display/demo/index.html

## Exports

- `LandscapeScene`, `createVoxelMesh`, `detectHorizonRatio`, `exampleVoxelData`
- React: `import { LandscapeViewer, detectHorizonRatio } from './react'`
