import * as THREE from 'three';
import { createNoiseTexture, createNormalTexture } from './textures.js';
export interface RenderCaps { isWebGPU: boolean; tier: 'HIGH' | 'MEDIUM' | 'LOW'; maxAnisotropy: number; }

// Cache for procedural textures to avoid recreating them for every material instance
const textureCache = {
    noise: null as THREE.DataTexture | null,
    normal: null as THREE.DataTexture | null,
};

function getNoiseMap(): THREE.DataTexture {
    if (!textureCache.noise) {
        textureCache.noise = createNoiseTexture(256, 10, 4);
    }
    return textureCache.noise;
}

function getNormalMap(): THREE.DataTexture {
    if (!textureCache.normal) {
        textureCache.normal = createNormalTexture(256, 10, 5.0);
    }
    return textureCache.normal;
}

let WEBGPU: any = null;

async function loadWebGPU() {
    if (!WEBGPU) {
        try {
           WEBGPU = await import('three/webgpu' as any);
        } catch(e) {
           console.error("Failed to load three/webgpu", e);
        }
    }
    return WEBGPU;
}

// Material factories will be implemented below

// --- Stone / Masonry ---

// Ashlar light (Paititi primary stone, sunlit faces)
export function ashlarLight(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
        color: 0xCFC6B4,
        roughness: 0.8, // fresh ashlar 0.75-0.85
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
    });
    return mat;
}

export async function buildAshlarLightWebGPU(caps: RenderCaps): Promise<THREE.Material | null> {
    if (!caps.isWebGPU) return null;
    const TSL = await loadWebGPU();
    if (TSL && TSL.MeshStandardNodeMaterial) {
        const mat = new TSL.MeshStandardNodeMaterial({ color: 0xCFC6B4, roughness: 0.8 });

        if (TSL.Fn && TSL.uv && TSL.float && TSL.vec3 && TSL.floor && TSL.fract && TSL.step && TSL.sin && TSL.mix) {
             const buildAshlar = TSL.Fn(() => {
                 const vUv = TSL.uv().mul(10.0);
                 const grid = TSL.floor(vUv);
                 const edge = TSL.fract(vUv);
                 const joint = TSL.step(edge.x, 0.05).add(TSL.step(edge.y, 0.05)).clamp(0, 1);

                 const jitter = TSL.fract(TSL.sin(grid.x.mul(12.9898).add(grid.y.mul(78.233))).mul(43758.5453)).mul(0.08).sub(0.04);
                 const baseColor = TSL.vec3(0xCFC6B4).add(TSL.vec3(jitter));

                 return TSL.mix(baseColor, TSL.vec3(0.5), joint);
             });
             mat.colorNode = buildAshlar();
             return mat as any;
        }
    }
    return null;
}

// Ashlar weathered (Paititi shadow faces / older structures)
export function ashlarWeathered(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xA89E86,
        roughness: 0.9, // weathered stone 0.85-0.95
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
    });
}

export async function buildAshlarWeatheredWebGPU(caps: RenderCaps): Promise<THREE.Material | null> {
    if (!caps.isWebGPU) return null;
    const TSL = await loadWebGPU();
    if (TSL && TSL.MeshStandardNodeMaterial) {
        const mat = new TSL.MeshStandardNodeMaterial({ color: 0xA89E86, roughness: 0.9 });
        if (TSL.Fn && TSL.uv && TSL.float && TSL.vec3 && TSL.floor && TSL.fract && TSL.step && TSL.sin && TSL.mix) {
             const buildAshlar = TSL.Fn(() => {
                 const vUv = TSL.uv().mul(10.0);
                 const grid = TSL.floor(vUv);
                 const edge = TSL.fract(vUv);
                 const joint = TSL.step(edge.x, 0.05).add(TSL.step(edge.y, 0.05)).clamp(0, 1);
                 const jitter = TSL.fract(TSL.sin(grid.x.mul(12.9898).add(grid.y.mul(78.233))).mul(43758.5453)).mul(0.08).sub(0.04);
                 const baseColor = TSL.vec3(0xA89E86).add(TSL.vec3(jitter));
                 return TSL.mix(baseColor, TSL.vec3(0.3), joint);
             });
             mat.colorNode = buildAshlar();
             return mat as any;
        }
    }
    return null;
}

// Granite (High Sierra cliff faces, outcrops)
export function granite(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x6E6A63,
        roughness: 0.85,
        metalness: 0.05,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
    });
}

// Limestone swallowed (Jungle lowlands ruined stone, heavy moss)
export function limestoneSwallowed(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xB8B0A0,
        roughness: 0.9, // weathered stone
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
    });
}

// Plaza worn (Worn paving, polished by feet)
export function plazaWorn(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x9A917E,
        roughness: 0.5, // worn paving 0.45-0.55
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
    });
}

// Cave dark (Deep interior stone)
export function caveDark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x4A4A48, // dark, desaturated
        roughness: 0.7, // damp roughness 0.55-0.7
        metalness: 0.0,
        normalMap: getNormalMap(),
        roughnessMap: getNoiseMap(),
        envMapIntensity: 0.3 // deep interior stone 0.3
    });
}

// --- Metal ---

// Gold (Sun disk, rings, inlay)
export function gold(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xD4A017,
        roughness: 0.35, // gold 0.32-0.38
        metalness: 1.0,
    });
}

// Bronze (Mechanisms, dials)
export function bronze(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x8C6A3F,
        roughness: 0.45, // bronze 0.4-0.5
        metalness: 0.85,
    });
}

// Iron dark (Sol Negro gear, heavy mechanisms)
export function ironDark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x4A4D50,
        roughness: 0.6,
        metalness: 0.8,
        normalMap: getNormalMap(), // slight texture for iron
    });
}

// --- Organic ---

// Wood aged (Old structures, barricades)
export function woodAged(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x5C4033, // rotting wood from cloud forest palette
        roughness: 0.85, // wood 0.8-0.9
        metalness: 0.0,
        normalMap: getNormalMap(), // grain bump
        roughnessMap: getNoiseMap(),
    });
}

// Wood wet (Jungle / near water structures)
export function woodWet(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x4A3025, // darker wood
        roughness: 0.6, // wet reduces roughness
        metalness: 0.0,
        normalMap: getNormalMap(),
    });
}

// Thatch / Ichu grass (Roofs, dry vegetation elements)
export function thatchIchu(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x9A8B4F, // High sierra Ichu grass
        roughness: 0.9,
        metalness: 0.0,
        normalMap: getNormalMap(),
    });
}

// Fabric worn (Tents, banners - uses parameter)
export function fabricWorn(hex: number): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: hex,
        roughness: 0.95, // cloth 0.9-1.0
        metalness: 0.0,
        roughnessMap: getNoiseMap(), // wear and tear
    });
}

// Leather dark (Gear, straps)
export function leatherDark(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0x2C1A10,
        roughness: 0.75, // Leather has lower roughness than cloth
        metalness: 0.05,
    });
}

// --- Special ---

// Lamp emissive (The ONLY material allowed to glow)
export function lampEmissive(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
        color: 0xFFB45E, // warm lamp color
        emissive: 0xFFB45E,
        emissiveIntensity: 2.0, // allowed budget for lamps
        roughness: 0.2, // glass/flame like
        metalness: 0.0,
    });
}

// --- Character ---

// Skin Naira (with SSS approximation)
export function skinNaira(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
        color: 0x8D5524,
        roughness: 0.6, // skin 0.55-0.65
        metalness: 0.0,
        transmission: 0.1, // Fake SSS
        thickness: 0.5,
        clearcoat: 0.1,
    });
}

// Cloth Field (weather-worn field clothing)
export function clothField(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
        color: 0x4A5D23,
        roughness: 0.95, // cloth 0.9-1.0
        metalness: 0.0,
        clearcoat: 0.0,
    });
}

// Hair Dark (Braid)
export function hairDark(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
        color: 0x0A0A0A,
        roughness: 0.4,
        metalness: 0.1,
        clearcoat: 0.3, // Shiny hair response
    });
}
