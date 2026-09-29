import * as THREE from 'three';
import { createRenderer } from './renderer.js';
import { setupEnvironment } from './environment.js';
import { createTerrain } from './terrain.js';
import { createRiver } from './river.js';
import { createDecor } from './decor.js';
import { CharacterController } from './character.js';
import { InputManager } from './input.js';
import { WebGPURenderer } from 'three/webgpu';

// Setup for global hook
declare global {
  interface Window {
    __shotReady?: boolean;
  }
}

async function init() {
  const { renderer, quality } = await createRenderer();

  // Need to append renderer to the DOM
  document.getElementById('app')?.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);

  setupEnvironment(scene, quality);
  createTerrain(scene);
  const river = createRiver(scene);
  const decor = createDecor(scene);

  const input = new InputManager();
  const character = new CharacterController(scene, camera, input);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const urlParams = new URLSearchParams(window.location.search);
  const shot = urlParams.get('shot');
  const tStr = urlParams.get('t');

  let shotMode = false;

  if (shot) {
    shotMode = true;

    // Scene positioning
    if (shot === 'valley_overview') {
      character.teleport(0, 400, Math.PI);
    } else if (shot === 'river_crossing') {
      character.teleport(0, 0, Math.PI / 2);
    } else if (shot === 'character_closeup') {
      character.teleport(50, 50, 0);
    } else {
      character.teleport(0, 0, 0);
    }

    // Fast forward
    if (tStr) {
      const t = parseFloat(tStr);
      // Simulate multiple frames to let animations settle
      const steps = 60;
      const dt = t / steps;
      for (let i = 0; i < steps; i++) {
        character.update(dt);
        river.update(i * dt);
      }
    }
  } else {
    character.teleport(0, 0);
  }

  const clock = new THREE.Clock();

  function animate() {
    if (!shotMode) {
      requestAnimationFrame(animate);
    }

    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.getElapsedTime();

    if (!shotMode) {
      character.update(dt);
      river.update(time);
      decor.update(camera);
    }

    renderer.render(scene, camera);
  }

  // Initial render
  if (renderer instanceof WebGPURenderer) {
    await renderer.renderAsync(scene, camera);
  } else {
    renderer.render(scene, camera);
  }

  if (shotMode) {
    // Render once and signal ready
    renderer.render(scene, camera);
    if (renderer instanceof WebGPURenderer) {
      await renderer.renderAsync(scene, camera);
    }
    setTimeout(() => {
      window.__shotReady = true;
    }, 100);
  } else {
    animate();
  }
}

init().catch(e => {
  console.error(e);
});
