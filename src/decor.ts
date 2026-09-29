import * as THREE from 'three';

export function createDecor(scene: THREE.Scene) {
  // 1. Instanced Trees/Foliage
  const treeCount = 5000;

  // Simple tree placeholder: a cone top (instanced for simplicity in slice)
  const leavesGeo = new THREE.ConeGeometry(3, 8, 8);
  leavesGeo.translate(0, 4, 0);

  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d4c1e, roughness: 0.9 });
  const treeInstanced = new THREE.InstancedMesh(leavesGeo, leavesMat, treeCount);
  treeInstanced.castShadow = true;
  treeInstanced.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let count = 0;

  // Need to distribute trees based on the same logic as terrain height
  for (let i = 0; i < treeCount * 3; i++) {
    if (count >= treeCount) break;

    const x = (Math.random() - 0.5) * 1000;
    const z = (Math.random() - 0.5) * 1000;

    const valleyShape = Math.pow(Math.abs(x / 500), 2) * 100;
    const noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5 + Math.sin(x * 0.01 + z * 0.02) * 15;
    const riverBed = -Math.exp(-Math.pow(x / 30, 2)) * 10;
    const y = valleyShape + noise + riverBed;

    // Don't place trees in the river or on very steep slopes (simplified here by height limits)
    if (y > 2 && Math.abs(x) > 40) {
      dummy.position.set(x, y, z);
      const scale = 0.5 + Math.random() * 0.5;
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.updateMatrix();
      treeInstanced.setMatrixAt(count, dummy.matrix);
      count++;
    }
  }

  scene.add(treeInstanced);

  // 2. Scattered Rocks
  const rockCount = 2000;
  const rockGeo = new THREE.DodecahedronGeometry(2);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.1 });
  const rockInstanced = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rockInstanced.castShadow = true;
  rockInstanced.receiveShadow = true;

  count = 0;
  for (let i = 0; i < rockCount * 2; i++) {
    if (count >= rockCount) break;

    const x = (Math.random() - 0.5) * 1000;
    const z = (Math.random() - 0.5) * 1000;

    const valleyShape = Math.pow(Math.abs(x / 500), 2) * 100;
    const noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5 + Math.sin(x * 0.01 + z * 0.02) * 15;
    const riverBed = -Math.exp(-Math.pow(x / 30, 2)) * 10;
    const y = valleyShape + noise + riverBed;

    dummy.position.set(x, y + 0.5, z);
    const scale = 0.2 + Math.random() * 1.5;
    dummy.scale.set(scale, scale * (0.5 + Math.random() * 0.5), scale);
    dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    dummy.updateMatrix();
    rockInstanced.setMatrixAt(count, dummy.matrix);
    count++;
  }

  scene.add(rockInstanced);

  // 3. Mist Billboards in low areas
  const mistCount = 200;
  const mistGeo = new THREE.PlaneGeometry(30, 15);
  const mistMat = new THREE.MeshBasicMaterial({
    color: 0xdddddd,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const mistInstanced = new THREE.InstancedMesh(mistGeo, mistMat, mistCount);
  count = 0;
  for (let i = 0; i < mistCount * 2; i++) {
    if (count >= mistCount) break;

    const x = (Math.random() - 0.5) * 400; // closer to river
    const z = (Math.random() - 0.5) * 1000;

    const valleyShape = Math.pow(Math.abs(x / 500), 2) * 100;
    const noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5 + Math.sin(x * 0.01 + z * 0.02) * 15;
    const riverBed = -Math.exp(-Math.pow(x / 30, 2)) * 10;
    const y = valleyShape + noise + riverBed;

    if (y < 10) {
      dummy.position.set(x, y + 5 + Math.random() * 5, z);
      dummy.scale.setScalar(1 + Math.random());
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      mistInstanced.setMatrixAt(count, dummy.matrix);
      count++;
    }
  }

  scene.add(mistInstanced);

  return {
    update: (_camera: THREE.Camera) => {
        // Billboard update could go here
    }
  }
}
