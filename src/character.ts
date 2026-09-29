import * as THREE from 'three';
import { InputManager } from './input.js';

export class CharacterController {
  public mesh: THREE.Group;
  private camera: THREE.PerspectiveCamera;
  protected input: InputManager;

  // Orbit camera parameters
  private theta: number = 0;
  private phi: number = Math.PI / 3;
  private radius: number = 5;
  private target: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

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

    // Create a proportioned realistic humanoid placeholder
    this.mesh = new THREE.Group();

    const mat = new THREE.MeshStandardMaterial({ color: 0x886655, roughness: 0.7 });

    // Torso (~0.6m)
    const torsoGeo = new THREE.BoxGeometry(0.4, 0.6, 0.2);
    this.torso = new THREE.Mesh(torsoGeo, mat);
    this.torso.position.y = 1.0;
    this.torso.castShadow = true;
    this.mesh.add(this.torso);

    // Head (~0.25m)
    const headGeo = new THREE.SphereGeometry(0.12);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = 1.45;
    head.castShadow = true;
    this.mesh.add(head);

    // Legs (~0.8m)
    const legGeo = new THREE.CylinderGeometry(0.08, 0.05, 0.8);
    // Move pivot to top of leg
    legGeo.translate(0, -0.4, 0);

    this.leftLeg = new THREE.Mesh(legGeo, mat);
    this.leftLeg.position.set(-0.1, 0.8, 0);
    this.leftLeg.castShadow = true;
    this.mesh.add(this.leftLeg);

    this.rightLeg = new THREE.Mesh(legGeo, mat);
    this.rightLeg.position.set(0.1, 0.8, 0);
    this.rightLeg.castShadow = true;
    this.mesh.add(this.rightLeg);

    // Arms (~0.6m)
    const armGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.6);
    // Move pivot to top of arm
    armGeo.translate(0, -0.3, 0);

    this.leftArm = new THREE.Mesh(armGeo, mat);
    this.leftArm.position.set(-0.25, 1.3, 0);
    this.leftArm.castShadow = true;
    this.mesh.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, mat);
    this.rightArm.position.set(0.25, 1.3, 0);
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

  public getTerrainHeightAndNormal(x: number, z: number): { y: number, normal: THREE.Vector3 } {
    const size = 1000;
    const valleyShape = Math.pow(Math.abs(x / (size / 2)), 2) * 100;
    const noise = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 5 +
                  Math.sin(x * 0.01 + z * 0.02) * 15;
    const riverBed = -Math.exp(-Math.pow(x / 30, 2)) * 10;

    const y = valleyShape + noise + riverBed;

    const eps = 0.1;
    const hx = (Math.pow(Math.abs((x+eps) / (size / 2)), 2) * 100 + Math.sin((x+eps) * 0.05) * Math.cos(z * 0.05) * 5 + Math.sin((x+eps) * 0.01 + z * 0.02) * 15 - Math.exp(-Math.pow((x+eps) / 30, 2)) * 10);
    const hz = (Math.pow(Math.abs(x / (size / 2)), 2) * 100 + Math.sin(x * 0.05) * Math.cos((z+eps) * 0.05) * 5 + Math.sin(x * 0.01 + (z+eps) * 0.02) * 15 - Math.exp(-Math.pow(x / 30, 2)) * 10);

    const dx = hx - y;
    const dz = hz - y;

    const normal = new THREE.Vector3(-dx, eps, -dz).normalize();
    return { y, normal };
  }

  public update(dt: number) {
    this.time += dt;

    // Movement Input
    const forward = this.input.isDown('KeyW') ? 1 : (this.input.isDown('KeyS') ? -1 : 0);
    const right = this.input.isDown('KeyD') ? 1 : (this.input.isDown('KeyA') ? -1 : 0);
    const isRunning = this.input.isDown('ShiftLeft');

    const inputDir = new THREE.Vector3(right, 0, -forward);

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

    const slope = 1.0 - terrainData.normal.y;
    if (slope < 0.4) {
      this.mesh.position.x = nextX;
      this.mesh.position.z = nextZ;
    }

    this.mesh.position.y = this.getTerrainHeightAndNormal(this.mesh.position.x, this.mesh.position.z).y;

    if (this.speed > 0.1) {
      const cycleSpeed = isRunning ? 15 : 8;
      const cycle = Math.sin(this.time * cycleSpeed);

      this.leftLeg.rotation.x = cycle * 0.8;
      this.rightLeg.rotation.x = -cycle * 0.8;

      this.leftArm.rotation.x = -cycle * 0.5;
      this.rightArm.rotation.x = cycle * 0.5;

      this.torso.position.y = 1.0 + Math.abs(cycle) * 0.05;
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
