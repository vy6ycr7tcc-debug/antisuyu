import * as THREE from 'three';

export function createTerrain(scene: THREE.Scene) {
  // We use a simplified heightmap approach for the procedural valley (~1 km^2).
  const size = 1000;
  const segments = 256;

  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;

  // Basic procedural height generation (using simple sine waves as a placeholder for noise)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);

    // Create a valley shape
    const valleyShape = Math.pow(Math.abs(x / (size / 2)), 2) * 100;

    // Add some noise
    const noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5 +
                  Math.sin(x * 0.01 + z * 0.02) * 15;

    // Add river bed depression in the middle
    const riverBed = -Math.exp(-Math.pow(x / 30, 2)) * 10;

    position.setY(i, valleyShape + noise + riverBed);
  }

  geometry.computeVertexNormals();

  // Create a splat-mapped PBR material.
  // For the initial vertical slice, we'll use a single material with varied color via vertex colors
  // or just a solid color if we don't have textures.

  // Let's create procedural colors based on height and slope
  const colors = [];
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);

    normal.fromBufferAttribute(geometry.attributes.normal as THREE.BufferAttribute, i);
    const slope = 1.0 - normal.dot(up);

    if (slope > 0.3) {
      // Rock/Scree
      color.setHex(0x555555).lerp(new THREE.Color(0x333333), Math.random());
    } else if (y < 2) {
      // Mud near river
      color.setHex(0x3d2817);
    } else {
      // Grass
      color.setHex(0x4a5d23).lerp(new THREE.Color(0x3a4d13), Math.random() * 0.5);
    }

    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.1,
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;

  scene.add(terrain);

  return terrain;
}
