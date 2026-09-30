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

// Film Grain & Chromatic Aberration Shader for WebGL2
export const CinematicShader = {
    uniforms: {
        "tDiffuse": { value: null },
        "amount": { value: 0.005 },
        "time": { value: 0.0 }
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

            // Film Grain
            float noise = (random(uv + mod(time, 10.0)) - 0.5) * 0.1;
            col += noise;

            gl_FragColor = vec4(col, 1.0);
        }
    `
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
