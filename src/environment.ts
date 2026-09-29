import * as THREE from 'three';
import { RendererQuality } from './renderer.js';

export function setupEnvironment(scene: THREE.Scene, quality: RendererQuality) {
  scene.background = new THREE.Color(0x87b5ff);
  scene.fog = new THREE.FogExp2(0x87b5ff, 0.001);

  // Softer ambient light to allow strong directional shadows
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  hemiLight.color.setHSL(0.6, 0.6, 0.8);
  hemiLight.groundColor.setHSL(0.1, 0.2, 0.1);
  scene.add(hemiLight);

  // Directional sun light
  const sunLight = new THREE.DirectionalLight(0xffffff, 4.5);
  sunLight.color.setHex(0xfff4e5); // Warm sun

  // High elevation for late morning/early afternoon look
  const elevation = 50;
  const azimuth = 135;

  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);

  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
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
  sunLight.shadow.camera.near = 100;
  sunLight.shadow.camera.far = 3000;
  sunLight.shadow.bias = -0.0005;

  scene.add(sunLight);
  scene.add(sunLight.target);

  // Physical-looking Sky dome
  const skyGeo = new THREE.SphereGeometry(2000, 32, 15);
  const skyColors = [];
  const topColor = new THREE.Color(0x1a4b8c); // Deep blue at zenith
  const bottomColor = new THREE.Color(0x87b5ff); // Lighter blue at horizon
  const color = new THREE.Color();

  const pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const h = Math.max(0, Math.min(1, (y + 100) / 400)); // normalized height
    color.copy(bottomColor).lerp(topColor, h);
    skyColors.push(color.r, color.g, color.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));

  const skyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);
}
