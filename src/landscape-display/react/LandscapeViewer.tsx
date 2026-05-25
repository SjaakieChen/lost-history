import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import * as THREE from 'three';
import { LandscapeScene } from '../LandscapeScene';
import { createVoxelMesh } from '../VoxelBuilder';
import { exampleVoxelData } from '../example-voxel-data';
import { detectHorizonRatio } from '../horizonDetector';
import type { PlacedObjectSpec } from '../api/types.js';
import type { Voxel } from '../types';

const FALLBACK_HORIZON_RATIO = 0.25;

export type { PlacedObjectSpec };

export interface LandscapeViewerProps {
    backgroundUrl: string;
    /** When set, used as-is and auto-detect is skipped */
    horizonRatio?: number;
    /** When horizonRatio is omitted: run detectHorizonRatio (default: true) */
    autoDetectHorizon?: boolean;
    onHorizonDetected?: (ratio: number) => void;
    viewWindowSize?: number;
    humanHeight?: number;
    backgroundDistance?: number;
    virtualDistance?: number;
    objects?: PlacedObjectSpec[];
    /** When true and `objects` is omitted, places `exampleVoxelData` (default: true) */
    showExampleObject?: boolean;
    onReady?: (scene: LandscapeScene) => void;
    onBackgroundLoadError?: (error: Error) => void;
    /** Forwarded to LandscapeScene (default: true) */
    manageContainerStyles?: boolean;
    /** Fit canvas to container width via ResizeObserver (default: false) */
    resizeToContainer?: boolean;
    className?: string;
    style?: CSSProperties;
}

const DEFAULT_EXAMPLE: PlacedObjectSpec = {
    voxels: exampleVoxelData,
    heightMeters: 2,
    x: 0,
    depth: 20,
    elevation: 0,
};

function specsEqual(a: PlacedObjectSpec[], b: PlacedObjectSpec[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const left = a[i];
        const right = b[i];
        if (
            left.heightMeters !== right.heightMeters ||
            left.x !== right.x ||
            left.depth !== right.depth ||
            left.elevation !== right.elevation ||
            left.voxels.length !== right.voxels.length
        ) {
            return false;
        }
    }
    return true;
}

function resolveSpecs(
    objects: PlacedObjectSpec[] | undefined,
    showExampleObject: boolean
): PlacedObjectSpec[] {
    return objects ?? (showExampleObject ? [DEFAULT_EXAMPLE] : []);
}

export function LandscapeViewer({
    backgroundUrl,
    horizonRatio,
    autoDetectHorizon = true,
    onHorizonDetected,
    viewWindowSize = 800,
    humanHeight = 1.7,
    backgroundDistance = 200,
    virtualDistance = 2000,
    objects,
    showExampleObject = true,
    onReady,
    onBackgroundLoadError,
    manageContainerStyles,
    resizeToContainer = false,
    className,
    style,
}: LandscapeViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<LandscapeScene | null>(null);
    const placedMeshesRef = useRef<THREE.Object3D[]>([]);
    const onReadyRef = useRef(onReady);
    const onBackgroundLoadErrorRef = useRef(onBackgroundLoadError);
    const onHorizonDetectedRef = useRef(onHorizonDetected);
    const prevSpecsRef = useRef<PlacedObjectSpec[] | null>(null);
    const [resolvedHorizon, setResolvedHorizon] = useState<number | null>(null);
    const [sceneKey, setSceneKey] = useState(0);

    onReadyRef.current = onReady;
    onBackgroundLoadErrorRef.current = onBackgroundLoadError;
    onHorizonDetectedRef.current = onHorizonDetected;

    useEffect(() => {
        let cancelled = false;

        const resolve = (ratio: number) => {
            if (!cancelled) setResolvedHorizon(ratio);
        };

        if (horizonRatio !== undefined) {
            resolve(horizonRatio);
            return () => {
                cancelled = true;
            };
        }

        setResolvedHorizon(null);

        if (!autoDetectHorizon) {
            resolve(FALLBACK_HORIZON_RATIO);
            return () => {
                cancelled = true;
            };
        }

        detectHorizonRatio(backgroundUrl)
            .then((ratio) => {
                onHorizonDetectedRef.current?.(ratio);
                resolve(ratio);
            })
            .catch(() => {
                resolve(FALLBACK_HORIZON_RATIO);
            });

        return () => {
            cancelled = true;
        };
    }, [backgroundUrl, horizonRatio, autoDetectHorizon]);

    useEffect(() => {
        if (resolvedHorizon === null) return;

        const el = containerRef.current;
        if (!el) return;

        const scene = new LandscapeScene({
            container: el,
            backgroundUrl,
            humanHeight,
            viewWindowSize,
            horizonRatio: resolvedHorizon,
            backgroundDistance,
            virtualDistance,
            manageContainerStyles,
            onBackgroundLoadError: (error) =>
                onBackgroundLoadErrorRef.current?.(error),
        });
        sceneRef.current = scene;
        onReadyRef.current?.(scene);
        setSceneKey((k) => k + 1);

        let resizeObserver: ResizeObserver | undefined;
        if (resizeToContainer) {
            resizeObserver = new ResizeObserver((entries) => {
                const entry = entries[0];
                if (!entry || scene.isDisposed()) return;
                const width = entry.contentRect.width;
                if (width > 0) scene.setViewWindowSize(width);
            });
            resizeObserver.observe(el);
        }

        return () => {
            resizeObserver?.disconnect();
            scene.clearObjects(placedMeshesRef.current);
            placedMeshesRef.current = [];
            scene.dispose();
            sceneRef.current = null;
        };
    }, [
        backgroundUrl,
        viewWindowSize,
        humanHeight,
        resolvedHorizon,
        backgroundDistance,
        virtualDistance,
        manageContainerStyles,
        resizeToContainer,
    ]);

    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene || scene.isDisposed()) return;

        const specs = resolveSpecs(objects, showExampleObject);
        if (prevSpecsRef.current && specsEqual(prevSpecsRef.current, specs)) {
            return;
        }
        prevSpecsRef.current = specs;

        scene.clearObjects(placedMeshesRef.current);
        placedMeshesRef.current = [];

        for (const spec of specs) {
            const mesh = createVoxelMesh(spec.voxels, spec.heightMeters);
            scene.placeObject(mesh, spec.x, spec.depth, spec.elevation);
            placedMeshesRef.current.push(mesh);
        }
    }, [objects, showExampleObject, sceneKey]);

    return (
        <div
            ref={containerRef}
            className={className}
            style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                ...style,
            }}
        />
    );
}
