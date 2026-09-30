import * as THREE from 'three';
import { createNormalTexture } from './textures.js';
import { getGlobalTerrainHeight } from './terrain.js';
// Fallback interface definition for missing RenderCaps
export interface RenderCaps {
  isWebGPU: boolean;
  tier: 'HIGH' | 'MEDIUM' | 'LOW';
  maxAnisotropy: number;
}

// Defined in src/river.ts per bible 7.5
export interface WaterSpec {
  color: number;
  roughness: number;
  opacity: number;
  flowSpeed: number;
  flowDir: [number, number];
  foamAtEdges: boolean;
}

export function createWaterSurface(scene: THREE.Scene, spec: WaterSpec, width: number, length: number, caps: RenderCaps): { mesh: THREE.Mesh; update(time: number): void } {
  const geometry = new THREE.PlaneGeometry(width, length, Math.max(1, Math.floor(width)), Math.max(1, Math.floor(length / 2)));
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);

    const waterLevel = getGlobalTerrainHeight(0, vz) + 8;
    const terrainH = getGlobalTerrainHeight(vx, vz);
    const height = Math.min(waterLevel, terrainH);
    posAttr.setY(i, height);
  }
  geometry.computeVertexNormals();

  const normalMapWater = createNormalTexture(256, 30, 2.0);
  normalMapWater.wrapS = THREE.RepeatWrapping;
  normalMapWater.wrapT = THREE.RepeatWrapping;

  let material;

  if (caps.isWebGPU) {
    material = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: 0.1,
      transmission: 0.6,
      opacity: 1.0,
      transparent: true,
      ior: 1.33,
      normalMap: normalMapWater,
    });
  } else {
    material = new THREE.MeshPhysicalMaterial({
      color: spec.color,
      roughness: spec.roughness,
      metalness: 0.1,
      opacity: spec.opacity,
      transparent: true,
      normalMap: normalMapWater,
    });
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    mesh,
    update: (time: number) => {
      if (normalMapWater) {
        normalMapWater.offset.x = time * spec.flowSpeed * spec.flowDir[0];
        normalMapWater.offset.y = time * spec.flowSpeed * spec.flowDir[1];
      }
    }
  };
}

export function createRiver(scene: THREE.Scene, caps?: RenderCaps) {
  const dummyCaps: RenderCaps = caps || { isWebGPU: false, tier: "HIGH", maxAnisotropy: 8 };
  const spec: WaterSpec = { color: 0x335566, roughness: 0.1, opacity: 0.85, flowSpeed: 0.6, flowDir: [0, 1], foamAtEdges: true };

  const width = 40;
  const length = 1000;

  const surface = createWaterSurface(scene, spec, width, length, dummyCaps);
  surface.mesh.position.set(0, 0, 0);

  const waterfalls: { mesh: THREE.Mesh; update(time: number): void }[] = [];

  for (let z = -length / 2; z < length / 2; z += 5) {
    const h1 = getGlobalTerrainHeight(0, z);
    const h2 = getGlobalTerrainHeight(0, z + 5);

    if (Math.abs(h2 - h1) > 4) {
      const dropHeight = Math.abs(h2 - h1);
      const zPos = z + 2.5;
      const topH = Math.max(h1, h2);
      const botH = Math.min(h1, h2);

      const sheetGeo = new THREE.PlaneGeometry(width, dropHeight, 10, 5);

      let sheetMat;
      if (dummyCaps.isWebGPU) {
        sheetMat = new THREE.MeshPhysicalMaterial({
          color: spec.color,
          roughness: 0.3,
          transmission: 0.6,
          opacity: 1.0,
          transparent: true,
        });
      } else {
        sheetMat = new THREE.MeshPhysicalMaterial({
           color: spec.color,
           roughness: 0.3,
           opacity: 0.9,
           transparent: true,
        });
      }

      const sheet = new THREE.Mesh(sheetGeo, sheetMat);
      sheet.position.set(0, (topH + botH) / 2, zPos);

      const foamGeo = new THREE.PlaneGeometry(width, 10);
      foamGeo.rotateX(-Math.PI / 2);
      const foamMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 1.0,
        transparent: true,
        opacity: 0.8
      });
      const foam = new THREE.Mesh(foamGeo, foamMat);
      foam.position.set(0, botH, zPos);

      scene.add(sheet);
      scene.add(foam);

      waterfalls.push({
        mesh: sheet,
        update: (_time: number) => {}
      });
    }
  }

  return {
    mesh: surface.mesh,
    update: (time: number) => {
      surface.update(time);
      waterfalls.forEach(w => w.update(time));
    }
  };
}
