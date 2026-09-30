import * as THREE from 'three';

import { getGlobalTerrainHeight } from './terrain.js';
import { createNoiseTexture, createNormalTexture } from './textures.js';

export class DecorManager {
  scene: THREE.Scene;
  dummy = new THREE.Object3D();

  treeInstanced: THREE.InstancedMesh;
  rockInstanced: THREE.InstancedMesh;
  mistInstanced: THREE.InstancedMesh;

  treeCount = 5000;
  rockCount = 2000;
  mistCount = 200;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Trees/Foliage (Jungle + Ichu Grass depending on biome)
    const leavesGeo = new THREE.ConeGeometry(3, 8, 8);
    leavesGeo.translate(0, 4, 0);
    const normalMapTree = createNormalTexture(128, 5, 2.0);
    const leavesMat = new THREE.MeshPhysicalMaterial({
        color: 0x2d4c1e,
        roughness: 0.9,
        normalMap: normalMapTree,
        envMapIntensity: 0.5
    });
    this.treeInstanced = new THREE.InstancedMesh(leavesGeo, leavesMat, this.treeCount);
    this.treeInstanced.castShadow = true;
    this.treeInstanced.receiveShadow = true;
    this.scene.add(this.treeInstanced);

    // 2. Rocks
    const rockGeo = new THREE.DodecahedronGeometry(2);
    const normalMapRock = createNormalTexture(128, 10, 5.0);
    const roughMapRock = createNoiseTexture(128, 10, 4);
    const rockMat = new THREE.MeshPhysicalMaterial({
        color: 0x555555,
        roughness: 0.9,
        roughnessMap: roughMapRock,
        metalness: 0.1,
        normalMap: normalMapRock,
        envMapIntensity: 1.0
    });
    this.rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, this.rockCount);
    this.rockInstanced.castShadow = true;
    this.rockInstanced.receiveShadow = true;
    this.scene.add(this.rockInstanced);

    // 3. Mist
    const mistGeo = new THREE.PlaneGeometry(30, 15);
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0xdddddd,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this.mistInstanced = new THREE.InstancedMesh(mistGeo, mistMat, this.mistCount);
    this.scene.add(this.mistInstanced);
  }

  update(camera: THREE.Camera) {
    // Dynamic update based on camera position (LOD/streaming for decor)
    // For now, we update matrices in a radius around the camera
    const camPos = camera.position;

    // Simple noise generator for deterministic placement
    const seededRandom = (x: number, z: number) => {
        return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    };

    let treeIdx = 0;
    let rockIdx = 0;
    let mistIdx = 0;

    const radius = 600;
    const step = 20;

    for (let x = -radius; x < radius; x += step) {
      for (let z = -radius; z < radius; z += step) {
        const worldX = camPos.x + x;
        const worldZ = camPos.z + z;

        // Quantize to grid
        const qx = Math.floor(worldX / step) * step;
        const qz = Math.floor(worldZ / step) * step;

        const rand = seededRandom(qx, qz);
        const y = getGlobalTerrainHeight(qx, qz);

        const isHighSierra = worldZ > 500 || y > 50;

        // Tree / Grass
        if (treeIdx < this.treeCount && rand < 0.3 && y > 2) {
          this.dummy.position.set(qx, y, qz);
          if (isHighSierra) {
            // Ichu grass scatter (shorter, squatter)
            const scale = 0.2 + rand * 0.2;
            this.dummy.scale.set(scale * 2, scale, scale * 2);
          } else {
            // Jungle tree
            const scale = 0.5 + rand * 0.5;
            this.dummy.scale.set(scale, scale, scale);
          }
          this.dummy.rotation.y = rand * Math.PI * 2;
          this.dummy.updateMatrix();
          this.treeInstanced.setMatrixAt(treeIdx, this.dummy.matrix);
          treeIdx++;
        }

        // Rocks
        if (rockIdx < this.rockCount && rand > 0.8) {
          this.dummy.position.set(qx, y + 0.5, qz);
          const scale = 0.2 + rand * 1.5;
          if (isHighSierra) {
             // More glacial erratic rocks
             this.dummy.scale.set(scale * 1.5, scale * 1.5, scale * 1.5);
          } else {
             this.dummy.scale.set(scale, scale * 0.8, scale);
          }
          this.dummy.rotation.set(rand * Math.PI, rand * Math.PI, rand * Math.PI);
          this.dummy.updateMatrix();
          this.rockInstanced.setMatrixAt(rockIdx, this.dummy.matrix);
          rockIdx++;
        }

        // Mist
        if (mistIdx < this.mistCount && rand > 0.4 && rand < 0.45 && y < 10) {
          this.dummy.position.set(qx, y + 5 + rand * 5, qz);
          this.dummy.scale.setScalar(1 + rand);
          this.dummy.rotation.y = rand * Math.PI;
          this.dummy.updateMatrix();
          this.mistInstanced.setMatrixAt(mistIdx, this.dummy.matrix);
          mistIdx++;
        }
      }
    }

    // Hide remaining instances
    this.dummy.position.set(0, -1000, 0);
    this.dummy.updateMatrix();

    for (let i = treeIdx; i < this.treeCount; i++) this.treeInstanced.setMatrixAt(i, this.dummy.matrix);
    for (let i = rockIdx; i < this.rockCount; i++) this.rockInstanced.setMatrixAt(i, this.dummy.matrix);
    for (let i = mistIdx; i < this.mistCount; i++) this.mistInstanced.setMatrixAt(i, this.dummy.matrix);

    this.treeInstanced.instanceMatrix.needsUpdate = true;
    this.rockInstanced.instanceMatrix.needsUpdate = true;
    this.mistInstanced.instanceMatrix.needsUpdate = true;
  }
}

export function createDecor(scene: THREE.Scene) {
  return new DecorManager(scene);
}
