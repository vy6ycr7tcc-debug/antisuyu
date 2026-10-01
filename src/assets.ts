import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { WebGPURenderer } from 'three/webgpu';

// ============================================================================
// KTX2 / Basis Universal asset pipeline (companion brief, "Asset pipeline").
//
// PBR sets ship as KTX2 so VRAM stays in compressed blocks on desktop (BC7)
// and mobile (ASTC/ETC2). The channel-packing convention is the SAME one the
// procedural sets use (textures.ts): albedo (sRGB) + ORMH (O=R, R=G, M=B,
// H=A) + tangent-space normal. When a KTX2 set replaces a procedural one,
// loadPBRSet() drops it in without touching material code.
//
// This module is deliberately standalone: Phases 3/8/9 import it when real
// assets land. Initializing the loader is cheap (the Basis transcoder WASM is
// only fetched on the first .ktx2 parse).
// ============================================================================

export type AnyRenderer = THREE.WebGLRenderer | WebGPURenderer;

let ktx2Loader: KTX2Loader | null = null;

/**
 * Returns the shared KTX2Loader with the Basis transcoder path relative to
 * the deployed base (vite base '/juzu/'). detectSupport() is re-run per call
 * so a renderer swap (WebGPU → WebGL2 fallback) keeps formats honest.
 */
export function getKTX2Loader(renderer: AnyRenderer): KTX2Loader {
  if (!ktx2Loader) {
    ktx2Loader = new KTX2Loader()
      .setTranscoderPath(`${import.meta.env.BASE_URL}libs/basis/`);
  }
  ktx2Loader.detectSupport(renderer);
  return ktx2Loader;
}

export interface PBRSetUrls {
  albedo: string;   // sRGB KTX2
  normal: string;   // linear KTX2 (tangent space, OpenGL green-up)
  ormh: string;     // linear KTX2 (AO=R, roughness=G, metalness=B, height=A)
}

export interface PBRSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  ormh: THREE.Texture;
}

function finishSetTexture(tex: THREE.Texture, srgb: boolean): THREE.Texture {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8; // clamped by the renderer to the device max at upload
  return tex;
}

/**
 * Loads a three-file PBR set and configures it to the shared packing
 * convention. The ORMH texture is pinned to uv channel 0 so aoMap /
 * roughnessMap / metalnessMap can all sample the geometry's trim uv.
 */
export async function loadPBRSet(urls: PBRSetUrls, renderer: AnyRenderer): Promise<PBRSet> {
  const loader = getKTX2Loader(renderer);
  const [albedo, normal, ormh] = await Promise.all([
    loader.loadAsync(urls.albedo),
    loader.loadAsync(urls.normal),
    loader.loadAsync(urls.ormh),
  ]);
  ormh.channel = 0;
  return {
    albedo: finishSetTexture(albedo, true),
    normal: finishSetTexture(normal, false),
    ormh: finishSetTexture(ormh, false),
  };
}

/**
 * Builds a MeshStandardMaterial from a loaded PBR set (same wiring as
 * ashlarTrimMaterial() but from KTX2 sources). Roughness/metalness scalars
 * are 1.0 so the ORMH channels pass through unattenuated.
 */
export function pbrSetMaterial(set: PBRSet): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xFFFFFF,
    map: set.albedo,
    normalMap: set.normal,
    roughnessMap: set.ormh,
    metalnessMap: set.ormh,
    aoMap: set.ormh,
    aoMapIntensity: 0.8,
    roughness: 1.0,
    metalness: 1.0,
    envMapIntensity: 1.0,
  });
}
