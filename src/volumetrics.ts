import * as THREE from 'three';

export class VolumetricLightShafts {
  private group: THREE.Group;

  constructor(scene: THREE.Scene, todParam: string | null) {
    this.group = new THREE.Group();

    // Determine intensity based on time of day
    let intensity = 0.05;
    if (todParam === 'dawn' || todParam === 'dusk') {
       intensity = 0.15; // Strongest at dawn/dusk
    } else if (todParam === 'noon') {
       intensity = 0.02; // Subtle at noon
    }

    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Linear gradient for light shaft
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, `rgba(255, 240, 220, ${intensity})`);
    gradient.addColorStop(1, 'rgba(255, 240, 220, 0)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 256);

    const texture = new THREE.CanvasTexture(canvas);

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // Create a few planes arranged radially
    const planesCount = 3;
    const geometry = new THREE.PlaneGeometry(20, 100);

    for (let i = 0; i < 5; i++) { // 5 clusters of shafts
      const cluster = new THREE.Group();

      for (let j = 0; j < planesCount; j++) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.y = (j / planesCount) * Math.PI;
        // Shift pivot to top
        mesh.geometry.translate(0, -50, 0);
        cluster.add(mesh);
      }

      cluster.position.set(
        (Math.random() - 0.5) * 200,
        50 + Math.random() * 20,
        (Math.random() - 0.5) * 200
      );

      // Angle shafts to match sun direction (approx)
      let sunZ = -0.5;
      let sunX = 0.5;
      if (todParam === 'dawn') { sunZ = -0.8; sunX = -0.8; }
      else if (todParam === 'dusk') { sunZ = 0.8; sunX = 0.8; }
      else if (todParam === 'noon') { sunZ = 0.1; sunX = 0.1; }

      cluster.lookAt(cluster.position.x + sunX, cluster.position.y - 1, cluster.position.z + sunZ);
      this.group.add(cluster);
    }

    scene.add(this.group);
  }

  update(_cameraPosition: THREE.Vector3) {
      // Shafts could slowly drift or follow camera loosely, but keeping static for now is cheaper
  }
}
