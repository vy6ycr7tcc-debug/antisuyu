import * as THREE from 'three';
import { TOD_GRADES } from './environment.js';

// Seeded RNG: Mulberry32
function mulberry32(a: number) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

export class VolumetricLightShafts {
  private group: THREE.Group;

  constructor(scene: THREE.Scene, todParam: string | null) {
    this.group = new THREE.Group();

    // Seed the random number generator so layout is identical on every load
    const random = mulberry32(12345);

    const gradeKey = (todParam || 'day') as keyof typeof TOD_GRADES;
    const grade = TOD_GRADES[gradeKey] || TOD_GRADES['day'];

    // Determine intensity based on time of day
    // The bible says "Volumetric shaft intensity peaks here (see §6 in volumetrics: 0.15)."
    // We map grade.sunIntensity or just use exact gradeKey.
    let intensity = 0.05; // Day
    if (gradeKey === 'dawn' || gradeKey === 'dusk') intensity = 0.15;
    else if (gradeKey === 'noon') intensity = 0.02;
    else if (gradeKey === 'night') intensity = 0.0;

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

    // Parse region from URL if available for region-specific intensity/thickness
    // "Cloud forest and jungle interiors get the strongest shafts; sierra gets thin high-altitude shafts."
    let shaftWidth = 20;
    const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const shotParam = urlParams ? urlParams.get('shot') : null;
    if (shotParam && (shotParam.includes('cf_') || shotParam.includes('jl_'))) {
        intensity = Math.min(intensity * 1.5, 0.25);
    } else if (shotParam && shotParam.includes('hs_')) {
        shaftWidth = 10;
    }

    const geometry = new THREE.PlaneGeometry(shaftWidth, 100);

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
        (random() - 0.5) * 200,
        50 + random() * 20,
        (random() - 0.5) * 200
      );

      // Angle shafts to match exact sun direction from TOD_GRADES
      const phi = THREE.MathUtils.degToRad(90 - grade.sunElevationDeg);
      const theta = THREE.MathUtils.degToRad(grade.sunAzimuthDeg);

      // Convert spherical to cartesian direction
      const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

      // The light shaft originates from above, pointing away from the sun.
      cluster.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDir);
      this.group.add(cluster);
    }

    scene.add(this.group);
  }

  update(_cameraPosition: THREE.Vector3, regionId?: string | null, todParam?: string | null) {
      const gradeKey = (todParam || 'day') as keyof typeof TOD_GRADES;

      let baseIntensity = 0.05;
      if (gradeKey === 'dawn' || gradeKey === 'dusk') baseIntensity = 0.02;
      else if (gradeKey === 'noon') baseIntensity = 0.15;
      else if (gradeKey === 'night') baseIntensity = 0.0;

      // Map canopy density from region IDs (implicitly defined by visuals guide / story map)
      let canopyDensity = 0.0;
      if (regionId) {
          if (regionId.includes('cloud_forest') || regionId.includes('jungle_lowlands') || regionId.includes('cf_') || regionId.includes('jl_')) {
              canopyDensity = 0.8;
          }
      } else {
          const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
          const shotParam = urlParams ? urlParams.get('shot') : null;
          if (shotParam && (shotParam.includes('cf_') || shotParam.includes('jl_'))) canopyDensity = 0.8;
      }

      const finalOpacity = baseIntensity * (1.0 - canopyDensity);

      this.group.children.forEach(cluster => {
          cluster.children.forEach(mesh => {
              if (mesh instanceof THREE.Mesh && mesh.material instanceof THREE.MeshBasicMaterial) {
                  mesh.material.opacity = finalOpacity;
              }
          });
      });
  }
}
