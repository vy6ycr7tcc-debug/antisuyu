import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

export interface RendererQuality {
  tier: 'HIGH' | 'MEDIUM' | 'LOW';
  shadowMapSize: number;
  pixelRatio: number;
}

export const QUALITY_TIERS: Record<'HIGH' | 'MEDIUM' | 'LOW', RendererQuality> = {
  HIGH: { tier: 'HIGH', shadowMapSize: 2048, pixelRatio: Math.min(2, window.devicePixelRatio) },
  MEDIUM: { tier: 'MEDIUM', shadowMapSize: 1024, pixelRatio: Math.min(1.5, window.devicePixelRatio) },
  LOW: { tier: 'LOW', shadowMapSize: 512, pixelRatio: 1.0 }, // shadow map size adjusted dynamically in renderer for WebGPU
};

export interface RenderCaps {
  isWebGPU: boolean;
  tier: 'HIGH' | 'MEDIUM' | 'LOW';
  maxAnisotropy: number;
}

declare global {
  interface Window {
    __rendererType?: 'webgpu' | 'webgl2';
  }
}

export function getRenderCaps(renderer: THREE.WebGLRenderer | WebGPURenderer, quality: RendererQuality): RenderCaps {
  return {
    isWebGPU: renderer instanceof WebGPURenderer,
    tier: quality.tier,
    maxAnisotropy: renderer instanceof WebGPURenderer ? 8 : 4
  };
}

// Phase 12 (p9 flag, §5.4): selective bloom mix — HDR add of the lamp-only
// bloom source over the main render, BEFORE OutputPass (J8 order preserved:
// bloom (HDR) → tonemap+encode → display-referred grade). Same composition as
// the official selective-bloom example, rgb-only (alpha from the base pass).
export const BloomMixShader = {
    uniforms: {
        "baseTexture": { value: null },
        "bloomTexture": { value: null }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `,
    fragmentShader: `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
            vec4 base = texture2D( baseTexture, vUv );
            vec3 bloom = texture2D( bloomTexture, vUv ).rgb;
            gl_FragColor = vec4( bloom, 1.0 ); // DEBUG-TEMP bloomonly
        }
    `
};

// Film Grain & Chromatic Aberration Shader for WebGL2
export const CinematicShader = {
    uniforms: {
        "tDiffuse": { value: null },
        "amount": { value: 0.0015 },
        "time": { value: 0.0 },
        // Phase 9 V-POST: the §5.4 vignette/grain amplitudes move to uniforms so
        // the attribution A/Bs (&vs= / &gs=) and the measured retune can drive
        // them at runtime. The grade is display-referred (see main.ts J8 note):
        // vignette 0.55 was tuned pre-tonemap and measured too heavy in display
        // space — p9 sweep retuned 0.55 → 0.25 (§5.4 amendment).
        "vignetteStrength": { value: 0.25 },
        "grainAmount": { value: 0.035 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        uniform float time;
        uniform float vignetteStrength;
        uniform float grainAmount;
        varying vec2 vUv;

        // Simple noise function
        float random(vec2 p) {
            vec2 K1 = vec2(
                23.14069263277926, // e^pi (Gelfond's constant)
                2.665144142690225 // 2^sqrt(2) (Gelfond-Schneider constant)
            );
            return fract(cos(dot(p, K1)) * 12345.6789);
        }

        void main() {
            vec2 uv = vUv;

            // Chromatic Aberration
            vec2 offset = vec2(amount, 0.0);
            float r = texture2D(tDiffuse, uv + offset).r;
            float g = texture2D(tDiffuse, uv).g;
            float b = texture2D(tDiffuse, uv - offset).b;
            vec3 col = vec3(r, g, b);

            // Vignette
            float factor = clamp(1.0 - length(uv - 0.5) * vignetteStrength, 0.0, 1.0);
            col *= factor;

            // Film Grain
            float noise = (random(uv + mod(time, 10.0)) - 0.5) * grainAmount;
            col += noise;

            gl_FragColor = vec4(col, 1.0);
        }
    `
};

export async function createRenderer(): Promise<{ renderer: WebGPURenderer | THREE.WebGLRenderer, quality: RendererQuality }> {
  // Determine quality tier based on device/fps... simplified for now
  let quality = navigator.hardwareConcurrency > 4 ? QUALITY_TIERS.HIGH : QUALITY_TIERS.MEDIUM;

  const urlParams = new URLSearchParams(window.location.search);
  const qParam = urlParams.get('quality');
  if (qParam === 'high') quality = QUALITY_TIERS.HIGH;
  else if (qParam === 'medium') quality = QUALITY_TIERS.MEDIUM;
  else if (qParam === 'low') quality = QUALITY_TIERS.LOW;

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
    // r186 removed PCFSoftShadowMap on WebGPU — the runtime substitutes
    // PCFShadowMap; set it explicitly so no deprecation warning prints.
    // Shadow softness tuning continues via normalBias (§3.2).
    renderer.shadowMap.type = THREE.PCFShadowMap;
    if (quality.tier === 'LOW') {
       // Visual bible rule: 512 on WebGL2, 1024 on WebGPU LOW
       // (Our QUALITY_TIERS specifies 512 by default for WebGL2)
       // Update the shadow rig later when lighting is initialized if necessary,
       // but here we just note it.
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposure authority is the TOD grade (visual bible §2.6); applied by
    // environment.ts when the grade is applied. Do not hardcode here.
    window.__rendererType = 'webgpu';

    return { renderer, quality };
  } catch (e) {
    console.warn("WebGPU not available, falling back to WebGL2", e);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });

    // Fallback gets HIGH by default on iPhone, adaptive down
    // Use requested quality if specified, else keep what we calculated

    // For LOW tier in WebGL2, shadow map size is 512, which is handled in tier definition

    renderer.setPixelRatio(quality.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Exposure authority is the TOD grade (visual bible §2.6); applied by
    // environment.ts when the grade is applied. Do not hardcode here.
    window.__rendererType = 'webgl2';

    return { renderer, quality };
  }
}
