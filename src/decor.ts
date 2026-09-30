import * as THREE from 'three';

import { getGlobalTerrainHeight } from './terrain.js';
import { createNoiseTexture, createNormalTexture } from './textures.js';
import { granite, limestoneSwallowed } from './materials.js';


// Fallback interface definition for missing RenderCaps
export interface RenderCaps {
  isWebGPU: boolean;
  tier: 'HIGH' | 'MEDIUM' | 'LOW';
  maxAnisotropy: number;
}

export interface FoliageSpec {
  cardTexture: THREE.Texture;   // alpha-tested leaf/grass card, <=256^2
  colorA: number;               // hex, instance color variation low
  colorB: number;               // hex, instance color variation high
  count: number;                // instances (5000 HIGH, 2500 LOW)
  windAmp: number;              // 0.15 default (§5 T5)
  castShadow: boolean;          // true HIGH/MEDIUM, false LOW
}

function createFoliageCardTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        // Clear with transparent
        ctx.clearRect(0, 0, size, size);

        // Draw a simple leaf/fern shape
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(128, 250); // Bottom stem
        ctx.quadraticCurveTo(50, 150, 128, 10); // Left edge to tip
        ctx.quadraticCurveTo(206, 150, 128, 250); // Right edge back to bottom
        ctx.fill();

        // Add some cutouts to look more like a fern/leaf cluster
        ctx.globalCompositeOperation = 'destination-out';
        for (let i = 0; i < 5; i++) {
            const y = 50 + i * 40;
            ctx.beginPath();
            ctx.ellipse(80, y, 20, 5, Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(176, y, 20, 5, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
}

let WEBGPU: any;
async function loadWebGPU() {
    if (!WEBGPU) {
        try {
           WEBGPU = await import('three/webgpu');
        } catch(e) {
           console.error("Failed to load three/webgpu", e);
        }
    }
    return WEBGPU;
}

export class DecorManager {
  scene: THREE.Scene;
  dummy = new THREE.Object3D();
  colorDummy = new THREE.Color();

  treeInstanced: THREE.InstancedMesh;
  rockInstanced: THREE.InstancedMesh;
  rockInstancedLimestone!: THREE.InstancedMesh;
  mistInstanced: THREE.InstancedMesh;

  treeCount = 5000;
  rockCount = 2000;
  mistCount = 200;

  foliageSpec: FoliageSpec;

  constructor(scene: THREE.Scene, caps?: RenderCaps) {
    this.scene = scene;
    const renderCaps: RenderCaps = caps || { isWebGPU: false, tier: "HIGH", maxAnisotropy: 8 };

    this.treeCount = renderCaps.tier === 'LOW' ? 2500 : 5000;

    this.foliageSpec = {
        cardTexture: createFoliageCardTexture(),
        colorA: 0x2d4c1e, // Base green
        colorB: 0x4a5d23, // Lighter, yellower green
        count: this.treeCount,
        windAmp: 0.15,
        castShadow: renderCaps.tier !== 'LOW'
    };

    // 1. Trees/Foliage (Jungle + Ichu Grass depending on biome)
    // Using planes (cards) instead of cones
    const leavesGeo = new THREE.PlaneGeometry(6, 6);
    leavesGeo.translate(0, 3, 0); // Ground it

    const normalMapTree = createNormalTexture(128, 5, 2.0);

    // Base WebGL2 Material
    const leavesMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, // Tinting applied via instance color
        roughness: 0.9,
        map: this.foliageSpec.cardTexture,
        alphaTest: 0.5,
        normalMap: normalMapTree,
        side: THREE.DoubleSide
    });

    // WebGL2 Wind displacement
    leavesMat.onBeforeCompile = (shader) => {
        shader.uniforms.time = { value: 0 };
        shader.uniforms.windAmp = { value: this.foliageSpec.windAmp };
        shader.vertexShader = `
            uniform float time;
            uniform float windAmp;
            ${shader.vertexShader}
        `;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `
            #include <begin_vertex>
            // Simple sine wave wind displacement based on world position and height
            vec4 worldPos = instanceMatrix * vec4(position, 1.0);
            float windOffset = sin(worldPos.x * 0.1 + time * 2.0) * sin(worldPos.z * 0.1 + time * 1.5);
            // Only displace the top of the card (position.y > 0 due to translate)
            float heightFactor = clamp(position.y / 6.0, 0.0, 1.0);
            transformed.x += windOffset * windAmp * heightFactor;
            `
        );
        // Store reference to update uniform
        leavesMat.userData.shader = shader;
    };


    this.treeInstanced = new THREE.InstancedMesh(leavesGeo, leavesMat, this.treeCount);
    this.treeInstanced.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.treeCount * 3), 3);
    this.treeInstanced.castShadow = this.foliageSpec.castShadow;
    this.treeInstanced.receiveShadow = this.foliageSpec.castShadow;
    this.scene.add(this.treeInstanced);


    // Setup WebGPU Material if supported
    if (renderCaps.isWebGPU) {
        loadWebGPU().then(TSL => {
            if (TSL && TSL.MeshStandardNodeMaterial) {
                 const matNode = new TSL.MeshStandardNodeMaterial({
                     color: 0xffffff,
                     roughness: 0.9,
                     alphaTest: 0.5,
                     side: THREE.DoubleSide
                 });

                 if (TSL.texture && TSL.time && TSL.positionGeometry && TSL.positionWorld && TSL.instanceColor && TSL.sin && TSL.clamp && TSL.float && TSL.vec3) {
                     const texNode = TSL.texture(this.foliageSpec.cardTexture);
                     matNode.colorNode = texNode.mul(TSL.instanceColor);

                     const normalMap = createNormalTexture(128, 5, 2.0);
                     matNode.normalNode = TSL.texture(normalMap);

                     // Wind Node
                     const timeNode = TSL.time;
                     const posWorld = TSL.positionWorld;
                     const windOffset = TSL.sin(posWorld.x.mul(0.1).add(timeNode.mul(2.0)))
                                        .mul(TSL.sin(posWorld.z.mul(0.1).add(timeNode.mul(1.5))));
                     const heightFactor = TSL.clamp(TSL.positionGeometry.y.div(6.0), 0.0, 1.0);

                     const displacement = TSL.vec3(windOffset.mul(this.foliageSpec.windAmp).mul(heightFactor), 0, 0);
                     matNode.positionNode = TSL.positionGeometry.add(displacement);
                 }
                 this.treeInstanced.material = matNode;
            }
        });
    }

    // 2. Rocks
    const rockGeo = new THREE.DodecahedronGeometry(2);
    const rockMatGranite = granite();
    const rockMatLimestone = limestoneSwallowed();

    // We will create two instanced meshes and split the count
    this.rockInstanced = new THREE.InstancedMesh(rockGeo, rockMatGranite, this.rockCount); // Sierra
    this.rockInstanced.castShadow = true;
    this.rockInstanced.receiveShadow = true;
    this.scene.add(this.rockInstanced);

    // Using a new property for the second instanced mesh (not strictly following the exact previous class signature, but needed for two materials without using node materials for both)
    // Actually, we can use the original rockInstanced for High Sierra (granite)
    // and we'll add rockInstancedLimestone for Jungle/Cloud Forest
    this.rockInstancedLimestone = new THREE.InstancedMesh(rockGeo, rockMatLimestone, this.rockCount);
    this.rockInstancedLimestone.castShadow = true;
    this.rockInstancedLimestone.receiveShadow = true;
    this.scene.add(this.rockInstancedLimestone);

    // 3. Mist
    const mistGeo = new THREE.PlaneGeometry(30, 15);
    // V-SKY composite requirement: soft cards, depthWrite false, don't hardcode fog colors.
    // We use a soft gray that will blend with whatever fog/lighting is present.
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // Soft composition
      side: THREE.DoubleSide
    });
    this.mistInstanced = new THREE.InstancedMesh(mistGeo, mistMat, this.mistCount);
    this.scene.add(this.mistInstanced);
  }

  update(camera: THREE.Camera) {
    // Update wind time
    const time = performance.now() / 1000;
    if ((this.treeInstanced.material as any).userData?.shader) {
        (this.treeInstanced.material as any).userData.shader.uniforms.time.value = time;
    }

    // Dynamic update based on camera position (LOD/streaming for decor)
    // For now, we update matrices in a radius around the camera
    const camPos = camera.position;

    // Simple noise generator for deterministic placement
    const seededRandom = (x: number, z: number) => {
        return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
    };

    let treeIdx = 0;
    let rockIdx = 0;
    let rockLimestoneIdx = 0;
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

          let blend = rand;
          if (isHighSierra) {
            // Ichu grass scatter (shorter, squatter)
            const scale = 0.2 + rand * 0.2;
            this.dummy.scale.set(scale * 2, scale, scale * 2);
            // More dried out color for high sierra
            this.colorDummy.setHex(0x9A8B4F).lerp(new THREE.Color(0x6e6538), rand);
          } else {
            // Jungle/Cloud Forest tree
            const scale = 0.5 + rand * 0.5;
            this.dummy.scale.set(scale, scale, scale);
            this.colorDummy.setHex(this.foliageSpec.colorA).lerp(new THREE.Color(this.foliageSpec.colorB), rand);
          }

          this.dummy.rotation.y = rand * Math.PI * 2;
          // Add some slight tilt variation
          this.dummy.rotation.x = (rand - 0.5) * 0.2;
          this.dummy.rotation.z = (rand - 0.5) * 0.2;

          this.dummy.updateMatrix();
          this.treeInstanced.setMatrixAt(treeIdx, this.dummy.matrix);
          this.treeInstanced.setColorAt(treeIdx, this.colorDummy);
          treeIdx++;
        }

        // Rocks
        // High Sierra scree slopes (granite)
        if (isHighSierra && rockIdx < this.rockCount && rand > 0.75) {
          this.dummy.position.set(qx, y - 0.2, qz); // Embed slightly
          const scale = 0.5 + rand * 1.5;
          this.dummy.scale.set(scale * 1.5, scale * 1.0, scale * 1.5);
          this.dummy.rotation.set(rand * Math.PI, rand * Math.PI, rand * Math.PI);
          this.dummy.updateMatrix();
          this.rockInstanced.setMatrixAt(rockIdx, this.dummy.matrix);
          rockIdx++;
        }
        // Jungle/Cloud Forest mossy boulders (limestone)
        else if (!isHighSierra && rockLimestoneIdx < this.rockCount && rand > 0.85) {
          this.dummy.position.set(qx, y + 0.5, qz);
          const scale = 0.5 + rand * 1.2;
          this.dummy.scale.set(scale, scale * 0.8, scale);
          this.dummy.rotation.set(rand * Math.PI, rand * Math.PI, rand * Math.PI);
          this.dummy.updateMatrix();
          this.rockInstancedLimestone.setMatrixAt(rockLimestoneIdx, this.dummy.matrix);
          rockLimestoneIdx++;
        }

        // Mist (Only in Jungle and Cloud Forest low areas)
        if (!isHighSierra && mistIdx < this.mistCount && rand > 0.35 && rand < 0.45 && y < 20) {
          this.dummy.position.set(qx, y + 4 + rand * 6, qz);
          this.dummy.scale.setScalar(1 + rand * 2);
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
    for (let i = rockLimestoneIdx; i < this.rockCount; i++) this.rockInstancedLimestone.setMatrixAt(i, this.dummy.matrix);
    for (let i = mistIdx; i < this.mistCount; i++) this.mistInstanced.setMatrixAt(i, this.dummy.matrix);

    this.treeInstanced.instanceMatrix.needsUpdate = true;
    if (this.treeInstanced.instanceColor) this.treeInstanced.instanceColor.needsUpdate = true;
    this.rockInstanced.instanceMatrix.needsUpdate = true;
    this.rockInstancedLimestone.instanceMatrix.needsUpdate = true;
    this.mistInstanced.instanceMatrix.needsUpdate = true;
  }
}

export function createDecor(scene: THREE.Scene, caps?: RenderCaps) {
  return new DecorManager(scene, caps);
}
