import * as THREE from 'three';

export function createTerrain(scene: THREE.Scene) {
  const size = 1000;
  const segments = 256;

  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);

    const valleyShape = Math.pow(Math.abs(x / (size / 2)), 2) * 100;

    const noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5 +
                  Math.sin(x * 0.01 + z * 0.02) * 15;

    const riverBed = -Math.exp(-Math.pow(x / 30, 2)) * 10;

    position.setY(i, valleyShape + noise + riverBed);
  }

  geometry.computeVertexNormals();

  const colors = [];
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();

  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);

    normal.fromBufferAttribute(geometry.attributes.normal as THREE.BufferAttribute, i);
    const slope = 1.0 - normal.dot(up);

    if (slope > 0.4) {
      // Rock/Scree
      color.setHex(0x404040).lerp(new THREE.Color(0x2a2a2a), Math.random());
    } else if (y < 3) {
      // River edge mud
      color.setHex(0x382a1d).lerp(new THREE.Color(0x281e14), Math.random());
    } else {
      // Lush cloud forest greenery
      color.setHex(0x294218).lerp(new THREE.Color(0x3e5e26), Math.random());
    }

    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    envMapIntensity: 1.0
  });

  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = true;

  scene.add(terrain);

  return terrain;
}
