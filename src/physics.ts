import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

export class PhysicsSystem {
  world: RAPIER.World | null = null;
  private isFallback = false;

  // Storage for physics-driven meshes
  private rigidBodies: { mesh: THREE.Object3D, body: RAPIER.RigidBody }[] = [];

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

       // Buoyancy forces must be applied in the fixed step loop before stepping
       const riverLevel = 0.5;
       for (let i = 0; i < this.rigidBodies.length; i++) {
           const b = this.rigidBodies[i];
           if (!b.body.isDynamic()) continue;

           const pos = b.body.translation();

           if (Math.abs(pos.x) < 20 && pos.y < riverLevel) {
               const depth = riverLevel - pos.y;
               const force = depth * 500;
               b.body.applyImpulse({ x: 0, y: force * this.timeStep, z: 0 }, true);

               const flowSpeed = 20;
               b.body.applyImpulse({ x: 0, y: 0, z: -flowSpeed * this.timeStep }, true);

               b.body.setLinearDamping(2.0);
               b.body.setAngularDamping(2.0);
           } else {
                b.body.setLinearDamping(0.5);
                b.body.setAngularDamping(0.5);
           }
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

      this.rigidBodies.push({ mesh, body });

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

      for (let i = 0; i < numObjects; i++) {
        const mesh = new THREE.Mesh(geometry, material);
        // spawn slightly above the river (y ~ 0.5) to drop them in
        mesh.position.set((Math.random() - 0.5) * 10, 5 + Math.random() * 5, (Math.random() - 0.5) * 10);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);

        const body = this.addDynamicMesh(mesh, 5.0, 'box', 3.0);

        if (body) {
           // We override the collider to be a cylinder to match the mesh shape better
           // But since addDynamicMesh creates a box or sphere, we just replace it
           // This is just a visual demo, so a box approximation (size 3) is actually okay for a log.
           // For perfection we could add a 'cylinder' type to addDynamicMesh, but let's stick to simple box.
        }
      }
  }

  spawnRockslide(scene: THREE.Scene, x: number, z: number, y: number) {
    if (this.isFallback || !this.world) return;

    // Create multiple rocks
    const numRocks = 15;
    const material = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9, metalness: 0.1 });

    for (let i = 0; i < numRocks; i++) {
      const radius = 1.0 + Math.random() * 1.5;
      const geometry = new THREE.DodecahedronGeometry(radius, 1);
      const mesh = new THREE.Mesh(geometry, material);

      mesh.position.set(
        x + (Math.random() - 0.5) * 10,
        y + Math.random() * 5,
        z + (Math.random() - 0.5) * 10
      );

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);

      const body = this.addDynamicMesh(mesh, radius * radius * 100, 'sphere', radius);
      if (body) {
        // Give it a little initial push down the slope
        body.applyImpulse({ x: Math.random() * 500, y: 0, z: Math.random() * 500 }, true);
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

    this.rigidBodies.push({ mesh, body });
    return body;
  }
}

export const physics = new PhysicsSystem();
