import * as THREE from 'three';

import { RendererQuality } from './renderer.js';

export function setupEnvironment(scene: THREE.Scene, quality: RendererQuality) {
  // WebGPURenderer does not support ShaderMaterial like Sky from examples easily yet without NodeMaterial.
  // Instead, let's create a physical sky appearance using scene background and fog to match the vibe.

  scene.background = new THREE.Color(0x87CEEB); // Sky blue
  // Late afternoon settings
  const elevation = 15;
  const azimuth = 180;

  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);

  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

  // Directional sun light
  const sunLight = new THREE.DirectionalLight(0xffffff, 2.5);
  sunLight.color.setHSL(0.1, 0.5, 0.9); // Warm tint
  sunLight.position.copy(sunPosition).multiplyScalar(1000);

  // Cascaded shadows (simplified for now as one large directional shadow)
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = quality.shadowMapSize;
  sunLight.shadow.mapSize.height = quality.shadowMapSize;

  const d = 500;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.camera.near = 0.1;
  sunLight.shadow.camera.far = 2000;
  sunLight.shadow.bias = -0.0005;

  scene.add(sunLight);
  scene.add(sunLight.target);

  // Ambient light for fill
  const ambientLight = new THREE.AmbientLight(0x404040, 1.5);
  scene.add(ambientLight);

  // Atmosphere fog
  scene.fog = new THREE.FogExp2(0x90a0b0, 0.002);
}
