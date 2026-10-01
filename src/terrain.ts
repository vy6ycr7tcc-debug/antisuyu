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
import { createNormalTexture, createTerrainDetailTexture, createTerrainRoughnessTexture } from './textures.js';
import type { RenderCaps } from './renderer.js';

// Deterministic per-world-position hash (p3-2). Replaces the previous
// Math.random() vertex jitter, which re-rolled every chunk color on each
// LOD swap — terrain visibly shimmered when the LOD ring moved.
function hash2(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 127.1 + z * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smoothstepf(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class TerrainManager {
  scene: THREE.Scene;
  chunkSize: number = 200;
  chunks: Map<string, THREE.Mesh> = new Map();
  chunkColliders: Map<string, { body: RAPIER.RigidBody, collider: RAPIER.Collider }> = new Map();
  material: THREE.Material;
  isWebGPU: boolean = false;
  maxAnisotropy: number = 4;
  lowTier: boolean = false;

  constructor(scene: THREE.Scene, caps?: RenderCaps) {
    this.scene = scene;
    // §7.2: visual modules take RenderCaps, never re-detect. The old
    // detectRenderer()/__isWebGPU probe is gone.
    this.isWebGPU = caps?.isWebGPU ?? false;
    this.maxAnisotropy = caps?.maxAnisotropy ?? 4;
    this.lowTier = caps?.tier === 'LOW';

    // §6.3 texture budget: terrain detail ≤ 256². Per-map repeats turn each
    // 256² tile into the right world scale on a 200 m chunk (uv spans 0..1
    // per chunk): albedo flecks ~20 m tile, normal ridges ~20 m, roughness
    // blotches ~40 m (the sanctioned wet-specular mechanism: noise
    // roughnessMap), AO macro variation ~100 m. All maps are strictly
    // low-frequency — the generic fbm generators decorrelate neighboring
    // texels and read as per-texel static at terrain tiling (p3-5 probe).
    const texSize = 256;
    const detailMap = createTerrainDetailTexture(texSize);
    detailMap.colorSpace = THREE.SRGBColorSpace;
    detailMap.repeat.set(10, 10);

    const roughnessMap = createTerrainRoughnessTexture(texSize);
    roughnessMap.repeat.set(5, 5);

    const normalMap = createNormalTexture(texSize, 7, 3.0);
    normalMap.repeat.set(10, 10);

    // AO as macro blotches on the same low-freq generator (0.72–0.98 ×
    // intensity 0.8 = subtle broad darkening). PlaneGeometry has no uv1;
    // without channel=0 the aoMap samples a missing attribute (uniform
    // texel) — the previous aoMap was effectively inert.
    const aoMap = createTerrainRoughnessTexture(texSize);
    aoMap.repeat.set(2, 2);
    aoMap.channel = 0;

    for (const t of [detailMap, roughnessMap, normalMap, aoMap]) {
      t.anisotropy = this.maxAnisotropy; // T8: 8 WebGPU / 4 WebGL2
    }

    this.material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      map: detailMap,
      // §4.1 weathered stone band × map 0.72–0.98 → composite ~0.66–0.90:
      // dry ground matte, wet blotches glint without mirror whiteout.
      roughness: 0.92,
      roughnessMap: roughnessMap,
      metalness: 0.05,
      normalMap: normalMap,
      // §4.1 normal intensity 2.0–8.0 by scale — generator 3.0 ×
      // material 1.8; terrain relief must read without per-texel sparkle.
      normalScale: new THREE.Vector2(1.8, 1.8),
      aoMap: aoMap,
      aoMapIntensity: 0.8,       // §4.1 0.6–1.0
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
        // §6.3: far-chunk segment density 16→4 on LOW.
        if (dist > 2) segments = this.lowTier ? 4 : 16; // LOD 1 (mid)
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

    // Biome color script (§2.2–§2.5). All palettes hoisted — the previous
    // code allocated 6+ Colors per vertex. Weights blend smoothly across
    // 60 m transition bands instead of the old hard biome switches, which
    // drew visible color seams across the terrain.
    const CF = {
      rock: new THREE.Color(0x5A5A58),   // wet stone
      soilA: new THREE.Color(0x3B2E22),  // humus/earth
      soilB: new THREE.Color(0x3E5E2A)   // canopy green tint
    };
    const HS = {
      rock: new THREE.Color(0x6E6A63),   // granite
      lichen: new THREE.Color(0x7A8A5A), // lichen patches (§2.3 dressing vocab)
      soilA: new THREE.Color(0x9A8B4F),  // ichu grass lit
      soilB: new THREE.Color(0x6B6335),  // ichu shadowed
      snow: new THREE.Color(0xF2F5F7),   // snowfields (roughness handled by material)
      snowShadow: new THREE.Color(0xC9D6E2) // never pure grey in shadow
    };
    const JL = {
      rock: new THREE.Color(0xB8B0A0),   // swallowed limestone
      moss: new THREE.Color(0x5A7247),   // heavy moss reclamation
      soil: new THREE.Color(0x4A3826)    // mud
    };
    const PA = {
      rockA: new THREE.Color(0x9A917E),  // plaza stone
      rockB: new THREE.Color(0xA89E86),  // ashlar shadow
      soil: new THREE.Color(0x2E5A2E)    // encroaching green
    };
    const WET = new THREE.Color(0x2E2A24); // riverbank darkening target
    const color = new THREE.Color();
    const tmpA = new THREE.Color();
    const tmpB = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    const normal = new THREE.Vector3();
    const colors: number[] = [];

    for (let i = 0; i < position.count; i++) {
      const px = position.getX(i);
      const pz = position.getZ(i);
      const y = position.getY(i);

      const worldX = px + worldOffsetX;
      const worldZ = pz + worldOffsetZ;

      normal.fromBufferAttribute(geometry.attributes.normal as THREE.BufferAttribute, i);
      const slope = 1.0 - normal.dot(up);
      const r1 = hash2(worldX, worldZ);
      const r2 = hash2(worldX, worldZ, 1);

      // Biome weights — smooth 60 m transition bands at the §0 region
      // boundaries (z 300 cloud→sierra, z −400 cloud→jungle, x 600 →paititi;
      // paititi keeps precedence over sierra in the NE corner).
      const wPa = smoothstepf(570, 630, worldX);
      const wHs = smoothstepf(280, 340, worldZ) * (1 - wPa);
      const wJl = (1 - smoothstepf(-430, -370, worldZ)) * (1 - wPa) * (1 - wHs);
      const wCf = Math.max(0, 1 - wPa - wHs - wJl);

      // Soft soil→rock split (the old binary slope > 0.4 switch).
      const rockW = smoothstepf(0.30, 0.50, slope);

      // Per-biome soil/rock colors, then blend the four biomes.
      tmpA.copy(CF.soilA).lerp(CF.soilB, r1 * 0.5);
      tmpB.copy(CF.rock);
      color.copy(tmpA).lerp(tmpB, rockW);

      if (wHs > 0) {
        tmpA.copy(HS.soilA).lerp(HS.soilB, r1 * 0.5);
        tmpB.copy(HS.rock);
        if (r2 > 0.86) tmpB.lerp(HS.lichen, Math.min(1, (r2 - 0.86) / 0.14) * 0.7);
        tmpA.lerp(tmpB, rockW);
        color.lerp(tmpA, wHs);
      }
      if (wJl > 0) {
        tmpA.copy(JL.soil);
        tmpB.copy(JL.rock).lerp(JL.moss, r1 * 0.55); // heavy moss on ruins-adjacent rock
        tmpA.lerp(tmpB, rockW);
        color.lerp(tmpA, wJl);
      }
      if (wPa > 0) {
        tmpA.copy(PA.soil).lerp(PA.rockA, r1 * 0.3);
        tmpB.copy(PA.rockA).lerp(PA.rockB, r1 * 0.5);
        tmpA.lerp(tmpB, rockW);
        color.lerp(tmpA, wPa);
      }

      // Sierra snow line: elevation-driven with patchy hash edges, grass
      // and rock faces too steep hold-out (§2.3 snowfields).
      if (wHs > 0.25) {
        const snowW = smoothstepf(78, 100, y + r2 * 14) * (1 - smoothstepf(0.35, 0.55, slope));
        if (snowW > 0) {
          tmpA.copy(HS.snow).lerp(HS.snowShadow, r1 * 0.6);
          color.lerp(tmpA, snowW);
        }
      }

      // Riverbank wetness: darken + deepen toward the riverBed falloff
      // (river runs |x| < ~30 m; height fn dips −10·exp(−(x/30)²)). The
      // companion brief's wet-specular item is carried by the noise
      // roughnessMap; this is its albedo counterpart.
      const wet = Math.exp(-(worldX * worldX) / (34 * 34));
      if (wet > 0.02) color.lerp(WET, wet * 0.55);

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

export function createTerrain(scene: THREE.Scene, caps?: RenderCaps) {
  const terrainManager = new TerrainManager(scene, caps);
  // Initial load around center
  terrainManager.update(new THREE.Vector3(0,0,0));
  return terrainManager;
}
