import * as THREE from 'three';

// Seeded RNG: Mulberry32
function mulberry32(a: number) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

export class ParticleSystem {
  private particles: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private count: number;

  constructor(scene: THREE.Scene, type: 'dust' | 'leaves' | 'snow' | 'spray') {
    this.count = 200; // Default

    // Seed the random number generator so particle initial positions/velocities are deterministic
    // Using a seed specific to the type to avoid identical layout across all types
    const seedMap = {
      'dust': 111,
      'leaves': 222,
      'snow': 333,
      'spray': 444
    };
    const random = mulberry32(seedMap[type] || 123);

    // Config based on type
    let color = 0xffffff;
    let size = 0.5;
    let spread = 100;

    // Mapping 'leaves' -> 'pollen', 'snow' -> 'motes' as required by visual bible §5 and prompt
    if (type === 'dust') {
      // Dust in sierra light
      color = 0xd0c0a0;
      size = 0.2;
      spread = 50;
      this.count = 200;
    } else if (type === 'leaves') {
      // Repurposed as pollen in jungle
      color = 0x88aa44; // Pollen green/yellow
      size = 0.4;
      spread = 40;
      this.count = 200;
    } else if (type === 'snow') {
      // Repurposed as motes in cloud forest
      color = 0xffffff;
      size = 0.3;
      spread = 50;
      this.count = 200; // Restrained to 200 per iPhone budget for mist/motes
    } else if (type === 'spray') {
      // Water spray near falls
      color = 0xccddff;
      size = 0.8;
      spread = 30; // Localized
      this.count = 200;
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
      this.positions[i * 3] = (random() - 0.5) * spread;
      this.positions[i * 3 + 1] = random() * 20; // Height
      this.positions[i * 3 + 2] = (random() - 0.5) * spread;

      this.velocities[i * 3] = (random() - 0.5) * 0.05;

      // Update vertical velocity mapping based on new type semantics
      let verticalVel = -0.02 - random() * 0.02;
      if (type === 'snow') verticalVel = -0.01 - random() * 0.01; // motes drift slowly
      else if (type === 'spray') verticalVel = 0.05 + random() * 0.05; // spray goes slightly up then maybe falls (simple drift here)

      this.velocities[i * 3 + 1] = verticalVel;
      this.velocities[i * 3 + 2] = (random() - 0.5) * 0.05;

      if (type === 'leaves') { // pollen
         this.velocities[i*3] += 0.05; // Slight wind bias
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
    else if (type === 'leaves') spread = 40; // pollen
    else if (type === 'snow') spread = 50; // motes
    else if (type === 'spray') spread = 30; // spray

    // Use a fixed pseudo-random to deterministically respawn particles during the frame
    // This isn't perfect since update is called sequentially, but keeping respawn deterministic
    // is tricky if frame rates vary. Assuming fixed timestep or using a hash of index.
    // For visual gate (shot mode), it only renders one frame usually.
    // A simple hash function for deterministic respawn
    const hash = (i: number) => {
        let h = Math.imul(i ^ (i >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };

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
        // Use pseudo-random hash based on index and some offset to scatter them
        // This ensures the respawn behavior is completely deterministic across reloads.
        const r1 = hash(i + 1000);
        const r2 = hash(i + 2000);
        const r3 = hash(i + 3000);

        this.positions[i * 3] = cameraPosition.x + (r1 - 0.5) * spread;
        this.positions[i * 3 + 1] = cameraPosition.y + 10 + r2 * 10;
        this.positions[i * 3 + 2] = cameraPosition.z + (r3 - 0.5) * spread;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}
