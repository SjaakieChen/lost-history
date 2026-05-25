# Landscape display (Lost History)

**2.5D landscape viewer** with voxel mesh placement, cylindrical parallax background, shadow mapping, and horizon auto-detection.

## Lost History usage

```bash
npm run dev
```

Open the app — the **game shell** embeds a square `LandscapePanel` beside chat. Default scene: [`src/game/default-scene.ts`](../game/default-scene.ts).

Background placeholder: `public/landscapes/default.svg` (replace with 21:9 PNG; see `public/landscapes/README.md`).

## Exports

- **Game API:** `LandscapeSceneController`, `LandscapeSceneSnapshot`, `LANDSCAPE_SCENE_CONSTANTS` from `./api`
- **React:** `LandscapePanel` (game window), `LandscapeViewer` (dev/smoke)
- **Low-level:** `LandscapeScene`, `createVoxelMesh`, `detectHorizonRatio`, `exampleVoxelData`

See [MIGRATION.md](./MIGRATION.md).
