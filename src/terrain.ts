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
import { createNoiseTexture, createNormalTexture } from './textures.js';

export class TerrainManager {
  scene: THREE.Scene;
  chunkSize: number = 200;
  chunks: Map<string, THREE.Mesh> = new Map();
  chunkColliders: Map<string, { body: RAPIER.RigidBody, collider: RAPIER.Collider }> = new Map();
  material: THREE.Material;
  isWebGPU: boolean = false;
  rendererCapsSet: boolean = false;
  maxAnisotropy: number = 4;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    const texSize = 256;
    const roughnessMap = createNoiseTexture(texSize, 20, 3);
    const normalMap = createNormalTexture(texSize, 20, 8.0);
    const aoMap = createNoiseTexture(texSize, 10, 2);

    this.material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.85,
      roughnessMap: roughnessMap,
      metalness: 0.05,
      normalMap: normalMap,
      normalScale: new THREE.Vector2(1.5, 1.5),
      aoMap: aoMap,
      aoMapIntensity: 0.8,
      envMapIntensity: 1.0
    });
  }

  detectRenderer() {
    if (this.rendererCapsSet) return;
    this.rendererCapsSet = true;
    try {
       const canvas = document.querySelector('canvas');
       if (canvas) {
           this.isWebGPU = !!(window as any).__isWebGPU;
       }
    } catch(e) {}
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

      const worldX = position.getX(i) + worldOffsetX;
      const worldZ = pz + worldOffsetZ;

      position.setY(i, getGlobalTerrainHeight(worldX, worldZ));
    }

    geometry.computeVertexNormals();

    const colors = [];
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i);
      const pz = position.getZ(i);
      const y = position.getY(i);

      const worldX = px + worldOffsetX;
      const worldZ = pz + worldOffsetZ;

      normal.fromBufferAttribute(geometry.attributes.normal as THREE.BufferAttribute, i);
      const slope = 1.0 - normal.dot(up);

      // Biome blending based on the bible §2.2-§2.5
      let biome = 'cloud_forest'; // default
      if (worldZ > 300) biome = 'high_sierra';
      else if (worldZ < -400 && worldX < 600) biome = 'jungle_lowlands';
      else if (worldX > 600) biome = 'paititi';

      // Cloud forest damp greens
      const cf_humus = new THREE.Color(0x3B2E22);
      const cf_wetStone = new THREE.Color(0x5A5A58);

      // Sierra gold-grass + exposed rock
      const hs_ichuGrass = new THREE.Color(0x9A8B4F);
      const hs_granite = new THREE.Color(0x6E6A63);

      // Jungle dark humus
      const jl_mud = new THREE.Color(0x4A3826);
      const jl_swallowedLimestone = new THREE.Color(0xB8B0A0);

      // Paititi worked-stone plazas / encroaching green
      const pa_plazaStone = new THREE.Color(0x9A917E);
      const pa_encroachingGreen = new THREE.Color(0x2E5A2E);

      if (slope > 0.4) {
        // Rock on steeps
        if (biome === 'high_sierra') {
            color.copy(hs_granite);
        } else if (biome === 'jungle_lowlands') {
            color.copy(jl_swallowedLimestone);
        } else if (biome === 'paititi') {
            color.copy(pa_plazaStone).lerp(new THREE.Color(0xA89E86), Math.random() * 0.5);
        } else {
            color.copy(cf_wetStone);
        }
      } else {
        // Soil/grass on flats
        if (biome === 'high_sierra') {
            color.copy(hs_ichuGrass).lerp(new THREE.Color(0x6B6335), Math.random() * 0.5);
        } else if (biome === 'jungle_lowlands') {
            color.copy(jl_mud);
        } else if (biome === 'paititi') {
            color.copy(pa_encroachingGreen).lerp(pa_plazaStone, Math.random() * 0.3);
        } else {
            color.copy(cf_humus).lerp(new THREE.Color(0x3E5E2A), Math.random() * 0.5);
        }
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
