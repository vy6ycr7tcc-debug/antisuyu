import * as THREE from 'three';
import { RendererQuality } from './renderer.js';
import { WebGPURenderer, PMREMGenerator as WebGPUPMREMGenerator } from 'three/webgpu';

import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js';

import { createLightRig, LightRigConfig } from './lighting.js';

declare global {
  interface ImportMeta {
    env: {
      BASE_URL: string;
    };
  }
}

/** Shape of the uniform block shared by Sky (ShaderMaterial) and SkyMesh (NodeMaterial). */
interface UniformLike<T> { value: T }
interface SkyUniforms {
  turbidity: UniformLike<number>;
  rayleigh: UniformLike<number>;
  mieCoefficient: UniformLike<number>;
  mieDirectionalG: UniformLike<number>;
  sunPosition: UniformLike<THREE.Vector3>;
}

// Where uniforms live differs by class: SkyMesh (WebGPU) exposes them as direct
// TSL uniform-node properties on the mesh ITSELF; Sky (WebGL2) exposes them on
// material.uniforms. Probe: mesh object → material props → material.uniforms.
function getSkyUniforms(sky: THREE.Mesh): SkyUniforms {
  const meshProps = sky as unknown as Record<string, unknown>;
  const mat: unknown = sky.material;
  const matProps = mat as Record<string, unknown>;
  const record = (mat as { uniforms?: Record<string, unknown> }).uniforms;
  const pick = <K extends keyof SkyUniforms>(key: K): SkyUniforms[K] => {
    const sources: unknown[] = [meshProps[key as string], matProps[key as string], record ? record[key as string] : undefined];
    for (const src of sources) {
      if (src && typeof src === 'object' && 'value' in src) return src as SkyUniforms[K];
    }
    throw new Error(`Sky uniform "${String(key)}" not found on ${sky.type}`);
  };
  return {
    turbidity: pick('turbidity'),
    rayleigh: pick('rayleigh'),
    mieCoefficient: pick('mieCoefficient'),
    mieDirectionalG: pick('mieDirectionalG'),
    sunPosition: pick('sunPosition')
  };
}

export const TOD_GRADES: Record<'day'|'dawn'|'noon'|'dusk'|'night', LightRigConfig> = {
  day: {
    sunColor: 0xFFF4E5, sunIntensity: 4.5, sunElevationDeg: 25, sunAzimuthDeg: 135,
    hemiSky: 0xBDD3F0, hemiGround: 0x5A5A48, hemiIntensity: 0.5,
    fillIntensity: 0.35, exposure: 1.1,
    fogColor: 0x87B5FF, fogDensity: 0.0015, envIntensity: 0.55
  },
  dawn: {
    sunColor: 0xFFA500, sunIntensity: 2.2, sunElevationDeg: 6, sunAzimuthDeg: 90,
    hemiSky: 0xD8C4B0, hemiGround: 0x4A4038, hemiIntensity: 0.25,
    fillIntensity: 0.35, exposure: 1.0,
    fogColor: 0xD0B49F, fogDensity: 0.0022, envIntensity: 0.35
  },
  noon: {
    sunColor: 0xFFFFFF, sunIntensity: 5.5, sunElevationDeg: 82, sunAzimuthDeg: 180,
    hemiSky: 0xC8DCF5, hemiGround: 0x6A6A55, hemiIntensity: 0.65,
    fillIntensity: 0.35, exposure: 1.15,
    fogColor: 0x9BC0FF, fogDensity: 0.0011, envIntensity: 0.55
  },
  dusk: {
    sunColor: 0xFF8C00, sunIntensity: 2.0, sunElevationDeg: 6, sunAzimuthDeg: 270,
    hemiSky: 0xC4A490, hemiGround: 0x423A30, hemiIntensity: 0.25,
    fillIntensity: 0.35, exposure: 1.0,
    fogColor: 0xB28C70, fogDensity: 0.0022, envIntensity: 0.35
  },
  night: {
    sunColor: 0x9FB8DD, sunIntensity: 0.5, sunElevationDeg: 35, sunAzimuthDeg: 270,
    hemiSky: 0x2A3A55, hemiGround: 0x1A1A18, hemiIntensity: 0.15,
    fillIntensity: 0.35, exposure: 0.85,
    fogColor: 0x1E2A3A, fogDensity: 0.0028, envIntensity: 0.25
  }
};

const textureLoader = new THREE.TextureLoader();
// Emergency IBL fallback only (visual bible §5.2 T2) — used if PMREM generation throws.
const bakedEnvTexture = textureLoader.load(`${import.meta.env.BASE_URL}env_baked.png`);
bakedEnvTexture.mapping = THREE.EquirectangularReflectionMapping;
bakedEnvTexture.colorSpace = THREE.SRGBColorSpace;


// Keep a reference to the active rig so we can update it if needed
let activeRig: ReturnType<typeof createLightRig> | null = null;

export function getActiveLightRig() {
  return activeRig;
}

export function setupEnvironment(scene: THREE.Scene, quality: RendererQuality, renderer: THREE.WebGLRenderer | WebGPURenderer, todParam: string | null, regionId?: string) {
  const gradeKey = (todParam || 'day') as keyof typeof TOD_GRADES;
  const grade = TOD_GRADES[gradeKey] || TOD_GRADES['day'];

  // Tone mapping + exposure live on the renderer (both PostProcessing's default
  // output transform and EffectComposer's OutputPass read them from here).
  renderer.toneMappingExposure = grade.exposure;

  scene.background = new THREE.Color(grade.hemiSky);

  // Fog depends on region + grade
  const fogColor = new THREE.Color(grade.fogColor);
  let fogDensity = grade.fogDensity;

  if (regionId === 'cloud_forest') {
    fogColor.setHex(0xA8B8B0); // Mist blue-grey base
  } else if (regionId === 'jungle_lowlands') {
    fogColor.setHex(0x14261E); // Swallowed ruins/dark water baseline
    fogDensity *= 1.5;
  } else if (regionId === 'high_sierra') {
    fogDensity *= 0.5; // clear
  }

  scene.fog = new THREE.FogExp2(fogColor, fogDensity);

  // Set up lights inside this function for now, but call the extracted pattern
  if (!activeRig) {
      activeRig = createLightRig(scene, quality);
  }
  activeRig.applyGrade(gradeKey);
  activeRig.update(new THREE.Vector3(0, 0, 0));

  // Sky dome
  const isWebGPURenderer = renderer instanceof WebGPURenderer;
  let sky: THREE.Mesh;
  if (isWebGPURenderer) {
    sky = new SkyMesh();
  } else {
    sky = new Sky();
  }
  sky.scale.setScalar(4500);

  let turbidity = 10;
  let rayleigh = 2;

  if (gradeKey === 'dawn' || gradeKey === 'dusk') {
    turbidity = 12;
    rayleigh = 2.5;
  } else if (gradeKey === 'noon') {
    turbidity = 8;
    rayleigh = 3.0;
  }

  const mieCoefficient = 0.005;
  const mieDirectionalG = 0.8;

  // Sky-sun position. At night the graded "sun" slot actually describes the MOON
  // (§2.6 night row: elev 35°); the sky shader's sun must sit below the horizon
  // so the dome reads as night, not as a second daytime.
  const skyElevationDeg = gradeKey === 'night' ? -12 : grade.sunElevationDeg;
  const skyAzimuthDeg = gradeKey === 'night' ? 90 : grade.sunAzimuthDeg;
  const phi = THREE.MathUtils.degToRad(90 - skyElevationDeg);
  const theta = THREE.MathUtils.degToRad(skyAzimuthDeg);
  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

  const skyUniforms = getSkyUniforms(sky);
  skyUniforms.turbidity.value = turbidity;
  skyUniforms.rayleigh.value = rayleigh;
  skyUniforms.mieCoefficient.value = mieCoefficient;
  skyUniforms.mieDirectionalG.value = mieDirectionalG;
  skyUniforms.sunPosition.value.copy(sunPosition);

  // IBL: PMREM capture of the sky on BOTH paths (visual bible §5.2 T2).
  // The sky is temporarily reparented into a sky-only scene for the capture.
  let environment: THREE.Texture;
  try {
    const pmremScene = new THREE.Scene();
    pmremScene.add(sky);
    if (isWebGPURenderer) {
      const pmrem = new WebGPUPMREMGenerator(renderer);
      const rt = pmrem.fromScene(pmremScene, 0, 1, 10000);
      environment = rt.texture;
      pmrem.dispose();
    } else {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(pmremScene, 0, 1, 10000);
      environment = rt.texture;
      pmrem.dispose();
    }
  } catch (e) {
    console.error('IBL: PMREM sky capture failed — using baked env fallback. Reason:', e);
    environment = bakedEnvTexture;
  }

  scene.add(sky);
  scene.environment = environment;
  scene.environmentIntensity = grade.envIntensity;
}
