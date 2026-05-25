# Landscape Display — React migration guide

In **Lost History** this module lives at [`src/landscape-display/`](../landscape-display/). For other projects, copy the folder into `src/landscape-display/` (or `src/lib/landscape-display/`).

## Game embedding (Lost History)

Use **`LandscapePanel`** + **`LandscapeSceneController`** — not raw `LandscapeScene`.

```tsx
import { LandscapePanel } from '../landscape-display/react/LandscapePanel';
import type { LandscapeSceneSnapshot } from '../landscape-display/api/types';

const snapshot: LandscapeSceneSnapshot = {
  backgroundUrl: '/landscapes/default.svg',
  objects: [/* PlacedObjectInput[] */],
};

<LandscapePanel snapshot={snapshot} onReady={(c) => { /* imperative API */ }} />
```

- Frozen physics: `LANDSCAPE_SCENE_CONSTANTS` (`humanHeight`, distances) — never change after init.
- Mutable via controller: background, objects, viewer position, head look, sun, square resize.
- Horizon: set once per mount (`horizonRatio` in snapshot or auto-detect); change only by remounting the panel or passing a new explicit ratio at create time.

See [`api/LandscapeSceneController.ts`](api/LandscapeSceneController.ts) and [`react/LandscapePanel.tsx`](react/LandscapePanel.tsx).

## 1. Dependencies

```bash
npm install three
npm install -D @types/three
```

Your app already needs `react` and `react-dom`.

## 2. Background image

Copy a **21:9 panoramic** landscape into your app `public/` folder (the viewer assumes 21:9 when building the cylindrical background):

```
public/landscapes/default.png
```

The vanilla demo in the source repo uses `/artAssets/landscape5.png`.

## 3. Minimal usage

```tsx
import { LandscapeViewer } from '@/lib/landscape-display/react';

export function Scene() {
  return (
    <LandscapeViewer backgroundUrl="/landscapes/default.png" />
  );
}
```

**Horizon auto-detection runs by default** when you omit `horizonRatio`: the viewer calls `detectHorizonRatio(backgroundUrl)` before creating the scene (same idea as the vanilla demo). Use `onHorizonDetected={(ratio) => console.log(ratio)}` if you want the value in your app.

With default props you should see **`exampleVoxelData`** (~100 voxels, one object) at 2m height, 20m depth. Disable with `showExampleObject={false}`.

**Overrides:**

```tsx
// Skip auto-detect; use a fixed ratio
<LandscapeViewer backgroundUrl="..." horizonRatio={0.3} />

// No detection, default ratio 0.25
<LandscapeViewer backgroundUrl="..." autoDetectHorizon={false} />
```

## 4. Your own voxels

```tsx
import {
  LandscapeViewer,
  createVoxelMesh,
  type PlacedObjectSpec,
} from '@/lib/landscape-display';

const objects: PlacedObjectSpec[] = [
  {
    voxels: myVoxelArray,
    heightMeters: 2,
    x: 0,
    depth: 25,
    elevation: 0,
  },
];

<LandscapeViewer
  backgroundUrl="/landscapes/default.png"
  objects={objects}
  showExampleObject={false}
/>
```

Or use the imperative API via `onReady`:

```tsx
<LandscapeViewer
  backgroundUrl="/landscapes/default.png"
  showExampleObject={false}
  onReady={(scene) => {
    const mesh = createVoxelMesh(myVoxelArray, 2);
    scene.placeObject(mesh, 0, 20, 0);
  }}
/>
```

## 5. Voxel format

```typescript
interface Voxel {
  id: number;
  x: number;
  y: number;
  z: number;
  c: string | number; // e.g. "#4f362e"
}
```

If your AI returns `{ x, y, z, color }`, map `color` → `c` and assign `id`.

## 6. Coordinates

- Viewer at origin, camera looks down **−Z**
- `placeObject(mesh, xOffset, depth, elevation)` → world `(xOffset, elevation, -depth)`
- `scene.getWorldPlacementLimit(depth)` — max lateral placement at a depth

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full API.

## 7. Files to copy

| File | Required |
|------|----------|
| `types.ts`, `VoxelBuilder.ts`, `LandscapeScene.ts`, `horizonDetector.ts` | Yes |
| `example-voxel-data.ts` | Yes (smoke test + default object) |
| `index.ts` | Yes |
| `react/LandscapeViewer.tsx`, `react/index.ts` | Yes for React |
| `ARCHITECTURE.md`, `MIGRATION.md` | Recommended |

Do **not** copy `demo/` from this package unless you want a local reference page.

## 8. Horizon auto-detection (included)

The bundle includes [`horizonDetector.ts`](horizonDetector.ts) (`detectHorizonRatio`). `LandscapeViewer` runs it automatically unless you pass `horizonRatio` or set `autoDetectHorizon={false}`.

For non-React / custom pipelines:

```typescript
import { detectHorizonRatio, LandscapeScene } from '@/lib/landscape-display';

const ratio = await detectHorizonRatio('/landscapes/default.png');
const scene = new LandscapeScene({ /* ... */, horizonRatio: ratio });
```

Cross-origin images need CORS headers on the server, or use same-origin paths under `public/`.

## 9. Optional props and edge cases

| Prop / config | Notes |
|---------------|--------|
| `manageContainerStyles={false}` | Stops the viewer from setting flex layout on your container |
| `onBackgroundLoadError` | Fires if the background URL fails to load |
| `resizeToContainer` | Resizes the square canvas to the container width |
| `onHorizonDetected` | Fires with the detected ratio when auto-detect runs |
| `horizonRatio` | Manual ratio; skips auto-detect when provided |
| `autoDetectHorizon` | When `horizonRatio` omitted: `true` (default) runs detector, `false` uses 0.25 |
| Empty `Voxel[]` | `createVoxelMesh` returns an empty group (nothing drawn) |
| `objects` array | `LandscapeViewer` compares placement fields and `voxels.length`; stable references avoid redundant rebuilds |

Always call `scene.dispose()` (or unmount `LandscapeViewer`) when removing the viewer to free the WebGL context.
