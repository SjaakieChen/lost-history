export interface VoxelCoordinate {
    x: number;
    y: number;
    z: number;
    color: string | number;
}

export interface VoxelData {
    voxels: VoxelCoordinate[];
}

export interface Voxel {
    id: number;
    x: number;
    y: number;
    z: number;
    c: string | number; // color
}

export interface LandscapeConfig {
    /** DOM id when `container` is not provided */
    containerId?: string;
    /** Preferred for React refs */
    container?: HTMLElement;
    backgroundUrl: string;
    humanHeight: number;       // Camera height (e.g., 1.7m)
    viewWindowSize: number;    // Pixel dimensions (Square)
    horizonRatio: number;      // 0.25 for 1/4th from bottom
    backgroundDistance: number;// 200m (physical distance for shadows/horizon)
    virtualDistance: number;   // 2000m+ (virtual distance for parallax effect)
    /** When false, does not set flex centering on the container (default: true) */
    manageContainerStyles?: boolean;
    /** Called when the initial background image fails to load */
    onBackgroundLoadError?: (error: Error) => void;
}
