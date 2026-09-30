import * as THREE from 'three';
import { InputManager } from './input.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { physics } from './physics.js';
import { getGlobalTerrainHeight } from './terrain.js';
import { skinNaira, clothField, hairDark, leatherDark } from './materials.js';

export enum MovementState {
  WALK = 'WALK',
  CLIMB = 'CLIMB',
  LEDGE_GRAB = 'LEDGE_GRAB',
  SWIM = 'SWIM',
  SLIDE = 'SLIDE',
  ROPE_SWING = 'ROPE_SWING'
}


export class CharacterController {
  public mesh: THREE.Group;
  private camera: THREE.PerspectiveCamera;
  protected input: InputManager;

  // Orbit camera parameters
  private theta: number = 0;
  private phi: number = Math.PI / 3;
  private radius: number = 5;
  private target: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  // Traversal State Machine
  public state: MovementState = MovementState.WALK;
  private stateTimer: number = 0;

  // Locomotion parameters
  private speed: number = 0;
  private maxWalkSpeed: number = 2.0;
  private maxRunSpeed: number = 5.0;
  private acceleration: number = 10.0;
  private deceleration: number = 15.0;
  private rotationSpeed: number = 10.0;

  // Animation state
  private time: number = 0;
  private torso: THREE.Mesh;
  private leftArm: THREE.Mesh;
  private rightArm: THREE.Mesh;
  private leftLeg: THREE.Mesh;
  private rightLeg: THREE.Mesh;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, input: InputManager) {
    this.camera = camera;
    this.input = input;

    // Realistic proportions and anatomy for Naira
    this.mesh = new THREE.Group();

    // Skin with subsurface scattering approximation
    const skinMat = skinNaira();

    // Cloth PBR (weather-worn field clothing)
    const clothMat = clothField();

    // Pants (tough fabric)
    const pantsMat = clothField();

    // Gear (leather/straps)
    const gearMat = leatherDark();

    // Torso (Jacket/Shirt)
    const torsoGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.6, 16);
    this.torso = new THREE.Mesh(torsoGeo, clothMat);
    this.torso.position.y = 1.0;
    this.torso.castShadow = true;
    this.mesh.add(this.torso);

    // Pack/Field Gear
    const packGeo = new THREE.BoxGeometry(0.3, 0.4, 0.15);
    const pack = new THREE.Mesh(packGeo, gearMat);
    pack.position.set(0, 0.1, -0.15);
    this.torso.add(pack);

    // Head
    const headGeo = new THREE.SphereGeometry(0.11, 16, 16);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.y = 1.45;
    head.castShadow = true;

    // Dark braid (tube geometry)
    const braidPath = new THREE.CatmullRomCurve3([
       new THREE.Vector3(0, 0, -0.1),
       new THREE.Vector3(0, -0.1, -0.15),
       new THREE.Vector3(0, -0.3, -0.18)
    ]);
    const braidGeo = new THREE.TubeGeometry(braidPath, 8, 0.03, 8, false);
    const hairMat = hairDark();
    const braid = new THREE.Mesh(braidGeo, hairMat);
    head.add(braid);

    this.mesh.add(head);

    // Legs (~0.8m)
    const legGeo = new THREE.CylinderGeometry(0.09, 0.06, 0.8, 16);
    // Move pivot to top of leg
    legGeo.translate(0, -0.4, 0);

    this.leftLeg = new THREE.Mesh(legGeo, pantsMat);
    this.leftLeg.position.set(-0.11, 0.8, 0);
    this.leftLeg.castShadow = true;
    this.mesh.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, pantsMat);
    this.rightLeg.position.set(0.11, 0.8, 0);
    this.rightLeg.castShadow = true;
    this.mesh.add(this.rightLeg);

    // Arms (~0.6m)
    const armGeo = new THREE.CylinderGeometry(0.06, 0.045, 0.6, 16);
    // Move pivot to top of arm
    armGeo.translate(0, -0.3, 0);

    // Sleeves use clothMat, hands use skinMat (simplified as just using skinMat for now or a mixed approach)
    // To keep rig intact, we'll just use skinMat for arms to represent exposed skin / tight sleeves
    this.leftArm = new THREE.Mesh(armGeo, skinMat);
    this.leftArm.position.set(-0.28, 1.3, 0);
    this.leftArm.castShadow = true;
    this.mesh.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, skinMat);
    this.rightArm.position.set(0.28, 1.3, 0);
    this.rightArm.castShadow = true;
    this.mesh.add(this.rightArm);

    scene.add(this.mesh);

    // Camera orbit controls (mouse drag)
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    window.addEventListener('mousedown', () => isDragging = true);
    window.addEventListener('mouseup', () => isDragging = false);
    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.offsetX - previousMousePosition.x;
        const deltaY = e.offsetY - previousMousePosition.y;

        this.theta -= deltaX * 0.01;
        this.phi -= deltaY * 0.01;

        // Clamp phi
        this.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, this.phi));
      }
      previousMousePosition = { x: e.offsetX, y: e.offsetY };
    });

    this.updateCamera();
  }

  public setForceState(state: MovementState) { this.state = state; this.stateTimer = 0; }

  public getTerrainHeightAndNormal(x: number, z: number): { y: number, normal: THREE.Vector3 } {
    const y = getGlobalTerrainHeight(x, z);
    const eps = 0.1;
    const hx = getGlobalTerrainHeight(x + eps, z);
    const hz = getGlobalTerrainHeight(x, z + eps);
    const dx = hx - y;
    const dz = hz - y;
    const normal = new THREE.Vector3(-dx, eps, -dz).normalize();
    return { y, normal };
  }


  private detectStateTransitions(nextX: number, _nextZ: number, terrainData: { y: number, normal: THREE.Vector3 }) {
    const isRiver = terrainData.y < -3.0 && Math.abs(nextX) < 15;

    if (this.state === MovementState.WALK && this.mesh.position.y > 10 && terrainData.normal.y < 0.1 && this.input.isDown('KeyW')) {
        this.state = MovementState.CLIMB;
    }

    if (this.state === MovementState.WALK && isRiver) {
        this.state = MovementState.SWIM;
    } else if (this.state === MovementState.SWIM && !isRiver && terrainData.y > -2.0) {
        this.state = MovementState.WALK;
    }

    const slope = 1.0 - terrainData.normal.y;
    if (this.state === MovementState.WALK && slope > 0.6 && this.speed > 2.0) {
        this.state = MovementState.SLIDE;
    } else if (this.state === MovementState.SLIDE && slope < 0.3) {
        this.state = MovementState.WALK;
    }
  }

  // Optional rigid body reference for physics interaction
  public body: RAPIER.RigidBody | null = null;
  public collider: RAPIER.Collider | null = null;

  // Breath particles
  private breathParticles: THREE.Mesh[] = [];

  public update(dt: number) {
    this.stateTimer += dt;
    this.time += dt;

    // Optional sync to physics
    if (this.body) {
        // Very basic sync for physics interaction, ideally we'd use a proper KinematicCharacterController
        // but for now we just want to push things.
        this.body.setNextKinematicTranslation({
            x: this.mesh.position.x,
            y: this.mesh.position.y,
            z: this.mesh.position.z
        });
    }

    // Movement Input
    const forward = this.input.isDown('KeyW') ? 1 : (this.input.isDown('KeyS') ? -1 : 0);
    const right = this.input.isDown('KeyD') ? 1 : (this.input.isDown('KeyA') ? -1 : 0);
    const isRunning = this.input.isDown('ShiftLeft');

    let actualForward = forward;
    let actualRight = right;

    if (this.state === MovementState.SLIDE) {
        actualForward = 1;
        actualRight = right * 0.5;
    } else if (this.state === MovementState.CLIMB) {
        actualForward = forward * 0.5;
        actualRight = right * 0.5;
    } else if (this.state === MovementState.SWIM) {
        actualForward = forward * 0.6;
        actualRight = right * 0.6;
    }

    const inputDir = new THREE.Vector3(actualRight, 0, -actualForward);

    if (inputDir.lengthSq() > 0) {
      inputDir.normalize();

      const camDir = new THREE.Vector3();
      this.camera.getWorldDirection(camDir);
      camDir.y = 0;
      camDir.normalize();

      const camRight = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();

      const moveDir = new THREE.Vector3()
        .addScaledVector(camRight, inputDir.x)
        .addScaledVector(camDir, -inputDir.z)
        .normalize();

      const targetAngle = Math.atan2(moveDir.x, moveDir.z);

      let angleDiff = targetAngle - this.mesh.rotation.y;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      this.mesh.rotation.y += angleDiff * this.rotationSpeed * dt;

      const targetSpeed = isRunning ? this.maxRunSpeed : this.maxWalkSpeed;
      this.speed = Math.min(targetSpeed, this.speed + this.acceleration * dt);

    } else {
      this.speed = Math.max(0, this.speed - this.deceleration * dt);
    }

    const moveOffset = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mesh.rotation.y).multiplyScalar(this.speed * dt);

    const nextX = this.mesh.position.x + moveOffset.x;
    const nextZ = this.mesh.position.z + moveOffset.z;

    const terrainData = this.getTerrainHeightAndNormal(nextX, nextZ);


    this.detectStateTransitions(nextX, nextZ, terrainData);

    const slope = 1.0 - terrainData.normal.y;

    if (this.state === MovementState.CLIMB) {
        this.mesh.position.y += actualForward * this.maxWalkSpeed * 0.5 * dt;
        this.mesh.position.x = nextX;
        this.mesh.position.z = nextZ;
    } else if (this.state === MovementState.ROPE_SWING) {
        const swingSpeed = 2.0;
        const swingArc = Math.sin(this.stateTimer * swingSpeed) * 3;
        this.mesh.position.y = this.getTerrainHeightAndNormal(this.mesh.position.x, this.mesh.position.z).y + 5 - Math.cos(this.stateTimer * swingSpeed) * 2;
        this.mesh.position.x += Math.cos(this.mesh.rotation.y) * swingArc * dt;
        this.mesh.position.z += Math.sin(this.mesh.rotation.y) * swingArc * dt;
    } else if (slope < 0.4 || this.state === MovementState.SLIDE || this.state === MovementState.SWIM) {
      this.mesh.position.x = nextX;
      this.mesh.position.z = nextZ;
    }

    if (this.state !== MovementState.CLIMB && this.state !== MovementState.ROPE_SWING) {
        let h = this.getTerrainHeightAndNormal(this.mesh.position.x, this.mesh.position.z).y;

        // Raycast down to find physics colliders (like the rope bridge)
        const physHeight = physics.raycastDown(this.mesh.position.x, this.mesh.position.y + 2.0, this.mesh.position.z, 5.0);
        if (physHeight !== null && physHeight > h) {
            h = physHeight;
        }

        if (this.state === MovementState.SWIM) {
             const riverLevel = 0.5; // same as river height
             // Bob slightly with time
             const bob = Math.sin(this.time * 2) * 0.1;
             this.mesh.position.y = riverLevel - 1.5 + bob;

             // Drift slightly with current
             const driftSpeed = 2.0;
             this.mesh.position.z -= driftSpeed * dt;

             // Ensure we don't clip through the ground while swimming
             if (this.mesh.position.y < h) {
                 this.mesh.position.y = h;
             }
        } else {
             this.mesh.position.y = h;
        }
    }


    // Breath vapor effect for high sierra
    const isHighSierra = this.mesh.position.z > 500 || this.mesh.position.y > 50;
    if (isHighSierra) {
      if (Math.random() < 0.1) { // spawn rate
         const breathGeo = new THREE.SphereGeometry(0.1, 4, 4);
         const breathMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false });
         const breath = new THREE.Mesh(breathGeo, breathMat);
         // Position roughly at head
         breath.position.copy(this.mesh.position).add(new THREE.Vector3(0, 1.8, 0.5).applyAxisAngle(new THREE.Vector3(0,1,0), this.mesh.rotation.y));
         this.mesh.parent?.add(breath);
         this.breathParticles.push(breath);
      }
    }

    // Update breath particles
    for (let i = this.breathParticles.length - 1; i >= 0; i--) {
        const p = this.breathParticles[i];
        p.position.y += dt * 1.5;
        p.position.z += dt * 0.5 * Math.cos(this.mesh.rotation.y); // drift forward slightly
        p.position.x += dt * 0.5 * Math.sin(this.mesh.rotation.y);
        const mat = p.material as THREE.MeshBasicMaterial;
        mat.opacity -= dt * 0.5;
        p.scale.addScalar(dt * 2.0);
        if (mat.opacity <= 0) {
            p.parent?.remove(p);
            p.geometry.dispose();
            mat.dispose();
            this.breathParticles.splice(i, 1);
        }
    }

    if (this.speed > 0.1) {

      let cycleSpeed = isRunning ? 15 : 8;
      if (this.state === MovementState.SWIM) cycleSpeed = 5;
      if (this.state === MovementState.CLIMB) cycleSpeed = 4;
      const cycle = Math.sin(this.time * cycleSpeed);

      this.leftLeg.rotation.x = cycle * 0.8;
      this.rightLeg.rotation.x = -cycle * 0.8;

      if (this.state === MovementState.CLIMB) {
          this.leftArm.rotation.x = Math.PI - cycle * 0.5;
          this.rightArm.rotation.x = Math.PI + cycle * 0.5;
      } else if (this.state === MovementState.SWIM) {
          this.leftArm.rotation.z = Math.PI / 2 + cycle * 0.5;
          this.rightArm.rotation.z = -Math.PI / 2 - cycle * 0.5;
      } else {
          this.leftArm.rotation.x = -cycle * 0.5;
          this.rightArm.rotation.x = cycle * 0.5;
      }

      this.torso.position.y = 1.0 + Math.abs(cycle) * 0.05;

      if (this.state === MovementState.SLIDE) {
          this.mesh.rotation.x = Math.PI / 6;
      } else {
          this.mesh.rotation.x = 0;
      }

    } else {
      const breathe = Math.sin(this.time * 2);
      this.torso.scale.set(1, 1 + breathe * 0.02, 1 + breathe * 0.05);

      this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, dt * 10);
      this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, dt * 10);
      this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, dt * 10);
      this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, dt * 10);
      this.torso.position.y = THREE.MathUtils.lerp(this.torso.position.y, 1.0, dt * 10);
    }

    this.updateCamera();
  }

  public updateCamera() {
    this.target.copy(this.mesh.position).add(new THREE.Vector3(0, 1.2, 0));

    const x = this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.target.y + this.radius * Math.cos(this.phi);
    const z = this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  public teleport(x: number, z: number, theta: number = 0) {
    this.mesh.position.set(x, this.getTerrainHeightAndNormal(x, z).y, z);
    this.theta = theta;
    this.updateCamera();
  }
}
