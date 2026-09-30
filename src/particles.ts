import * as THREE from 'three';

export class ParticleSystem {
  private particles: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private count: number;

  constructor(scene: THREE.Scene, type: 'dust' | 'leaves' | 'snow' | 'spray') {
    this.count = 200; // Modest count

    // Config based on type
    let color = 0xffffff;
    let size = 0.5;
    let spread = 100;

    if (type === 'dust') {
      color = 0xd0c0a0;
      size = 0.2;
      spread = 50;
    } else if (type === 'leaves') {
      color = 0x4a5d23;
      size = 0.4;
      spread = 40;
    } else if (type === 'snow') {
      color = 0xffffff;
      size = 0.3;
      spread = 200; // Sierra wide
      this.count = 400;
    } else if (type === 'spray') {
      color = 0xccddff;
      size = 0.8;
      spread = 30; // River localized
    }

    // Soft radial gradient sprite
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const texture = new THREE.CanvasTexture(canvas);

    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);

    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * spread;
      this.positions[i * 3 + 1] = Math.random() * 20; // Height
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * spread;

      this.velocities[i * 3] = (Math.random() - 0.5) * 0.05;
      this.velocities[i * 3 + 1] = (type === 'snow' ? -0.1 : -0.02) - Math.random() * 0.02;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.05;

      if (type === 'leaves') {
         this.velocities[i*3] += 0.1; // Wind bias
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const material = new THREE.PointsMaterial({
      size: size,
      map: texture,
      color: color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.6,
      depthWrite: false
    });

    this.particles = new THREE.Points(geometry, material);
    scene.add(this.particles);
  }

  update(cameraPosition: THREE.Vector3, type: 'dust' | 'leaves' | 'snow' | 'spray') {
    let spread = 100;
    if (type === 'dust') spread = 50;
    else if (type === 'leaves') spread = 40;
    else if (type === 'snow') spread = 200;
    else if (type === 'spray') spread = 30;

    for (let i = 0; i < this.count; i++) {
      this.positions[i * 3] += this.velocities[i * 3];
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1];
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2];

      // Respawn if too low or too far from camera
      let respawn = false;
      if (this.positions[i * 3 + 1] < 0) respawn = true;

      const dx = this.positions[i * 3] - cameraPosition.x;
      const dz = this.positions[i * 3 + 2] - cameraPosition.z;
      if (Math.sqrt(dx * dx + dz * dz) > spread / 2) {
         respawn = true;
      }

      if (respawn) {
        this.positions[i * 3] = cameraPosition.x + (Math.random() - 0.5) * spread;
        this.positions[i * 3 + 1] = cameraPosition.y + 10 + Math.random() * 10;
        this.positions[i * 3 + 2] = cameraPosition.z + (Math.random() - 0.5) * spread;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}
