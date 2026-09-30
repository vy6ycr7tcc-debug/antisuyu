import * as THREE from 'three';
import { RendererQuality } from './renderer.js';

import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js';

export interface LightRigConfig {
  sunColor: number;
  sunIntensity: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fillIntensity: number;
  exposure: number;
  fogColor: number;
  fogDensity: number;
  envIntensity: number;
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
const bakedEnvTexture = textureLoader.load('/env_baked.png');
bakedEnvTexture.mapping = THREE.EquirectangularReflectionMapping;
bakedEnvTexture.colorSpace = THREE.SRGBColorSpace;

// BEGIN RIG DELIMITER - to be extracted by V-LIGHT
export function createLightRig(scene: THREE.Scene, quality: RendererQuality): {
  applyGrade(grade: keyof typeof TOD_GRADES): void;
  update(playerPos: THREE.Vector3): void;
  sun: THREE.DirectionalLight;
} {
  const sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = quality.shadowMapSize;
  sunLight.shadow.mapSize.height = quality.shadowMapSize;
  const d = quality.shadowMapSize >= 2048 ? 120 : 90;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 800;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 1.5;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.0);
  scene.add(hemiLight);

  const cameraFill = new THREE.DirectionalLight(0xCFD8E8, 0.35);
  cameraFill.castShadow = false;
  scene.add(cameraFill);

  let currentSunDir = new THREE.Vector3(0, 1, 0);

  return {
    sun: sunLight,
    applyGrade(grade: keyof typeof TOD_GRADES) {
      const g = TOD_GRADES[grade];
      sunLight.color.setHex(g.sunColor);
      sunLight.intensity = g.sunIntensity;
      hemiLight.color.setHex(g.hemiSky);
      hemiLight.groundColor.setHex(g.hemiGround);
      hemiLight.intensity = g.hemiIntensity;
      cameraFill.intensity = g.fillIntensity;

      const phi = THREE.MathUtils.degToRad(90 - g.sunElevationDeg);
      const theta = THREE.MathUtils.degToRad(g.sunAzimuthDeg);
      currentSunDir.setFromSphericalCoords(1, phi, theta);
    },
    update(playerPos: THREE.Vector3) {
      sunLight.position.copy(playerPos).addScaledVector(currentSunDir, 300);
      sunLight.target.position.copy(playerPos);

      const cameraForward = new THREE.Vector3(0, 0, -1);
      const up = new THREE.Vector3(0, 1, 0);
      cameraFill.position.copy(playerPos).addScaledVector(cameraForward, -50).addScaledVector(up, 30);
    }
  };
}
// END RIG DELIMITER

// Keep a reference to the active rig so we can update it if needed
let activeRig: ReturnType<typeof createLightRig> | null = null;

export function getActiveLightRig() {
  return activeRig;
}

export function setupEnvironment(scene: THREE.Scene, quality: RendererQuality, renderer: THREE.WebGLRenderer | any, todParam: string | null, regionId?: string) {
  const gradeKey = (todParam || 'day') as keyof typeof TOD_GRADES;
  const grade = TOD_GRADES[gradeKey] || TOD_GRADES['day'];

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
  let sky;
  if (renderer && renderer.isWebGLRenderer) {
    sky = new Sky();
  } else {
    sky = new SkyMesh();
  }
  sky.scale.setScalar(4500);
  scene.add(sky);

  const skyUniforms = (sky as any).material.uniforms || (sky as any).material;

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

  const phi = THREE.MathUtils.degToRad(90 - grade.sunElevationDeg);
  const theta = THREE.MathUtils.degToRad(grade.sunAzimuthDeg);
  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

  if (renderer && renderer.isWebGLRenderer) {
      skyUniforms[ 'turbidity' ].value = turbidity;
      skyUniforms[ 'rayleigh' ].value = rayleigh;
      skyUniforms[ 'mieCoefficient' ].value = mieCoefficient;
      skyUniforms[ 'mieDirectionalG' ].value = mieDirectionalG;
      skyUniforms[ 'sunPosition' ].value.copy(sunPosition);
  } else {
      const skyMaterial = (sky as any).material;
      if (skyMaterial.turbidity) skyMaterial.turbidity.value = turbidity;
      if (skyMaterial.rayleigh) skyMaterial.rayleigh.value = rayleigh;
      if (skyMaterial.mieCoefficient) skyMaterial.mieCoefficient.value = mieCoefficient;
      if (skyMaterial.mieDirectionalG) skyMaterial.mieDirectionalG.value = mieDirectionalG;
      if (skyMaterial.sunPosition) skyMaterial.sunPosition.value.copy(sunPosition);
  }

  scene.environment = bakedEnvTexture;
  scene.environmentIntensity = grade.envIntensity;
}
