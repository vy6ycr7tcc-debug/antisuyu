import * as THREE from 'three';
import { RendererQuality } from './renderer.js';

import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js';

export function setupEnvironment(scene: THREE.Scene, quality: RendererQuality, renderer: THREE.WebGLRenderer | any, todParam: string | null) {
  scene.background = new THREE.Color(0x87b5ff);
  const fogColor = new THREE.Color(0x87b5ff);
  if (todParam === 'dawn') {
    fogColor.setHex(0xd0b49f); // Peachy dawn mist
  } else if (todParam === 'noon') {
    fogColor.setHex(0x9bc0ff); // Light blue haze
  } else if (todParam === 'dusk') {
    fogColor.setHex(0xb28c70); // Warm dusty mist
  }
  scene.fog = new THREE.FogExp2(fogColor, 0.0015); // Slightly denser fog for atmosphere

  // Softer ambient light to allow strong directional shadows
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  hemiLight.color.setHSL(0.6, 0.6, 0.8);
  hemiLight.groundColor.setHSL(0.1, 0.2, 0.1);
  scene.add(hemiLight);

  // Directional sun light
  const sunLight = new THREE.DirectionalLight(0xffffff, 4.5);
  sunLight.color.setHex(0xfff4e5); // Warm sun

  // Time of day setup
  let elevation = 25; // Late afternoon default
  let azimuth = 135;

  if (todParam === 'dawn') {
    elevation = 5;
    sunLight.color.setHex(0xffa500); // Orange tint
    hemiLight.intensity = 0.2;
    sunLight.intensity = 2.0;
  } else if (todParam === 'noon') {
    elevation = 85;
    sunLight.color.setHex(0xffffff); // White
    hemiLight.intensity = 0.6;
    sunLight.intensity = 5.0;
  } else if (todParam === 'dusk') {
    elevation = 5;
    azimuth = -45; // Opposite side
    sunLight.color.setHex(0xff8c00); // Deep orange
    hemiLight.intensity = 0.2;
    sunLight.intensity = 2.0;
  }

  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);

  const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  sunLight.position.copy(sunPosition).multiplyScalar(1000);

  // Cascaded shadows (simplified for now as one large directional shadow)
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = quality.shadowMapSize;
  sunLight.shadow.mapSize.height = quality.shadowMapSize;

  const d = 1500; // Expanded to cover more terrain
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 4000;
  sunLight.shadow.bias = -0.001; // Increase bias to avoid self-shadow artifacts on terrain
  sunLight.shadow.normalBias = 2.0;

  scene.add(sunLight);
  scene.add(sunLight.target);

  // Preetham Model Physical Sky dome
  let sky;
  if (renderer && renderer.isWebGLRenderer) {
    sky = new Sky();
  } else {
    sky = new SkyMesh();
  }
  sky.scale.setScalar(4500);
  scene.add(sky);

  const skyUniforms = (sky as any).material.uniforms || (sky as any).material; // WebGPU NodeMaterial fallback check, though SkyMesh doesn't use uniforms in the same way, we'll set it up correctly below

  if (renderer && renderer.isWebGLRenderer) {
      skyUniforms[ 'turbidity' ].value = 10;
      skyUniforms[ 'rayleigh' ].value = 2;
      skyUniforms[ 'mieCoefficient' ].value = 0.005;
      skyUniforms[ 'mieDirectionalG' ].value = 0.8;
      skyUniforms[ 'sunPosition' ].value.copy(sunPosition);
  } else {
      // SkyMesh for WebGPU uses a different uniform setup, specifically sunPosition is a uniform property or set directly.
      const skyMaterial = (sky as any).material;
      // Depending on TSL setup, turbidity, rayleigh might need to be set differently.
      // Usually SkyMesh handles it via `.turbidity.value = ...`
      if (skyMaterial.turbidity) skyMaterial.turbidity.value = 10;
      if (skyMaterial.rayleigh) skyMaterial.rayleigh.value = 2;
      if (skyMaterial.mieCoefficient) skyMaterial.mieCoefficient.value = 0.005;
      if (skyMaterial.mieDirectionalG) skyMaterial.mieDirectionalG.value = 0.8;
      if (skyMaterial.sunPosition) skyMaterial.sunPosition.value.copy(sunPosition);
  }

  // For WebGL2, we use PMREMGenerator. For WebGPU, we just assign the sky scene directly if supported,
  // or use a DataTexture. To avoid PMREM crash on WebGPU, we check the renderer type.
  if (renderer && renderer.isWebGLRenderer) {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const renderTarget = pmremGenerator.fromScene(scene);
    scene.environment = renderTarget.texture;
  } else {
    // Basic flat environment map for WebGPU
    const data = new Float32Array( 4 * 4 * 4 );
    for(let i=0; i<data.length; i+=4) {
        data[i] = 135/255;
        data[i+1] = 181/255;
        data[i+2] = 255/255;
        data[i+3] = 1.0;
    }
    const dataTexture = new THREE.DataTexture( data, 4, 4, THREE.RGBAFormat, THREE.FloatType );
    dataTexture.colorSpace = THREE.SRGBColorSpace;
    dataTexture.needsUpdate = true;
    scene.environment = dataTexture;
    scene.environmentIntensity = 0.5;
  }
}
