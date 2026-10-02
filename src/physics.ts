import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { mulberry32 } from './textures.js';
import { waterSurfaceY, WATER_FLOW } from './river.js';

// Buoyancy classes (Phase 12, p5 flag). K = net upward acceleration at full
// submergence, in g — equilibrium submerged fraction is f = 1/K:
//   wood  1.6 → floats ~62% submerged (log waterline just above the surface)
//   stone 0.25 → sinks (net −0.75 g at f = 1) — rockslide behavior preserved
const BUOY_WOOD = 1.6;
const BUOY_STONE = 0.25;
// Seeded streams (J7): spawn layouts must reproduce exactly across page loads
// so capture det pairs stay 0.000%.
const P12_SEED_DEBRIS = 0x6C06;
const P12_SEED_ROCKSLIDE = 0x510E5;

export class PhysicsSystem {
  world: RAPIER.World | null = null;
  private isFallback = false;

  // Storage for physics-driven meshes. mass/halfY/buoyK feed the Phase 12
  // buoyancy model: halfY = half the collider's VERTICAL extent (submersion
  // denominator), buoyK = wood/stone class (defaults stone = sink).
  private rigidBodies: { mesh: THREE.Object3D, body: RAPIER.RigidBody, mass: number, halfY: number, buoyK: number }[] = [];

  // Used for raycasting
  private ray: RAPIER.Ray | null = null;

  async init() {
    try {
      await RAPIER.init();
      const gravity = { x: 0.0, y: -9.81, z: 0.0 };
      this.world = new RAPIER.World(gravity);
      this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
      console.log('Rapier WASM initialized successfully.');
    } catch (e) {
      console.warn('Rapier WASM failed to load, falling back to dummy physics', e);
      this.isFallback = true;
    }
  }

  getRapier() {
    return this.isFallback ? null : RAPIER;
  }

  raycastDown(x: number, y: number, z: number, maxDistance: number = 100,
              excludeBody?: RAPIER.RigidBody): number | null {
      if (this.isFallback || !this.world || !this.ray) return null;

      this.ray.origin.x = x;
      this.ray.origin.y = y;
      this.ray.origin.z = z;

      // excludeBody: the caller's own rigid body. The character's ground probe
      // starts 2 m above her feet — inside/above her own kinematic capsule —
      // and without the exclusion the ray hits HER, returning the capsule-top
      // height (y + 0.9): the character then "stands" on herself and levitates
      // +0.9 m per update (measured: shot-mode catch-up lifted her exactly
      // 0.9 m/step until the probe plateaued). Same failure every play frame.
      const hit = this.world.castRay(this.ray, maxDistance, true,
          RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined,
          excludeBody ?? undefined);
      if (hit) {
          return y - hit.timeOfImpact;
      }
      return null;
  }

  private timeAccumulator: number = 0;
  private timeStep: number = 1.0 / 60.0;

  update(dt: number) {
    if (this.isFallback || !this.world) return;

    // Fixed time accumulator for 60Hz steps
    this.timeAccumulator += dt;
    while (this.timeAccumulator >= this.timeStep) {

       // Phase 12 (p5 flag): buoyancy force model, applied in the fixed step
       // loop before stepping. Replaces the bot-era block whose constants
       // pre-dated the rebuilt river (hardcoded surface y=0.5, channel test
       // |x|<20, raw depth×500 impulse, 20 m/s-per-step flow kick) — under
       // which p5 measured logs resting on the trench bed ~6 m below the
       // surface. Now: the water surface comes from the SAME channel solve
       // the water mesh renders (river.ts waterSurfaceY; null = dry), and the
       // vertical force is a submerged-fraction spring toward f = 1/K:
       //   a_up = g·K·f − (1.5·f)·v_y,  impulse J = m·a·dt
       // so a log at f = 0.625 (K_wood 1.6) rests with its center 0.375 m
       // below the surface and settles under drag instead of launching.
       // Horizontal flow is a gentle acceleration along WATER_FLOW (−Z), not
       // the legacy 20 m/s per step kick.
       for (let i = 0; i < this.rigidBodies.length; i++) {
           const b = this.rigidBodies[i];
           if (!b.body.isDynamic()) continue;

           const pos = b.body.translation();
           const surface = waterSurfaceY(pos.x, pos.z);

           if (surface === null) {
               b.body.setLinearDamping(0.5);
               b.body.setAngularDamping(0.5);
               continue;
           }

           // Submerged fraction of the collider's vertical extent
           const f = THREE.MathUtils.clamp(
               (surface - pos.y + b.halfY) / (2 * b.halfY), 0, 1);

           if (f > 0) {
               const lin = b.body.linvel();
               const aUp = 9.81 * b.buoyK * f - lin.y * 1.5 * f;
               const flowA = 1.2 * f;
               b.body.applyImpulse({
                   x: b.mass * WATER_FLOW.x * flowA * this.timeStep,
                   y: b.mass * aUp * this.timeStep,
                   z: b.mass * WATER_FLOW.z * flowA * this.timeStep
               }, true);
           }

           b.body.setLinearDamping(2.0);
           b.body.setAngularDamping(2.0);
       }

       this.world.step();
       this.timeAccumulator -= this.timeStep;
    }

    // Rockslide despawn/pool logic
    for (let i = this.rigidBodies.length - 1; i >= 0; i--) {
        const b = this.rigidBodies[i];
        if (b.body.translation().y < -50) {
            // Despawn
            if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
            this.world.removeRigidBody(b.body);
            this.rigidBodies.splice(i, 1);
        }
    }

    // Sync bodies
    for (let i = 0; i < this.rigidBodies.length; i++) {
      const { mesh, body } = this.rigidBodies[i];
      if (body.isSleeping()) continue;

      const pos = body.translation();
      const rot = body.rotation();
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  }

  createTerrainCollider(mesh: THREE.Mesh): { body: RAPIER.RigidBody, collider: RAPIER.Collider } | null {
    if (this.isFallback || !this.world) return null;

    const geometry = mesh.geometry;
    // We need to bake the mesh's position offset into the vertices for a fixed collider
    const vertices = new Float32Array(geometry.attributes.position.array.length);
    const posAttr = geometry.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      vertices[i * 3] = posAttr.getX(i) + mesh.position.x;
      vertices[i * 3 + 1] = posAttr.getY(i) + mesh.position.y;
      vertices[i * 3 + 2] = posAttr.getZ(i) + mesh.position.z;
    }

    let indices: Uint32Array;
    if (geometry.index) {
      indices = new Uint32Array(geometry.index.array);
    } else {
      indices = new Uint32Array(vertices.length / 3);
      for (let i = 0; i < indices.length; i++) {
        indices[i] = i;
      }
    }

    const rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
    const rigidBody = this.world.createRigidBody(rigidBodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
    const collider = this.world.createCollider(colliderDesc, rigidBody);

    return { body: rigidBody, collider };
  }

  removeTerrainCollider(data: { body: RAPIER.RigidBody, collider: RAPIER.Collider }) {
    if (this.isFallback || !this.world) return;
    this.world.removeCollider(data.collider, false);
    this.world.removeRigidBody(data.body);
  }

  createRopeBridge(scene: THREE.Scene, start: THREE.Vector3, end: THREE.Vector3) {
    if (this.isFallback || !this.world) return;

    const numPlanks = 10;
    const bridgeVec = new THREE.Vector3().subVectors(end, start);
    const bridgeLength = bridgeVec.length();
    const plankLength = bridgeLength / numPlanks;
    const plankWidth = 4.0;
    const plankThickness = 0.2;
    const gap = 0.2; // slight gap for joints

    const material = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 1.0 });
    const geometry = new THREE.BoxGeometry(plankWidth, plankThickness, plankLength - gap);

    // Compute rotation so planks face along the bridge vector
    const dummy = new THREE.Object3D();
    dummy.position.copy(start);
    dummy.lookAt(end);

    let prevBody: RAPIER.RigidBody | null = null;

    // Anchor body at start
    const startAnchorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(start.x, start.y, start.z);
    const startAnchorBody = this.world.createRigidBody(startAnchorDesc);

    prevBody = startAnchorBody;

    for (let i = 0; i < numPlanks; i++) {
      // Offset from start
      const t = (i + 0.5) / numPlanks;
      const pos = start.clone().lerp(end, t);

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(pos);
      mesh.quaternion.copy(dummy.quaternion);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, pos.y, pos.z)
        .setRotation({ x: dummy.quaternion.x, y: dummy.quaternion.y, z: dummy.quaternion.z, w: dummy.quaternion.w })
        .setLinearDamping(0.5) // helps stabilize
        .setAngularDamping(0.5);

      const body = this.world.createRigidBody(rigidBodyDesc);

      // Plank collider
      const colliderDesc = RAPIER.ColliderDesc.cuboid(plankWidth / 2, plankThickness / 2, (plankLength - gap) / 2);
      colliderDesc.setMass(10.0); // Make them somewhat heavy
      this.world.createCollider(colliderDesc, body);

      // Planks are wood (Phase 12): if one drops into the trench it floats.
      // halfY = the plank's vertical half-extent (thickness/2), not size/2 —
      // the collider is cuboid(w/2, t/2, l/2).
      this.rigidBodies.push({ mesh, body, mass: 10.0, halfY: plankThickness / 2, buoyK: BUOY_WOOD });

      // Create joint to previous body
      // We want to anchor at the edge of the plank. Local Z is along the bridge (because lookAt(end)).
      const localAnchor1 = prevBody === startAnchorBody ? { x: 0, y: 0, z: 0 } : { x: 0, y: 0, z: (plankLength - gap) / 2 + gap / 2 };
      const localAnchor2 = { x: 0, y: 0, z: -(plankLength - gap) / 2 - gap / 2 };

      const jointData = RAPIER.JointData.spherical(localAnchor1, localAnchor2);
      this.world.createImpulseJoint(jointData, prevBody, body, true);

      prevBody = body;
    }

    // Anchor body at end
    const endAnchorDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(end.x, end.y, end.z);
    const endAnchorBody = this.world.createRigidBody(endAnchorDesc);
    const finalJointData = RAPIER.JointData.spherical({ x: 0, y: 0, z: (plankLength - gap) / 2 + gap / 2 }, { x: 0, y: 0, z: 0 });
    this.world.createImpulseJoint(finalJointData, prevBody, endAnchorBody, true);
  }

  spawnBuoyantDebris(scene: THREE.Scene, numObjects: number = 5) {
      if (this.isFallback || !this.world) return;

      const geometry = new THREE.CylinderGeometry(0.5, 0.5, 3, 8);
      geometry.rotateZ(Math.PI / 2);
      const material = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.8 });

      // J7: seeded spawn layout (was Math.random()) — det pairs must repeat.
      const rng = mulberry32(P12_SEED_DEBRIS);
      // Spawn INSIDE the flooded trench (the p5 rebuild: water where
      // waterSurfaceY ≠ null, 6 m deep at the centerline), just above the
      // measured surface — the old ±5 m blanket box straddled the banks.
      for (let i = 0; i < numObjects; i++) {
        const x = (rng() - 0.5) * 8;
        const z = (rng() - 0.5) * 8;
        const surface = waterSurfaceY(x, z) ?? 0;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, surface + 0.8 + rng() * 0.8, z);
        mesh.rotation.y = rng() * Math.PI;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        // Wood class (K 1.6): floats ~62% submerged. Collider box size 3 →
        // halfY 1.5, so equilibrium center sits 0.375 m below the surface.
        this.addDynamicMeshWithBuoyancy(mesh, 5.0, 'box', 3.0, BUOY_WOOD, 1.5);
      }
  }

  spawnRockslide(scene: THREE.Scene, x: number, z: number, y: number) {
    if (this.isFallback || !this.world) return;

    // Create multiple rocks
    const numRocks = 15;
    const material = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.1 });

    // J7: seeded rock field (was Math.random()) — the canonical rockslide
    // shot must reproduce exactly (p12 det pair). Stone class: still sinks
    // through any water it reaches (K 0.25).
    const rng = mulberry32(P12_SEED_ROCKSLIDE);
    for (let i = 0; i < numRocks; i++) {
      const radius = 1.0 + rng() * 1.5;
      const geometry = new THREE.DodecahedronGeometry(radius, 1);
      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(
        x + (rng() - 0.5) * 10,
        y + rng() * 5,
        z + (rng() - 0.5) * 10
      );

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const body = this.addDynamicMesh(mesh, radius * radius * 100, 'sphere', radius);
      if (body) {
        // Give it a little initial push down the slope
        body.applyImpulse({ x: rng() * 500, y: 0, z: rng() * 500 }, true);
      }
    }
  }

  addDynamicMesh(mesh: THREE.Object3D, mass: number = 1.0, shape: 'sphere' | 'box' = 'box', size: number = 1.0): RAPIER.RigidBody | null {
    if (this.isFallback || !this.world) return null;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
        .setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w });

    const body = this.world.createRigidBody(rigidBodyDesc);

    let colliderDesc;
    if (shape === 'sphere') {
        colliderDesc = RAPIER.ColliderDesc.ball(size);
    } else {
        colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2);
    }

    colliderDesc.setMass(mass);
    this.world.createCollider(colliderDesc, body);

    this.rigidBodies.push({ mesh, body, mass, halfY: size / 2, buoyK: BUOY_STONE });
    return body;
  }

  addDynamicMeshWithBuoyancy(mesh: THREE.Object3D, mass: number, shape: 'sphere' | 'box', size: number,
                             buoyK: number, halfY: number): RAPIER.RigidBody | null {
    if (this.isFallback || !this.world) return null;

    const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
        .setRotation({ x: mesh.quaternion.x, y: mesh.quaternion.y, z: mesh.quaternion.z, w: mesh.quaternion.w });

    const body = this.world.createRigidBody(rigidBodyDesc);

    let colliderDesc;
    if (shape === 'sphere') {
        colliderDesc = RAPIER.ColliderDesc.ball(size);
    } else {
        colliderDesc = RAPIER.ColliderDesc.cuboid(size / 2, size / 2, size / 2);
    }

    colliderDesc.setMass(mass);
    this.world.createCollider(colliderDesc, body);

    this.rigidBodies.push({ mesh, body, mass, halfY, buoyK });
    return body;
  }

  // Phase 12 probe (p5 flag): per-body state + the water surface under the
  // same channel solve the mesh renders. Exposed via window.__buoyancyProbe
  // in &shot=buoyancy only (main.ts) — the float-equilibrium evidence.
  probeBodies(): { x: number; y: number; z: number; vy: number; surface: number | null }[] {
    return this.rigidBodies.map((b) => {
      const p = b.body.translation();
      return { x: p.x, y: p.y, z: p.z, vy: b.body.linvel().y, surface: waterSurfaceY(p.x, p.z) };
    });
  }
}

export const physics = new PhysicsSystem();
