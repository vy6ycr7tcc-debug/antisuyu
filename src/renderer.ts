import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

export interface RendererQuality {
  shadowMapSize: number;
  pixelRatio: number;
}

export const QUALITY_TIERS = {
  HIGH: { shadowMapSize: 2048, pixelRatio: window.devicePixelRatio },
  MEDIUM: { shadowMapSize: 1024, pixelRatio: Math.min(1.5, window.devicePixelRatio) },
  LOW: { shadowMapSize: 512, pixelRatio: 1.0 },
};

export async function createRenderer(): Promise<{ renderer: WebGPURenderer | THREE.WebGLRenderer, quality: RendererQuality }> {
  // Determine quality tier based on device/fps... simplified for now
  const quality = navigator.hardwareConcurrency > 4 ? QUALITY_TIERS.HIGH : QUALITY_TIERS.MEDIUM;

  // Try WebGPU first
  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU not supported");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No WebGPU adapter");
    }

    const renderer = new WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
    await renderer.init();

    renderer.setPixelRatio(quality.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;

    return { renderer, quality };
  } catch (e) {
    console.warn("WebGPU not available, falling back to WebGL2", e);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });

    // Fallback gets reduced settings implicitly
    const fallbackQuality = QUALITY_TIERS.LOW;

    renderer.setPixelRatio(fallbackQuality.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;

    return { renderer, quality: fallbackQuality };
  }
}
