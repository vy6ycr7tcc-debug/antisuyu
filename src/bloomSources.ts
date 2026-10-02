import * as THREE from 'three';

// Phase 12 (p9 flag, §5.4): SELECTIVE bloom — the bloom source is the scene
// MINUS the sky dome (layer-masked), so the day-sky radiance (HDR 2–50, the
// p9 measurement) never reaches the high-pass, while every lamp, prop and
// sunlit surface keeps its natural §5.4 bloom through the proven whole-scene
// blur path (the main composer's UnrealBloomPass, verified by the p9 chain).
//
// (v1 of this module used a proxy-emitter scene — MeshBasicMaterial copies of
// the lamp heads on an empty background. Measured out: UnrealBloom's mip
// pyramid dilutes isolated sub-20 px emitters to nothing (lamp halo < 8
// display levels at §5.4 strength, vs the p9 chain's max +174 from the same
// lamps), and enlarging the emitters to restore blur energy floods ~15% of
// the frame. The p9 halo comes from the REAL lamp pixels, so the real scene
// is the right source — with only the sky excluded.)

export const SKY_LAYER = 1;

let camera: THREE.PerspectiveCamera | null = null;

export function initBloomCamera(src: THREE.PerspectiveCamera): THREE.PerspectiveCamera {
  // The sky dome moves to SKY_LAYER; the main camera must still see it.
  src.layers.enable(SKY_LAYER);
  camera = src.clone();
  // Object3D.copy SHARES the Layers object with the source — give the clone
  // its own mask minus the sky bit, so the dome (and only the dome) stays out
  // of the bloom source.
  camera.layers = new THREE.Layers();
  camera.layers.mask = src.layers.mask & ~(1 << SKY_LAYER);
  return camera;
}

// Called by environment.ts when the dome is created — moves it (and only it)
// to SKY_LAYER. Everything else in the world stays on the default layer and
// keeps feeding the bloom source.
export function registerSkyDome(sky: THREE.Mesh): void {
  sky.layers.set(SKY_LAYER);
}

// The proxy pass renders from her exact viewpoint: pose + projection are
// synced from the main camera before every post render (and on resize).
export function syncBloomCamera(src: THREE.PerspectiveCamera): void {
  if (!camera) return;
  camera.position.copy(src.position);
  camera.quaternion.copy(src.quaternion);
  if (camera.fov !== src.fov || camera.aspect !== src.aspect || camera.near !== src.near || camera.far !== src.far) {
    camera.fov = src.fov;
    camera.aspect = src.aspect;
    camera.near = src.near;
    camera.far = src.far;
  }
  camera.updateProjectionMatrix();
}

export function getBloomCamera(): THREE.PerspectiveCamera | null {
  return camera;
}
