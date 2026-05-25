import * as THREE from 'three';
import type { Voxel } from './types.js';

/**
 * Creates a mesh group from voxel data.
 * @param voxels Array of voxel definitions
 * @param heightInMeters Desired height of the object in meters (object will be scaled to match this height)
 */
export function createVoxelMesh(voxels: Voxel[], heightInMeters: number): THREE.Group {
    const group = new THREE.Group();
    if (voxels.length === 0) {
        return group;
    }

    const BASE_SCALE = 1.0;
    const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 });

    voxels.forEach((v) => {
        const geometry = new THREE.BoxGeometry(BASE_SCALE, BASE_SCALE, BASE_SCALE);
        const mesh = new THREE.Mesh(geometry, material.clone());
        (mesh.material as THREE.MeshStandardMaterial).color.set(v.c);

        mesh.position.set(
            v.x * BASE_SCALE,
            v.y * BASE_SCALE,
            v.z * BASE_SCALE
        );

        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    });

    const box = new THREE.Box3().setFromObject(group);
    const center = box.getCenter(new THREE.Vector3());
    const min = box.min;

    group.children.forEach((child) => {
        child.position.x -= center.x;
        child.position.y -= min.y;
        child.position.z -= center.z;
    });

    const finalBox = new THREE.Box3().setFromObject(group);
    const boundingHeight = finalBox.max.y - finalBox.min.y;

    if (boundingHeight > 0) {
        const scaleFactor = heightInMeters / boundingHeight;
        group.scale.setScalar(scaleFactor);
    }

    return group;
}
