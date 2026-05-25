import * as THREE from 'three';
import type { LandscapeConfig } from './types.js';

export class LandscapeScene {
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private config: LandscapeConfig;
    private container!: HTMLElement;
    private floorMesh: THREE.Mesh | null = null;
    private animationFrameId: number | null = null;
    private disposed = false;

    // Elements
    private bgPlane: THREE.Mesh | null = null;
    private sunLight!: THREE.DirectionalLight;
    
    // Limits for viewer movement
    private maxViewerX: number = 0;
    private parallaxFactor: number = 0;
    
    // Limits for head rotation
    private readonly maxHeadYaw = 30;   // Degrees Left/Right
    private readonly maxHeadPitch = 15; // Degrees Up (No Down)
    
    // Head look state tracking
    private currentYaw: number = 0;
    private currentPitch: number = 0;
    private targetYaw: number = 0;
    private targetPitch: number = 0;
    private isBouncingBack: boolean = false;

    constructor(config: LandscapeConfig) {
        this.config = config;
        this.init();
    }

    private resolveContainer(): HTMLElement {
        const container =
            this.config.container ??
            (this.config.containerId
                ? document.getElementById(this.config.containerId)
                : null);
        if (!container) {
            throw new Error(
                'LandscapeScene requires config.container or config.containerId'
            );
        }
        return container;
    }

    private init() {
        this.container = this.resolveContainer();
        const container = this.container;

        // 1. Setup Scene
        this.scene = new THREE.Scene();

        // 2. Setup Camera
        // FOV 45 is standard for human eye perception in games
        this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, this.config.backgroundDistance + 50);
        this.camera.position.set(0, this.config.humanHeight, 0);

        // 3. Setup Renderer (Square View)
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.config.viewWindowSize, this.config.viewWindowSize);
        // Important for 2.5D blending:
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; 
        
        if (this.config.manageContainerStyles !== false) {
            container.style.display = 'flex';
            container.style.justifyContent = 'center';
            container.style.alignItems = 'center';
        }
        container.appendChild(this.renderer.domElement);

        // 4. Build World
        this.setupLights();
        this.setupEnvironment();

        // 5. Start Loop
        this.animate();
    }

    private setupLights() {
        // Ambient light ensures shadows aren't pitch black
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        // The Sun
        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
        this.sunLight.position.set(50, 100, 50); // Default, can be changed via GUI
        this.sunLight.castShadow = true;

        // SHADOW TUNING FOR 2.5D
        // Since we have a deep view (2000m), we need a large shadow map
        this.sunLight.shadow.mapSize.width = 4096;
        this.sunLight.shadow.mapSize.height = 4096;
        
        // The shadow camera frustum needs to cover objects up to 300m
        // We assume objects are between Z=0 and Z=300
        const d = 150; // Covers 300m total (150m each direction)
        this.sunLight.shadow.camera.left = -d;
        this.sunLight.shadow.camera.right = d;
        this.sunLight.shadow.camera.top = d;
        this.sunLight.shadow.camera.bottom = -d;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 300;
        this.sunLight.shadow.bias = -0.0005;

        this.scene.add(this.sunLight);
    }

    private setupEnvironment() {
        // 1. Shadow Floor (Stays exactly the same)
        const floorGeo = new THREE.PlaneGeometry(2000, 2000); 
        floorGeo.rotateX(-Math.PI / 2);
        const floorMat = new THREE.ShadowMaterial({ opacity: 0.3, color: 0x000000 });
        this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
        this.floorMesh.position.y = 0;
        this.floorMesh.receiveShadow = true;
        this.scene.add(this.floorMesh);

        // 2. Background Image
        const loader = new THREE.TextureLoader();
        loader.load(
            this.config.backgroundUrl,
            (texture) => {
            if (this.disposed) {
                texture.dispose();
                return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            
            // --- THE CRITICAL MATH (CYLINDRICAL GEOMETRY) ---
            
            const ratio = this.config.horizonRatio;
            const dist = this.config.backgroundDistance;
            const vFOV = THREE.MathUtils.degToRad(this.camera.fov);

            // 1. Calculate Heights (Same as before)
            const visibleFrustumHeight = 2 * dist * Math.tan(vFOV / 2);
            const planeHeight = visibleFrustumHeight / (2 * ratio);
            
            // 2. Calculate Width / Arc Length
            const bgAspectRatio = 21 / 9;
            const arcLength = planeHeight * bgAspectRatio;

            // 3. CURVED GEOMETRY LOGIC
            // Calculate how many radians this image covers at this distance
            const thetaLength = arcLength / dist;
            
            // We start the segment centered (Start angle = -Theta/2)
            const thetaStart = -thetaLength / 2; // Centered back

            // Create Cylinder: radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded, thetaStart, thetaLength
            // We use 'dist' as the radius.
            const geometry = new THREE.CylinderGeometry(
                dist, dist, planeHeight, 
                64, 1, 
                true, // Open ended (no top/bottom caps)
                thetaStart, // Start angle (centered back)
                thetaLength       // Total angle width
            );

            // 4. Invert it to see the inside
            geometry.scale(-1, 1, 1); 

            const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
            this.bgPlane = new THREE.Mesh(geometry, material);

            // 5. Position
            // Z is 0 because the cylinder radius *is* the distance. 
            // The mesh origin is the center of the cylinder.
            this.bgPlane.position.z = 0; 
            
            // Horizon Align (Same math applies to Y)
            this.bgPlane.position.y = this.config.humanHeight + (0.5 - ratio) * planeHeight;

            // Rotate to face camera correctly (180 deg)
            this.bgPlane.rotation.y = Math.PI;

            this.scene.add(this.bgPlane);

            // 6. Limits
            this.calculateWalkLimits(arcLength, dist);
        },
            undefined,
            (err) => {
                const error = new Error(`Failed to load background image: ${err}`);
                this.config.onBackgroundLoadError?.(error);
                console.warn(error.message);
            }
        );
    }

    /**
     * Calculate walk limits accounting for head turn buffer (cylindrical geometry).
     * Reserves space for head turning to prevent void visibility.
     * @param arcLength Arc length of the background cylinder segment
     * @param radius Radius of the cylinder (backgroundDistance)
     */
    private calculateWalkLimits(arcLength: number, radius: number): void {
        // 1. Total available angle of the image on the cylinder
        const totalImageAngle = arcLength / radius;
        const availableHalfAngle = totalImageAngle / 2;

        // 2. Angle required by Camera FOV + Head Turn
        // We assume Aspect Ratio 1:1, so Horizontal FOV = Vertical FOV
        const halfFovRad = THREE.MathUtils.degToRad(this.camera.fov / 2);
        const headTurnRad = THREE.MathUtils.degToRad(this.maxHeadYaw);
        
        // SAFETY BUFFER: Add 5 degrees to cover render/geometry inaccuracies
        const safetyBuffer = THREE.MathUtils.degToRad(5);
        
        const requiredHalfAngle = halfFovRad + headTurnRad + safetyBuffer;

        // 3. Slack Angle (The Rotation Budget)
        // If this is < 0, your image is too narrow for 30 degree head turns
        const slackAngle = Math.max(0, availableHalfAngle - requiredHalfAngle);

        // 4. Convert Slack Angle to Physical Meters (Arc Length)
        const physicalSlackMeters = slackAngle * radius;

        // 5. Apply Parallax Ratio to get Max Viewer X
        const virtDist = this.config.virtualDistance;
        const distanceRatio = virtDist / radius;

        this.maxViewerX = physicalSlackMeters * distanceRatio;
        this.parallaxFactor = 1 - (radius / virtDist);

        console.log(`Max Walk Range: +/- ${this.maxViewerX.toFixed(2)}m`);
    }

    /**
     * Add a Voxel Object to the scene.
     * @param object3D The Mesh Group
     * @param perceivedXOffset Lateral position in meters (Left is negative, Right is positive)
     * @param perceivedDepth Distance FROM viewer in meters (Positive value = meters away)
     * @param perceivedVerticalElevation Optional vertical offset (0 is ground)
     */
    public placeObject(object3D: THREE.Object3D, perceivedXOffset: number, perceivedDepth: number, perceivedVerticalElevation: number = 0) {
        // Convert "Depth from view" to ThreeJS Z coordinate
        // View is at 0, looking at -Z.
        // So 50m depth = Z: -50
        object3D.position.set(perceivedXOffset, perceivedVerticalElevation, -perceivedDepth);
        this.scene.add(object3D);
    }

    /**
     * Remove a specific object from the scene.
     * @param object3D The object to remove
     */
    public removeObject(object3D: THREE.Object3D): void {
        this.scene.remove(object3D);
        this.disposeObject3D(object3D);
    }

    /**
     * Clear all placed objects from the scene (keeps background and floor).
     * @param objects Array of objects to remove
     */
    public clearObjects(objects: THREE.Object3D[]): void {
        objects.forEach((obj) => {
            this.scene.remove(obj);
            this.disposeObject3D(obj);
        });
    }

    private disposeBackground(): void {
        if (!this.bgPlane) return;
        this.scene.remove(this.bgPlane);
        this.bgPlane.geometry.dispose();
        const material = this.bgPlane.material as THREE.MeshBasicMaterial;
        if (material.map) material.map.dispose();
        material.dispose();
        this.bgPlane = null;
    }

    private disposeObject3D(object: THREE.Object3D): void {
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            if (!geometries.has(child.geometry)) {
                geometries.add(child.geometry);
                child.geometry.dispose();
            }
            const mats = Array.isArray(child.material)
                ? child.material
                : [child.material];
            mats.forEach((m) => {
                if (!materials.has(m)) {
                    materials.add(m);
                    m.dispose();
                }
            });
        });
    }

    public isDisposed(): boolean {
        return this.disposed;
    }

    /**
     * Resize the square viewport (e.g. from ResizeObserver).
     */
    public setViewWindowSize(px: number): void {
        if (this.disposed) return;
        const size = Math.max(1, Math.floor(px));
        this.config.viewWindowSize = size;
        this.renderer.setSize(size, size);
        this.camera.updateProjectionMatrix();
    }

    /**
     * Tear down WebGL resources and stop the render loop (for React unmount).
     */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;

        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        this.disposeBackground();

        if (this.floorMesh) {
            this.scene.remove(this.floorMesh);
            this.floorMesh.geometry.dispose();
            (this.floorMesh.material as THREE.Material).dispose();
            this.floorMesh = null;
        }

        const toRemove = [...this.scene.children].filter(
            (c) => !(c instanceof THREE.Light)
        );
        toRemove.forEach((obj) => {
            this.scene.remove(obj);
            this.disposeObject3D(obj);
        });

        this.renderer.dispose();
        if (this.renderer.domElement.parentNode === this.container) {
            this.container.removeChild(this.renderer.domElement);
        }
    }

    /**
     * Get the maximum viewer X position (walking limit).
     * Returns 0 if background hasn't loaded yet.
     */
    public getMaxViewerX(): number {
        return this.maxViewerX;
    }

    /**
     * Calculates the Max X position for a given depth.
     * Uses Pythagorean theorem to prevent objects from clipping through cylinder walls.
     * @param depthZ The depth into the screen (meters)
     * @param objectWidthRadius A safety buffer for the object's own width (e.g. 1 or 2 meters)
     * @returns Maximum lateral distance from center (positive value, use +/- for range)
     */
    public getMaxLateralRange(depthZ: number, objectWidthRadius: number = 2): number {
        if (depthZ < 0) return 0;
        const R = this.config.backgroundDistance;

        // Safety: If depth is deeper than the wall, range is 0.
        if (depthZ >= R - objectWidthRadius) return 0;

        // Math: X = sqrt(R^2 - Z^2)
        const geometricMax = Math.sqrt((R * R) - (depthZ * depthZ));

        // Subtract the object's own size so it doesn't clip half-way
        return geometricMax - objectWidthRadius;
    }

    /**
     * Calculates the Total World X Range (Walk Limit + Cylinder Width).
     * This allows placing objects relative to the furthest point the player can reach.
     * @param depthZ The depth of the object (meters)
     * @param buffer Safety buffer for object size (default: 2.0 meters)
     * @returns Maximum world X position (positive value, use +/- for range)
     */
    public getWorldPlacementLimit(depthZ: number, buffer: number = 2.0): number {
        if (depthZ < 0) return this.getMaxViewerX();
        const R = this.config.backgroundDistance;

        // 1. Calculate Local Cylinder Width (The Slice)
        // If depth is deeper than wall, width is 0.
        if (depthZ >= R - buffer) return this.getMaxViewerX(); // Return at least walk limit
        
        const localSliceWidth = Math.sqrt((R * R) - (depthZ * depthZ));
        const safeLocalWidth = Math.max(0, localSliceWidth - buffer);

        // 2. Add the Walking Range
        // This allows placing objects relative to the FURTHEST point the player can reach.
        return this.getMaxViewerX() + safeLocalWidth;
    }

    /**
     * Get the renderer DOM element for attaching event listeners.
     */
    public getRendererElement(): HTMLElement | null {
        return this.renderer.domElement;
    }

    /**
     * Get current head look angles.
     * @returns Object with yaw and pitch in degrees
     */
    public getHeadLook(): { yaw: number; pitch: number } {
        return { yaw: this.currentYaw, pitch: this.currentPitch };
    }

    /**
     * Calculate dynamic head turn limits based on current viewer position.
     * When viewer walks right, they can turn less left (and vice versa).
     * @returns Maximum safe yaw angle in degrees
     */
    private calculateDynamicMaxYaw(): number {
        if (!this.bgPlane) return this.maxHeadYaw; // Fallback if background not loaded
        
        const radius = this.config.backgroundDistance;
        const viewerX = this.camera.position.x;
        
        // Convert viewer X position to angle offset
        // When viewer moves right, they're effectively rotating the world left
        const viewerAngleOffset = Math.abs(viewerX / radius);
        
        // Calculate dynamic limit: reduce available yaw based on viewer position
        // The parallax factor accounts for how much the background moves
        const effectiveMaxYaw = this.maxHeadYaw - (viewerAngleOffset / this.parallaxFactor);
        
        // Ensure we don't go negative (minimum 5 degrees)
        return Math.max(5, effectiveMaxYaw);
    }

    /**
     * Turns the head (camera rotation).
     * @param yawDeg Horizontal turn (degrees)
     * @param pitchDeg Vertical turn (degrees). POSITIVE ONLY (no downward tilt).
     */
    public setHeadLook(yawDeg: number, pitchDeg: number): void {
        // Calculate dynamic max yaw based on viewer position
        const dynamicMaxYaw = this.calculateDynamicMaxYaw();
        
        // 1. Calculate clamped values (safe limits)
        const clampedYaw = Math.max(-dynamicMaxYaw, Math.min(dynamicMaxYaw, yawDeg));
        const clampedPitch = Math.max(0, Math.min(this.maxHeadPitch, pitchDeg));

        // 2. Check if input exceeds limits (for bounce-back)
        const exceedsYawLimit = Math.abs(yawDeg) > dynamicMaxYaw + 0.1;
        const exceedsPitchLimit = pitchDeg < -0.1 || pitchDeg > this.maxHeadPitch + 0.1;
        
        if (exceedsYawLimit || exceedsPitchLimit) {
            // Set bounce-back target to clamped safe values
            this.targetYaw = clampedYaw;
            this.targetPitch = clampedPitch;
            this.isBouncingBack = true;
        } else {
            // Normal operation - apply immediately
            this.currentYaw = clampedYaw;
            this.currentPitch = clampedPitch;
            this.targetYaw = clampedYaw;
            this.targetPitch = clampedPitch;
            this.isBouncingBack = false;
            
            // Apply Rotation (YXZ order)
            this.camera.rotation.set(
                THREE.MathUtils.degToRad(this.currentPitch), // X axis (Pitch)
                THREE.MathUtils.degToRad(this.currentYaw),   // Y axis (Yaw)
                0,                               // Z axis (Roll)
                'YXZ'
            );
        }
    }

    /**
     * Move the viewer left/right. 
     * Handles clamping to prevent seeing past background edges.
     * Implements parallax scrolling: background moves with camera but slower.
     */
    public setViewerPosition(xInMeters: number) {
        if (!this.bgPlane) return; // Not loaded yet
        
        // 1. Clamp Input (Prevent running out of texture)
        const clampedX = Math.max(-this.maxViewerX, Math.min(this.maxViewerX, xInMeters));
        
        // 2. Move Camera (Linear Movement)
        this.camera.position.x = clampedX;

        // 3. Move Cylinder Body (Lock to Camera - "Hamster Wheel" Technique)
        // This ensures the camera is ALWAYS in the center of the cylinder.
        // You can never walk "out" of it.
        this.bgPlane.position.x = clampedX;

        // 4. Rotate Cylinder (Simulate Parallax)
        // We calculate the rotation based on the VIRTUAL distance.
        // Logic: If Virtual Dist is Huge (Infinity), x / Infinity = 0 rotation (Skybox).
        // Logic: If Virtual Dist is Small, we rotate fast.
        const rotationAngle = clampedX / this.config.virtualDistance;

        // Apply Rotation
        // Math.PI is the starting offset to face the camera.
        // We subtract rotation to simulate the background passing by.
        this.bgPlane.rotation.y = Math.PI - rotationAngle;
    }

    public setSunPosition(azimuthDeg: number, elevationDeg: number) {
        const r = 200;
        const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
        const theta = THREE.MathUtils.degToRad(azimuthDeg);

        this.sunLight.position.set(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.cos(phi),
            r * Math.sin(phi) * Math.sin(theta)
        );
    }

    /**
     * Change the background image and rebuild the background plane.
     * @param imageUrl The URL of the new background image
     */
    public async setBackgroundImage(imageUrl: string): Promise<void> {
        return new Promise((resolve, reject) => {
            // Remove old background plane if it exists
            if (this.bgPlane) {
                this.disposeBackground();
            }

            // Load new texture
            const loader = new THREE.TextureLoader();
            loader.load(
                imageUrl,
                (texture) => {
                    if (this.disposed) {
                        texture.dispose();
                        return;
                    }
                    texture.colorSpace = THREE.SRGBColorSpace;
                    
                    // Calculate cylinder dimensions using current horizonRatio
                    const ratio = this.config.horizonRatio;
                    const dist = this.config.backgroundDistance;
                    const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
                    
                    // 1. Calculate Heights
                    const visibleFrustumHeight = 2 * dist * Math.tan(vFOV / 2);
                    const planeHeight = visibleFrustumHeight / (2 * ratio);
                    
                    // 2. Calculate Arc Length
                    const bgAspectRatio = 21 / 9;
                    const arcLength = planeHeight * bgAspectRatio;

                    // 3. CURVED GEOMETRY LOGIC
                    const thetaLength = arcLength / dist;
                    const thetaStart = -thetaLength / 2;

                    // Create Cylinder
                    const geometry = new THREE.CylinderGeometry(
                        dist, dist, planeHeight, 
                        64, 1, 
                        true, // Open ended
                        thetaStart,
                        thetaLength
                    );

                    // Invert to see inside
                    geometry.scale(-1, 1, 1);

                    const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
                    this.bgPlane = new THREE.Mesh(geometry, material);

                    // Position
                    this.bgPlane.position.z = 0;
                    this.bgPlane.position.y = this.config.humanHeight + (0.5 - ratio) * planeHeight;
                    this.bgPlane.rotation.y = Math.PI;
                    
                    this.scene.add(this.bgPlane);

                    // Recalculate parallax factor and walk limits accounting for head turn buffer
                    this.calculateWalkLimits(arcLength, dist);
                    
                    resolve();
                },
                undefined,
                (error) => {
                    reject(new Error(`Failed to load background image: ${error}`));
                }
            );
        });
    }

    /**
     * Update the horizon ratio and rebuild the background plane.
     * @param horizonRatio The new horizon ratio (0.0 to 0.5)
     */
    public setHorizonRatio(horizonRatio: number) {
        if (!this.bgPlane) return; // Background not loaded yet
        
        // Update config
        this.config.horizonRatio = horizonRatio;
        
        // Get the texture from the existing material
        const material = this.bgPlane.material as THREE.MeshBasicMaterial;
        const texture = material.map;
        if (!texture) return;
        
        // Remove old plane from scene
        this.scene.remove(this.bgPlane);
        
        // Dispose old geometry
        if (this.bgPlane.geometry) {
            this.bgPlane.geometry.dispose();
        }
        
        // Recalculate cylinder dimensions
        const ratio = this.config.horizonRatio;
        const dist = this.config.backgroundDistance;
        const vFOV = THREE.MathUtils.degToRad(this.camera.fov);
        
        // 1. Calculate Heights
        const visibleFrustumHeight = 2 * dist * Math.tan(vFOV / 2);
        const planeHeight = visibleFrustumHeight / (2 * ratio);
        
        // 2. Calculate Arc Length
        const bgAspectRatio = 21 / 9;
        const arcLength = planeHeight * bgAspectRatio;

        // 3. CURVED GEOMETRY LOGIC
        const thetaLength = arcLength / dist;
        const thetaStart = -thetaLength / 2;
        
        // Create new geometry
        const geometry = new THREE.CylinderGeometry(
            dist, dist, planeHeight, 
            64, 1, 
            true, // Open ended
            thetaStart,
            thetaLength
        );

        // Invert to see inside
        geometry.scale(-1, 1, 1);
        
        this.bgPlane = new THREE.Mesh(geometry, material);
        
        // Position
        this.bgPlane.position.z = 0;
        this.bgPlane.position.y = this.config.humanHeight + (0.5 - ratio) * planeHeight;
        this.bgPlane.rotation.y = Math.PI;
        
        // Add to scene
        this.scene.add(this.bgPlane);
        
        // Recalculate parallax factor and walk limits accounting for head turn buffer
        this.calculateWalkLimits(arcLength, dist);
    }

    private animate = () => {
        if (this.disposed) return;
        this.animationFrameId = requestAnimationFrame(this.animate);

        // Handle bounce-back interpolation if needed
        if (this.isBouncingBack) {
            const lerpFactor = 0.2; // Smooth but responsive
            
            // Interpolate toward target
            this.currentYaw = THREE.MathUtils.lerp(this.currentYaw, this.targetYaw, lerpFactor);
            this.currentPitch = THREE.MathUtils.lerp(this.currentPitch, this.targetPitch, lerpFactor);
            
            // Check if we're close enough to target (stop bouncing)
            const yawDiff = Math.abs(this.currentYaw - this.targetYaw);
            const pitchDiff = Math.abs(this.currentPitch - this.targetPitch);
            
            if (yawDiff < 0.1 && pitchDiff < 0.1) {
                this.currentYaw = this.targetYaw;
                this.currentPitch = this.targetPitch;
                this.isBouncingBack = false;
            }
            
            // Apply interpolated rotation
            this.camera.rotation.set(
                THREE.MathUtils.degToRad(this.currentPitch), // X axis (Pitch)
                THREE.MathUtils.degToRad(this.currentYaw),   // Y axis (Yaw)
                0,                               // Z axis (Roll)
                'YXZ'
            );
        }
        
        // Also check if current head look exceeds dynamic limits (safety check)
        if (!this.isBouncingBack && this.bgPlane) {
            const dynamicMaxYaw = this.calculateDynamicMaxYaw();
            if (Math.abs(this.currentYaw) > dynamicMaxYaw + 0.1) {
                // Trigger bounce-back
                this.targetYaw = Math.sign(this.currentYaw) * dynamicMaxYaw;
                this.targetPitch = this.currentPitch;
                this.isBouncingBack = true;
            }
        }

        if (this.disposed) return;
        this.renderer.render(this.scene, this.camera);
    }
}
