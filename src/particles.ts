import * as THREE from 'three';
import type { RenderCaps } from './renderer.js';

// V-ATMOS — biome particle systems (visual bible §5.2 T7, §6.3, J7).
//
// §5.2 T7: "identical THREE.Points CPU-simulated system on both paths" —
// one code path, no TSL, counts low enough that compute is unnecessary.
//
// Determinism (J7 + the §8.3 motion-ready gate): the old system seeded its
// INITIAL layout but integrated with wall-frame deltas and respawned via an
// index hash — positions depended on how many frames happened to run before
// a capture. This rewrite integrates with a FIXED timestep driven by the
// explicit clock argument (main.ts passes ?t= in shot mode, the play clock
// otherwise), so two captures at t=0 / t=4 differ by exactly 4 s of sim and
// nothing else. Respawn is a modulo WRAP into a camera-centered box — no
// hash, no popping, no per-frame allocations.
//
// Counts (§6.3 particles row): "Snow 400→150 on LOW" is normative and maps
// to the motes system (the snow type's in-game use); the other systems scale
// proportionally (200→80) — judgment call, documented in the PR.
//
// Biome mapping (main.ts visibility gate): dust → high_sierra (dust in
// sierra light), leaves/pollen → jungle_lowlands, snow/motes → cloud_forest.
// spray stays contract-complete but unwired — no cascade fires in this
// height field (p5 measured it dormant); wiring it to region waterfalls
// folds into V-REG1/V-REG2.

export type ParticleType = 'dust' | 'leaves' | 'snow' | 'spray';

// [HIGH/MEDIUM count, LOW count]
const COUNTS: Record<ParticleType, [number, number]> = {
  dust:   [200, 80],
  leaves: [200, 80],
  snow:   [400, 150], // §6.3 verbatim (motes)
  spray:  [200, 80],
};

interface Profile {
  color: number;
  size: number;
  spread: number;   // camera-centered box edge length (m)
  opacity: number;
  vyMin: number;    // m/s
  vyMax: number;
  windX: number;
  windZ: number;
  flutter: number;  // lateral sinusoid amplitude (m/s)
}

const PROFILES: Record<ParticleType, Profile> = {
  // Sierra: sparse backlit dust hanging in hard light, slow settle.
  // spread is a look-dev dial (§6.3 pins COUNTS, not spread): 36 m keeps
  // enough motes inside the view cone to read at eye scale — the first
  // probe's 50 m box put 200 points mostly out of frame (presence A/B
  // measured 0.066 mean|d| = structurally present, visually absent).
  dust:   { color: 0xe8dcc8, size: 0.4, spread: 36, opacity: 0.55, vyMin: -0.012, vyMax: -0.004, windX: 0.010, windZ: 0.004, flutter: 0.008 },
  // Jungle: wind-biased pollen with visible flutter.
  leaves: { color: 0x88aa44, size: 0.35, spread: 30, opacity: 0.55, vyMin: -0.050, vyMax: -0.020, windX: 0.050, windZ: 0.010, flutter: 0.030 },
  // Cloud forest: near-weightless motes drifting in the mist.
  snow:   { color: 0xffffff, size: 0.30, spread: 36, opacity: 0.5,  vyMin: -0.010, vyMax: -0.005, windX: 0.004, windZ: 0.002, flutter: 0.012 },
  // Falls spray: rises, then falls (contract-complete; unwired — see header).
  spray:  { color: 0xccddff, size: 0.60, spread: 30, opacity: 0.5,  vyMin: -0.030, vyMax:  0.060, windX: 0.010, windZ: 0.000, flutter: 0.010 },
};

const SEEDS: Record<ParticleType, number> = { dust: 111, leaves: 222, snow: 333, spray: 444 };

const DT = 1 / 30;        // fixed sim step (s)
const MAX_STEPS = 1800;   // ≥ 60 s of catch-up; beyond, snap (documented)
const Y_BELOW = 8;        // wrap band below the camera (m)
const Y_ABOVE = 14;       // wrap band above the camera (m)

function mulberry32(a: number) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

function wrap(v: number, min: number, max: number): number {
  const range = max - min;
  let r = (v - min) % range;
  if (r < 0) r += range;
  return min + r;
}

function createSpriteTexture(): THREE.CanvasTexture {
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
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ParticleSystem {
  private obj: THREE.Points;
  private positions: Float32Array;
  private velocities: Float32Array;
  private phases: Float32Array;
  private count: number;
  private type: ParticleType;
  private spread: number;
  private simTime = 0;

  constructor(scene: THREE.Scene, type: ParticleType, caps?: RenderCaps) {
    this.type = type;
    const profile = PROFILES[type];
    this.spread = profile.spread;
    this.count = caps?.tier === 'LOW' ? COUNTS[type][1] : COUNTS[type][0];

    const random = mulberry32(SEEDS[type]);
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.phases = new Float32Array(this.count);

    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.positions[k]     = (random() - 0.5) * this.spread;
      this.positions[k + 1] = random() * 20;
      this.positions[k + 2] = (random() - 0.5) * this.spread;
      this.velocities[k]     = (random() - 0.5) * 0.05;
      this.velocities[k + 1] = profile.vyMin + random() * (profile.vyMax - profile.vyMin);
      this.velocities[k + 2] = (random() - 0.5) * 0.05;
      this.phases[i] = random() * Math.PI * 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    const material = new THREE.PointsMaterial({
      size: profile.size,
      map: createSpriteTexture(),
      color: profile.color,
      // NormalBlending, not additive: the p4 mist lesson (measured again in
      // this session's presence A/B — additive white over a bright day sky
      // contributes ~0.1 mean|d|, i.e. invisible; the §8.3 presence gate
      // failed until this switch). Normal-blended sprites read as lit
      // organic matter against sky AND shadow, with no glow halo (§4.4).
      blending: THREE.NormalBlending,
      transparent: true,
      opacity: profile.opacity,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.obj = new THREE.Points(geometry, material);
    // Positions re-wrap around the camera every update — the stale bounding
    // sphere must never cull the field.
    this.obj.frustumCulled = false;
    scene.add(this.obj);
  }

  get points(): THREE.Points {
    return this.obj;
  }

  /** Advance the sim deterministically to `timeSeconds`, then re-wrap around the camera. */
  update(cameraPosition: THREE.Vector3, timeSeconds: number) {
    let steps = Math.floor((timeSeconds - this.simTime) / DT);
    if (steps > MAX_STEPS) {
      // Fast-forward beyond the catch-up budget: snap instead of simulating
      // (positions re-wrap below; determinism guaranteed only within 60 s,
      // which covers every §8 capture pair).
      this.simTime = timeSeconds;
    }
    while (steps > 0 && steps <= MAX_STEPS) {
      const t = this.simTime + DT;
      const p = this.positions;
      const v = this.velocities;
      const ph = this.phases;
      const profile = PROFILES[this.type];
      for (let i = 0; i < this.count; i++) {
        const k = i * 3;
        p[k]     += (v[k] + profile.windX + Math.sin(t * 1.7 + ph[i]) * profile.flutter) * DT;
        p[k + 1] += v[k + 1] * DT;
        p[k + 2] += (v[k + 2] + profile.windZ + Math.cos(t * 1.3 + ph[i]) * profile.flutter) * DT;
      }
      this.simTime = t;
      steps--;
    }
    this.rewrap(cameraPosition);
  }

  /** Keep every particle inside the camera-centered box (modulo wrap — deterministic). */
  private rewrap(cameraPosition: THREE.Vector3) {
    const half = this.spread / 2;
    const minX = cameraPosition.x - half, maxX = cameraPosition.x + half;
    const minZ = cameraPosition.z - half, maxZ = cameraPosition.z + half;
    const minY = cameraPosition.y - Y_BELOW, maxY = cameraPosition.y + Y_ABOVE;
    const p = this.positions;
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      p[k]     = wrap(p[k], minX, maxX);
      p[k + 1] = wrap(p[k + 1], minY, maxY);
      p[k + 2] = wrap(p[k + 2], minZ, maxZ);
    }
    (this.obj.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
