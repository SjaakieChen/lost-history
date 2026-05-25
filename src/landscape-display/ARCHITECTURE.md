# LandscapeDisplay8 Architecture Documentation

This system provides a 2.5D landscape viewer with cylindrical background, parallax scrolling, and object placement capabilities.

## Inputs Required

### 1. Configuration (LandscapeConfig)

- `containerId` or `container`: DOM target (use `container` with React refs)
- `backgroundUrl`: URL/path to background image (21:9 aspect ratio recommended)
- `manageContainerStyles`: When false, does not apply flex centering to the container
- `onBackgroundLoadError`: Optional callback if the initial background fails to load
- `humanHeight`: Camera height in meters (e.g., 1.7m)
- `viewWindowSize`: Square viewport size in pixels (e.g., 800)
- `horizonRatio`: Horizon position (0.0-0.5, where 0.25 = 1/4 from bottom). In React, omit this prop to run `detectHorizonRatio` on `backgroundUrl` before the scene is created; pass it explicitly to skip auto-detect
- `backgroundDistance`: Cylinder radius in meters (e.g., 200m)
- `virtualDistance`: Virtual distance for parallax (e.g., 2000m)

### 2. Background Image

- Wide panoramic image (21:9 aspect ratio works best)
- Loaded via URL in config or changed dynamically via `setBackgroundImage()`

### 3. Objects (Optional)

- THREE.Object3D meshes (typically created via `createVoxelMesh()`)
- Placement coordinates: X offset (meters), depth (meters), vertical elevation (meters)

### 4. User Controls (Optional, can be implemented externally)

- Viewer position X (walking left/right)
- Head look (yaw: -30 to +30 degrees, pitch: 0 to 15 degrees)
- Sun position (azimuth: 0-360°, elevation: 0-90°)

## Outputs / Public API

### Scene Management

- `getRendererElement()`: Returns the canvas DOM element for attaching event listeners
- `getMaxViewerX()`: Returns maximum walk distance (±meters)
- `getHeadLook()`: Returns current head angles `{ yaw, pitch }` in degrees
- `isDisposed()`: Whether `dispose()` has been called
- `dispose()`: Stop the render loop and free WebGL resources
- `setViewWindowSize(px)`: Resize the square viewport

### Object Placement

- `placeObject(object3D, xOffset, depth, elevation)`: Add object to scene
- `removeObject(object3D)`: Remove specific object
- `clearObjects(objects[])`: Remove multiple objects
- `getMaxLateralRange(depth, buffer)`: Calculate cylinder slice width at depth
- `getWorldPlacementLimit(depth, buffer)`: Calculate total placement range (walk + slice)

### Viewer Controls

- `setViewerPosition(xInMeters)`: Move viewer left/right (clamped to limits)
- `setHeadLook(yawDeg, pitchDeg)`: Rotate camera view (with smooth bounce-back at limits)

### Scene Configuration

- `setBackgroundImage(imageUrl)`: Change background (async, returns Promise)
- `setHorizonRatio(ratio)`: Adjust horizon position (0.0-0.5)
- `setSunPosition(azimuthDeg, elevationDeg)`: Set sun/shadow direction

## Internal Architecture

The system uses a "hamster wheel" approach:

- Background is a cylindrical mesh (radius = backgroundDistance) that moves with the camera
- Camera translates linearly (X position)
- Cylinder rotates to create parallax effect (based on virtualDistance)
- Objects are placed in world space and move relative to camera position

## Edge cases

- **Empty voxel array**: `createVoxelMesh([], height)` returns an empty `THREE.Group` with no meshes.
- **Background load failure**: Walk limits stay at 0 until a background loads; use `onBackgroundLoadError` to surface errors.

## Key Features

- **Parallax Scrolling**: Background rotates based on viewer position and virtual distance
- **Dynamic Limits**: Walk limits calculated from image width and head turn buffer
- **Geometric Constraints**: Object placement respects cylinder boundaries
- **Head Look System**: Smooth bounce-back when turning beyond limits
- **Shadow System**: Directional light with shadow mapping for objects

## Usage Pattern

```typescript
// 1. Create config
const config: LandscapeConfig = {
    containerId: 'my-container',
    backgroundUrl: '/path/to/image.png',
    humanHeight: 1.7,
    viewWindowSize: 800,
    horizonRatio: 0.25,
    backgroundDistance: 200,
    virtualDistance: 2000
};

// 2. Initialize scene
const scene = new LandscapeScene(config);

// 3. Place objects
const mesh = createVoxelMesh(voxelData, heightInMeters);
scene.placeObject(mesh, xOffset, depth, elevation);

// 4. Control viewer (optional, can be done externally)
scene.setViewerPosition(xPosition);
scene.setHeadLook(yawDeg, pitchDeg);

// 5. Attach event listeners to renderer element
const canvas = scene.getRendererElement();
canvas.addEventListener('mousedown', ...);
```
