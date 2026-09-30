import * as THREE from 'three';

export function getGlobalTerrainHeight(x: number, z: number): number {
  const size = 1000;

  // Base valley shape
  let valleyShape = Math.pow(Math.abs(x / (size / 2)), 2) * 100;

  // Basic noise
  let noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5 +
              Math.sin(x * 0.01 + z * 0.02) * 15;

  const riverBed = -Math.exp(-Math.pow(x / 30, 2)) * 10;

  // High-sierra modifier: as z increases past 500, terrain rises and becomes craggier
  if (z > 500) {
    const factor = Math.min(1.0, (z - 500) / 500); // 0 at 500, 1 at 1000+
    const highSierraRise = factor * 100;
    const highSierraNoise = (Math.sin(x * 0.1) * Math.cos(z * 0.1) * 10 +
                             Math.sin(x * 0.05 + z * 0.05) * 20) * factor;
    valleyShape += highSierraRise;
    noise += highSierraNoise;
  }

  return valleyShape + noise + riverBed;
}

import { physics } from './physics.js';
import RAPIER from '@dimforge/rapier3d-compat';

export class TerrainManager {
  scene: THREE.Scene;
  chunkSize: number = 200;
  chunks: Map<string, THREE.Mesh> = new Map();
  chunkColliders: Map<string, { body: RAPIER.RigidBody, collider: RAPIER.Collider }> = new Map();
  material: THREE.Material;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      envMapIntensity: 1.0
    });
  }

  getChunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  update(cameraPosition: THREE.Vector3) {
    const viewDistance = 4; // chunk radius
    const cx = Math.floor(cameraPosition.x / this.chunkSize);
    const cz = Math.floor(cameraPosition.z / this.chunkSize);

    const activeKeys = new Set<string>();

    for (let x = -viewDistance; x <= viewDistance; x++) {
      for (let z = -viewDistance; z <= viewDistance; z++) {
        const chunkX = cx + x;
        const chunkZ = cz + z;

        // Simple culling for far corners
        if (Math.sqrt(x*x + z*z) > viewDistance) continue;

        const key = this.getChunkKey(chunkX, chunkZ);
        activeKeys.add(key);

        const dist = Math.max(Math.abs(x), Math.abs(z));
        let segments = 64; // LOD 0 (near)
        if (dist > 2) segments = 16; // LOD 1 (mid)
        if (dist > 3) segments = 4; // LOD 2 (far)

        if (!this.chunks.has(key)) {
          this.loadChunk(chunkX, chunkZ, segments);
        } else {
          // If we want to dynamically update LOD, we'd do it here.
          // For now we'll just stick with what we loaded to keep it simple, or recreate it.
          const existingChunk = this.chunks.get(key);
          const currentSegments = (existingChunk?.geometry as THREE.PlaneGeometry).parameters?.widthSegments;
          if (existingChunk && currentSegments !== segments) {
             this.unloadChunk(key);
             this.loadChunk(chunkX, chunkZ, segments);
          }
        }
      }
    }

    // Unload chunks out of range
    for (const key of this.chunks.keys()) {
      if (!activeKeys.has(key)) {
        this.unloadChunk(key);
      }
    }
  }

  loadChunk(cx: number, cz: number, segments: number) {
    const geometry = new THREE.PlaneGeometry(this.chunkSize, this.chunkSize, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    // Calculate positions
    const position = geometry.attributes.position;
    const worldOffsetX = cx * this.chunkSize;
    const worldOffsetZ = cz * this.chunkSize;

    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i);
      const pz = position.getZ(i);

      const worldX = px + worldOffsetX;
      const worldZ = pz + worldOffsetZ;

      position.setY(i, getGlobalTerrainHeight(worldX, worldZ));
    }

    geometry.computeVertexNormals();

    const colors = [];
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
      const pz = position.getZ(i);
      const y = position.getY(i);

      const worldZ = pz + worldOffsetZ;

      normal.fromBufferAttribute(geometry.attributes.normal as THREE.BufferAttribute, i);
      const slope = 1.0 - normal.dot(up);

      // Biome blending
      const isHighSierra = worldZ > 500 || y > 50;
      const sierraBlend = Math.max(0, Math.min(1, (worldZ - 400) / 200 + Math.max(0, y - 40) / 20));

      if (slope > 0.4) {
        // Rock/Scree
        const baseRock = new THREE.Color(0x404040).lerp(new THREE.Color(0x2a2a2a), Math.random());
        const cragRock = new THREE.Color(0x6b6660).lerp(new THREE.Color(0x4f4a45), Math.random());
        color.copy(baseRock).lerp(cragRock, sierraBlend);
      } else if (isHighSierra && y > 150) {
        // Snow peaks
        color.setHex(0xffffff).lerp(new THREE.Color(0xe0e6ed), Math.random());
      } else if (y < 3 && worldZ < 500) {
        // River edge mud
        color.setHex(0x382a1d).lerp(new THREE.Color(0x281e14), Math.random());
      } else {
        // Ground cover
        const greenery = new THREE.Color(0x294218).lerp(new THREE.Color(0x3e5e26), Math.random());
        const ichuGrass = new THREE.Color(0x8a7f45).lerp(new THREE.Color(0x6b6335), Math.random()); // Yellowish tough grass
        color.copy(greenery).lerp(ichuGrass, sierraBlend);
      }

      colors.push(color.r, color.g, color.b);
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const chunk = new THREE.Mesh(geometry, this.material);
    chunk.position.set(worldOffsetX, 0, worldOffsetZ);
    chunk.receiveShadow = true;
    chunk.castShadow = true;

    this.scene.add(chunk);
    const key = this.getChunkKey(cx, cz);
    this.chunks.set(key, chunk);

    const colliderData = physics.createTerrainCollider(chunk);
    if (colliderData) {
      this.chunkColliders.set(key, colliderData);
    }
  }

  unloadChunk(key: string) {
    const chunk = this.chunks.get(key);
    if (chunk) {
      this.scene.remove(chunk);
      chunk.geometry.dispose();
      this.chunks.delete(key);

      const colliderData = this.chunkColliders.get(key);
      if (colliderData) {
        physics.removeTerrainCollider(colliderData);
        this.chunkColliders.delete(key);
      }
    }
  }
}

export function createTerrain(scene: THREE.Scene) {
  const terrainManager = new TerrainManager(scene);
  // Initial load around center
  terrainManager.update(new THREE.Vector3(0,0,0));
  return terrainManager;
}
