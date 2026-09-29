import * as THREE from 'three';

export function createRiver(scene: THREE.Scene) {
  // A river plane running through the valley
  const length = 1000;
  const width = 40;

  const geometry = new THREE.PlaneGeometry(width, length, 10, 100);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.MeshPhysicalMaterial({
    color: 0x335566,
    metalness: 0.1,
    roughness: 0.1,
    transparent: true,
    opacity: 0.8,
    transmission: 0.9, // Glass-like
    ior: 1.33,
  });

  const river = new THREE.Mesh(geometry, material);

  // Position it slightly above the riverbed depression
  river.position.y = 0.5;
  river.receiveShadow = true;

  scene.add(river);

  return {
    mesh: river,
    update: (_time: number) => {
      // In a real scenario we'd update uniforms.time here
    }
  };
}
