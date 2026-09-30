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
}

export function createNormalTexture(size: number, scale: number = 10, intensity: number = 5.0): THREE.DataTexture {
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
}
