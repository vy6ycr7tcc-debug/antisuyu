const fs = require('fs');

// Patch terrain.ts
let terrainContent = fs.readFileSync('src/terrain.ts', 'utf8');

const searchMaterialDef = `  material: THREE.Material;

  constructor(scene: THREE.Scene) {`;
const replaceMaterialDef = `  material: THREE.Material;
  isWebGPU: boolean = false;
  rendererCapsSet: boolean = false;
  maxAnisotropy: number = 4;

  constructor(scene: THREE.Scene) {`;
terrainContent = terrainContent.replace(searchMaterialDef, replaceMaterialDef);

const searchGetChunkKey = `  getChunkKey(cx: number, cz: number): string {`;
const replaceGetChunkKey = `  detectRenderer() {
    if (this.rendererCapsSet) return;
    this.rendererCapsSet = true;
    try {
       const canvas = document.querySelector('canvas');
       if (canvas) {
           this.isWebGPU = !!(window as any).__isWebGPU;
       }
    } catch(e) {}
  }

  getChunkKey(cx: number, cz: number): string {`;
terrainContent = terrainContent.replace(searchGetChunkKey, replaceGetChunkKey);

const loopSearch1 = `      const worldZ = pz + worldOffsetZ;

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

      colors.push(color.r, color.g, color.b);`;

const replaceLoop1 = `      const worldX = px + worldOffsetX;
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

      colors.push(color.r, color.g, color.b);`;

terrainContent = terrainContent.replace(loopSearch1, replaceLoop1);
fs.writeFileSync('src/terrain.ts', terrainContent);


// Patch textures.ts
let textureContent = fs.readFileSync('src/textures.ts', 'utf8');

const searchNoise = `export function createNoiseTexture(size: number, scale: number = 10, octaves: number = 4): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const v = fbm((x / size) * scale, (y / size) * scale, octaves);
            const idx = (y * size + x) * 4;
            const val = Math.floor(v * 255);
            data[idx] = val;
            data[idx+1] = val;
            data[idx+2] = val;
            data[idx+3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
}`;

const replaceNoise = `export function createNoiseTexture(size: number, scale: number = 10, octaves: number = 4): THREE.DataTexture {
    // iPhone memory budget: cap texture sizes
    const actualSize = Math.min(size, 256);
    const data = new Uint8Array(actualSize * actualSize * 4);

    for (let y = 0; y < actualSize; y++) {
        for (let x = 0; x < actualSize; x++) {
            // Apply a domain warp (fbm of fbm) for organic non-tiling variation
            const warpX = fbm((x / actualSize) * scale, (y / actualSize) * scale, 2);
            const warpY = fbm((x / actualSize) * scale + 5.2, (y / actualSize) * scale + 1.3, 2);

            // Re-map scale to avoid visible tiling artifacts by introducing organic warping
            const nx = ((x / actualSize) + warpX * 0.1) * scale;
            const ny = ((y / actualSize) + warpY * 0.1) * scale;

            const v = fbm(nx, ny, octaves);
            const idx = (y * actualSize + x) * 4;
            const val = Math.floor(v * 255);
            data[idx] = val;
            data[idx+1] = val;
            data[idx+2] = val;
            data[idx+3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, actualSize, actualSize, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // Apply proper magnification/minification filters for terrain variation
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}`;

textureContent = textureContent.replace(searchNoise, replaceNoise);

const searchNormal = `export function createNormalTexture(size: number, scale: number = 10, intensity: number = 5.0): THREE.DataTexture {
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const hL = fbm(((x - 1) / size) * scale, (y / size) * scale);
            const hR = fbm(((x + 1) / size) * scale, (y / size) * scale);
            const hU = fbm((x / size) * scale, ((y - 1) / size) * scale);
            const hD = fbm((x / size) * scale, ((y + 1) / size) * scale);

            const dx = (hR - hL) * intensity;
            const dy = (hD - hU) * intensity;
            const dz = 1.0;

            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const nx = dx / len;
            const ny = dy / len;
            const nz = dz / len;

            const idx = (y * size + x) * 4;
            data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            data[idx+1] = Math.floor((ny * 0.5 + 0.5) * 255);
            data[idx+2] = Math.floor((nz * 0.5 + 0.5) * 255);
            data[idx+3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
}`;

const replaceNormal = `export function createNormalTexture(size: number, scale: number = 10, intensity: number = 5.0): THREE.DataTexture {
    // iPhone memory budget: cap texture sizes
    const actualSize = Math.min(size, 256);
    const data = new Uint8Array(actualSize * actualSize * 4);

    for (let y = 0; y < actualSize; y++) {
        for (let x = 0; x < actualSize; x++) {
            // Apply domain warping to normal generation to break up tiling
            const warpX = fbm((x / actualSize) * scale, (y / actualSize) * scale, 2) * 0.1;
            const warpY = fbm((x / actualSize) * scale + 5.2, (y / actualSize) * scale + 1.3, 2) * 0.1;

            const getH = (ox: number, oy: number) => {
                const nx = (((x + ox) / actualSize) + warpX) * scale;
                const ny = (((y + oy) / actualSize) + warpY) * scale;
                return fbm(nx, ny, 4);
            };

            const hL = getH(-1, 0);
            const hR = getH(1, 0);
            const hU = getH(0, -1);
            const hD = getH(0, 1);

            const dx = (hR - hL) * intensity;
            const dy = (hD - hU) * intensity;
            const dz = 1.0;

            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const nx = dx / len;
            const ny = dy / len;
            const nz = dz / len;

            const idx = (y * actualSize + x) * 4;
            data[idx] = Math.floor((nx * 0.5 + 0.5) * 255);
            data[idx+1] = Math.floor((ny * 0.5 + 0.5) * 255);
            data[idx+2] = Math.floor((nz * 0.5 + 0.5) * 255);
            data[idx+3] = 255;
        }
    }
    const tex = new THREE.DataTexture(data, actualSize, actualSize, THREE.RGBAFormat);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
}`;

textureContent = textureContent.replace(searchNormal, replaceNormal);
fs.writeFileSync('src/textures.ts', textureContent);
