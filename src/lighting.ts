import * as THREE from 'three';
import { RendererQuality } from './renderer.js';
import { TOD_GRADES, LightRigConfig } from './environment.js';

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

  const moonLight = new THREE.DirectionalLight(0x9FB8DD, 0.5);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.width = quality.shadowMapSize;
  moonLight.shadow.mapSize.height = quality.shadowMapSize;
  moonLight.shadow.camera.left = -d;
  moonLight.shadow.camera.right = d;
  moonLight.shadow.camera.top = d;
  moonLight.shadow.camera.bottom = -d;
  moonLight.shadow.camera.near = 10;
  moonLight.shadow.camera.far = 800;
  moonLight.shadow.bias = -0.0005;
  moonLight.shadow.normalBias = 1.5;
  scene.add(moonLight);
  scene.add(moonLight.target);

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

      if (grade === 'night') {
        sunLight.visible = false;
        moonLight.visible = true;
      } else {
        sunLight.visible = true;
        moonLight.visible = false;
      }

      const phi = THREE.MathUtils.degToRad(90 - g.sunElevationDeg);
      const theta = THREE.MathUtils.degToRad(g.sunAzimuthDeg);
      currentSunDir.setFromSphericalCoords(1, phi, theta);
    },
    update(playerPos: THREE.Vector3) {
      sunLight.position.copy(playerPos).addScaledVector(currentSunDir, 300);
      sunLight.target.position.copy(playerPos);
      moonLight.position.copy(playerPos).addScaledVector(currentSunDir, -300);
      moonLight.target.position.copy(playerPos);

      const cameraForward = new THREE.Vector3(0, 0, -1);
      const up = new THREE.Vector3(0, 1, 0);
      cameraFill.position.copy(playerPos).addScaledVector(cameraForward, -50).addScaledVector(up, 30);
    }
  };
}
// END RIG DELIMITER
