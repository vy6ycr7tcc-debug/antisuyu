import * as THREE from 'three';

// Simple pseudo-random hash
function hash(x: number, y: number): number {
    return (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) - Math.floor(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
}

// Bilinear noise
function noise(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);

    const ux = fx * fx * (3.0 - 2.0 * fx);
    const uy = fy * fy * (3.0 - 2.0 * fy);

    return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

// Fractional Brownian Motion
function fbm(x: number, y: number, octaves: number = 4): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
        value += amplitude * noise(x * frequency, y * frequency);
        frequency *= 2;
        amplitude *= 0.5;
    }
    return value;
}

export function createNoiseTexture(size: number, scale: number = 10, octaves: number = 4): THREE.DataTexture {
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
}

export function createNormalTexture(size: number, scale: number = 10, intensity: number = 5.0): THREE.DataTexture {
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
}
