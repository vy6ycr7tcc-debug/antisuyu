import * as THREE from 'three';
import { RendererQuality } from './renderer.js';
import { TOD_GRADES } from './environment.js';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);

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

export function createLightRig(scene: THREE.Scene, quality: RendererQuality): {
  applyGrade(grade: keyof typeof TOD_GRADES): void;
  update(playerPos: THREE.Vector3, camera?: THREE.Camera): void;
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

  const moonLight = new THREE.DirectionalLight(0x9FB8DD, 0.5);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.width = sunLight.shadow.mapSize.width;
  moonLight.shadow.mapSize.height = sunLight.shadow.mapSize.height;
  moonLight.shadow.camera.left = sunLight.shadow.camera.left;
  moonLight.shadow.camera.right = sunLight.shadow.camera.right;
  moonLight.shadow.camera.top = sunLight.shadow.camera.top;
  moonLight.shadow.camera.bottom = sunLight.shadow.camera.bottom;
  moonLight.shadow.camera.near = sunLight.shadow.camera.near;
  moonLight.shadow.camera.far = sunLight.shadow.camera.far;
  moonLight.shadow.bias = sunLight.shadow.bias;
  moonLight.shadow.normalBias = sunLight.shadow.normalBias;
  scene.add(moonLight);
  scene.add(moonLight.target);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.0);
  scene.add(hemiLight);

  const cameraFill = new THREE.DirectionalLight(0xCFD8E8, 0.35);
  cameraFill.castShadow = false;
  scene.add(cameraFill);
  scene.add(cameraFill.target);

  // Persistent direction vectors — no per-frame allocations (visual bible §6.3).
  const currentSunDir = new THREE.Vector3(0, 1, 0);
  const currentMoonDir = new THREE.Vector3(0, -1, 0);
  const _cameraForward = new THREE.Vector3();

  return {
    sun: sunLight,
    applyGrade(grade: keyof typeof TOD_GRADES) {
      const g = TOD_GRADES[grade];
      sunLight.color.setHex(g.sunColor);

      if (grade === 'night') {
        sunLight.intensity = 0;
        sunLight.castShadow = false;
        moonLight.intensity = g.sunIntensity; // 0.5 from config
        moonLight.castShadow = true;
        moonLight.color.setHex(g.sunColor); // 0x9FB8DD from config
        // Night row of §2.6: the graded "sun" slot describes the MOON
        // (elev 35°, az 270°). The sun itself is parked below the horizon.
        const phi = THREE.MathUtils.degToRad(90 - g.sunElevationDeg);
        const theta = THREE.MathUtils.degToRad(g.sunAzimuthDeg);
        currentMoonDir.setFromSphericalCoords(1, phi, theta);
        currentSunDir.set(0, -1, 0);
      } else {
        sunLight.intensity = g.sunIntensity;
        sunLight.castShadow = true;
        moonLight.intensity = 0;
        moonLight.castShadow = false;
        const phi = THREE.MathUtils.degToRad(90 - g.sunElevationDeg);
        const theta = THREE.MathUtils.degToRad(g.sunAzimuthDeg);
        currentSunDir.setFromSphericalCoords(1, phi, theta);
        currentMoonDir.copy(currentSunDir).negate();
      }
      hemiLight.color.setHex(g.hemiSky);
      hemiLight.groundColor.setHex(g.hemiGround);
      hemiLight.intensity = g.hemiIntensity;
      cameraFill.intensity = g.fillIntensity;
    },
    update(playerPos: THREE.Vector3, camera?: THREE.Camera) {
      sunLight.position.copy(playerPos).addScaledVector(currentSunDir, 300);
      sunLight.target.position.copy(playerPos);

      moonLight.position.copy(playerPos).addScaledVector(currentMoonDir, 300);
      moonLight.target.position.copy(playerPos);

      // Camera fill (§3.1): camera position + camera forward × −50 + up × 30,
      // aimed at the player. Falls back to the player-relative rig when no
      // camera is supplied.
      if (camera) {
        camera.getWorldDirection(_cameraForward);
        cameraFill.position.copy(camera.position).addScaledVector(_cameraForward, -50).addScaledVector(UP, 30);
      } else {
        cameraFill.position.copy(playerPos).addScaledVector(FORWARD, -50).addScaledVector(UP, 30);
      }
      cameraFill.target.position.copy(playerPos);
    }
  };
}
