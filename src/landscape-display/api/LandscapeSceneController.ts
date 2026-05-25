import type * as THREE from 'three';
import { detectHorizonRatio } from '../horizonDetector.js';
import { LandscapeScene } from '../LandscapeScene.js';
import { createVoxelMesh } from '../VoxelBuilder.js';
import type { PlacedObjectSpec } from './types.js';
import { LANDSCAPE_SCENE_CONSTANTS } from './scene-constants.js';
import type { LandscapeSceneConstants } from './scene-constants.js';
import { placedObjectInputToSpec } from './voxel-adapter.js';
import type { LandscapeSceneSnapshot, PlacedObjectInput } from './types.js';

const FALLBACK_HORIZON_RATIO = 0.25;

export interface LandscapeSceneControllerOptions {
  onBackgroundError?: (error: Error) => void;
}

export class LandscapeSceneController {
  private readonly meshById = new Map<string, THREE.Object3D>();
  private readonly meshes: THREE.Object3D[] = [];
  private horizonRatio: number;
  private backgroundUrl: string;

  private constructor(
    private scene: LandscapeScene,
    horizonRatio: number,
    backgroundUrl: string,
  ) {
    this.horizonRatio = horizonRatio;
    this.backgroundUrl = backgroundUrl;
  }

  static async create(
    container: HTMLElement,
    snapshot: LandscapeSceneSnapshot,
    options?: LandscapeSceneControllerOptions,
  ): Promise<LandscapeSceneController> {
    const horizonRatio = await LandscapeSceneController.resolveHorizonRatio(snapshot);
    const scene = new LandscapeScene({
      container,
      backgroundUrl: snapshot.backgroundUrl,
      humanHeight: LANDSCAPE_SCENE_CONSTANTS.humanHeight,
      viewWindowSize: LANDSCAPE_SCENE_CONSTANTS.initialViewWindowSize,
      horizonRatio,
      backgroundDistance: LANDSCAPE_SCENE_CONSTANTS.backgroundDistance,
      virtualDistance: LANDSCAPE_SCENE_CONSTANTS.virtualDistance,
      manageContainerStyles: false,
      onBackgroundLoadError: options?.onBackgroundError,
    });

    const controller = new LandscapeSceneController(
      scene,
      horizonRatio,
      snapshot.backgroundUrl,
    );
    controller.applyObjects(snapshot.objects);
    return controller;
  }

  private static async resolveHorizonRatio(
    snapshot: LandscapeSceneSnapshot,
  ): Promise<number> {
    if (snapshot.horizonRatio !== undefined) {
      return snapshot.horizonRatio;
    }
    try {
      return await detectHorizonRatio(snapshot.backgroundUrl);
    } catch {
      return FALLBACK_HORIZON_RATIO;
    }
  }

  getConstants(): LandscapeSceneConstants {
    return LANDSCAPE_SCENE_CONSTANTS;
  }

  isDisposed(): boolean {
    return this.scene.isDisposed();
  }

  getCanvasElement(): HTMLElement | null {
    return this.scene.getRendererElement();
  }

  getHeadLook(): { yaw: number; pitch: number } {
    return this.scene.getHeadLook();
  }

  getMaxViewerX(): number {
    return this.scene.getMaxViewerX();
  }

  getPlacementLimit(depth: number, buffer = 2): number {
    return this.scene.getWorldPlacementLimit(depth, buffer);
  }

  resizeViewWindow(px: number): void {
    this.scene.setViewWindowSize(px);
  }

  async setBackground(url: string): Promise<void> {
    this.ensureAlive();
    await this.scene.setBackgroundImage(url);
    this.backgroundUrl = url;
  }

  setViewerPosition(x: number): void {
    this.ensureAlive();
    this.scene.setViewerPosition(x);
  }

  setHeadLook(yawDeg: number, pitchDeg: number): void {
    this.ensureAlive();
    this.scene.setHeadLook(yawDeg, pitchDeg);
  }

  setSunPosition(azimuthDeg: number, elevationDeg: number): void {
    this.ensureAlive();
    this.scene.setSunPosition(azimuthDeg, elevationDeg);
  }

  setObjects(objects: PlacedObjectInput[]): void {
    this.ensureAlive();
    this.clearAllMeshes();
    this.applyObjects(objects);
  }

  addObject(input: PlacedObjectInput): void {
    this.ensureAlive();
    if (this.meshById.has(input.id)) {
      this.updateObject(input);
      return;
    }
    const mesh = this.placeSpec(placedObjectInputToSpec(input));
    this.meshById.set(input.id, mesh);
    this.meshes.push(mesh);
  }

  updateObject(input: PlacedObjectInput): void {
    this.ensureAlive();
    this.removeObject(input.id);
    this.addObject(input);
  }

  removeObject(id: string): void {
    this.ensureAlive();
    const mesh = this.meshById.get(id);
    if (!mesh) return;
    this.scene.removeObject(mesh);
    this.meshById.delete(id);
    const index = this.meshes.indexOf(mesh);
    if (index >= 0) {
      this.meshes.splice(index, 1);
    }
  }

  async reloadScene(snapshot: LandscapeSceneSnapshot): Promise<void> {
    this.ensureAlive();
    const nextHorizon =
      snapshot.horizonRatio ??
      (snapshot.backgroundUrl !== this.backgroundUrl
        ? await LandscapeSceneController.resolveHorizonRatio(snapshot)
        : this.horizonRatio);

    if (snapshot.backgroundUrl !== this.backgroundUrl) {
      await this.setBackground(snapshot.backgroundUrl);
    }

    if (
      snapshot.horizonRatio !== undefined &&
      snapshot.horizonRatio !== this.horizonRatio
    ) {
      throw new Error(
        'Horizon ratio changes require a new LandscapeSceneController (dispose and create again).',
      );
    }

    this.horizonRatio = nextHorizon;
    this.setObjects(snapshot.objects);
  }

  dispose(): void {
    if (this.scene.isDisposed()) return;
    this.clearAllMeshes();
    this.scene.dispose();
  }

  private applyObjects(objects: PlacedObjectInput[]): void {
    for (const input of objects) {
      const mesh = this.placeSpec(placedObjectInputToSpec(input));
      this.meshById.set(input.id, mesh);
      this.meshes.push(mesh);
    }
  }

  private placeSpec(spec: PlacedObjectSpec): THREE.Object3D {
    const mesh = createVoxelMesh(spec.voxels, spec.heightMeters);
    this.scene.placeObject(mesh, spec.x, spec.depth, spec.elevation);
    return mesh;
  }

  private clearAllMeshes(): void {
    if (this.meshes.length > 0) {
      this.scene.clearObjects(this.meshes);
    }
    this.meshById.clear();
    this.meshes.length = 0;
  }

  private ensureAlive(): void {
    if (this.scene.isDisposed()) {
      throw new Error('LandscapeSceneController has been disposed.');
    }
  }
}
