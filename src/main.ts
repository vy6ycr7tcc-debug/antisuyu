import * as THREE from 'three';
import { createRenderer } from './renderer.js';
import { setupEnvironment } from './environment.js';
import { createTerrain } from './terrain.js';
import { createRiver } from './river.js';
import { createDecor } from './decor.js';
import { CharacterController } from './character.js';
import { InputManager } from './input.js';
import { WebGPURenderer } from 'three/webgpu';
import { physics } from './physics.js';
import { initUI, updateUI } from './ui/index.js';
import { ParticleSystem } from './particles.js';
import { VolumetricLightShafts } from './volumetrics.js';
import { CinematicShader } from './renderer.js';
import { cloudForest } from './regions/cloudForest.js';
import { getGlobalTerrainHeight } from './terrain.js';

// Setup for global hook
declare global {
  interface Window {
    __shotReady?: boolean;
  }
}

async function init() {
  await physics.init();

  const { renderer, quality } = await createRenderer();

  // Need to append renderer to the DOM
  document.getElementById('app')?.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);

  const urlParams = new URLSearchParams(window.location.search);
  const todParam = urlParams.get('tod');

  setupEnvironment(scene, quality, renderer, todParam);
  const terrainManager = createTerrain(scene);
  const river = createRiver(scene);
  const decor = createDecor(scene);

  // TEMP: Load cloud forest
  cloudForest.build({
    scene,
    flags: { set: () => {}, has: () => false },
    terrainHeight: getGlobalTerrainHeight,
    onEnterRegion: (cb) => cb(),
    onExitRegion: () => {}
  });
  // END TEMP

  const dustParticles = new ParticleSystem(scene, 'dust');
  const leavesParticles = new ParticleSystem(scene, 'leaves');
  const snowParticles = new ParticleSystem(scene, 'snow'); // Could conditionally add based on biome later
  const volumetrics = new VolumetricLightShafts(scene, todParam);

  const input = new InputManager();
  const character = new CharacterController(scene, camera, input);

  initUI(character);

  // Setup Post-Processing
  let composer: any = null;
  let cinematicPass: any = null;
  let postProcessing: any = null;
  const isWebGPU = renderer instanceof WebGPURenderer;
  const skipPost = urlParams.get('tv') === '1';

  if (!skipPost) {
      if (isWebGPU) {
          // WebGPU TSL Post Processing
          const { pass, uv, float, vec4, Fn } = await import('three/tsl' as any);
          const { PostProcessing } = await import('three/webgpu');

          const scenePass = pass( scene, camera );

          // Basic vignette via TSL
          const vignette = Fn( ( [ color ]: [any] ) => {
             const uvNode = uv();
             const dist = uvNode.sub( 0.5 ).length();
             const factor = float( 1.0 ).sub( dist.mul( 1.2 ) ).clamp( 0.0, 1.0 );
             return vec4( color.rgb.mul( factor ), color.a );
          } );

          postProcessing = new PostProcessing( renderer as WebGPURenderer );

          // Basic pass-through for WebGPU post to prove pipeline boots
          postProcessing.outputNode = vignette(scenePass);

      } else {
          // WebGL2 Post Processing
          const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
          const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
          const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
          const { ShaderPass } = await import('three/examples/jsm/postprocessing/ShaderPass.js');
          const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js');

          composer = new EffectComposer(renderer as THREE.WebGLRenderer);
          const renderPass = new RenderPass(scene, camera);
          composer.addPass(renderPass);

          const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.4, 0.85);
          composer.addPass(bloomPass);

          cinematicPass = new ShaderPass(CinematicShader);
          composer.addPass(cinematicPass);

          const outputPass = new OutputPass();
          composer.addPass(outputPass);
      }
  }

  if (physics.world) {
    // Let's add kinematic body to character
    const rigidBodyDesc = physics.getRapier()?.RigidBodyDesc.kinematicPositionBased();
    if (rigidBodyDesc) {
       character.body = physics.world.createRigidBody(rigidBodyDesc);
       const colliderDesc = physics.getRapier()?.ColliderDesc.capsule(0.5, 0.4);
       if (colliderDesc) {
          character.collider = physics.world.createCollider(colliderDesc, character.body);
       }
    }
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let shot = urlParams.get('shot');
  const tStr = urlParams.get('t');

  let shotMode = false;

  if (shot) {
    // Check for region shot override
    if (shot.startsWith('region:')) {
      const shotId = shot.replace('region:', '');
      const shotDef = cloudForest.shots.find(s => s.id === shotId);
      if (shotDef) {
        character.teleport(shotDef.camera.x, shotDef.camera.y, shotDef.camera.z);
        camera.lookAt(new THREE.Vector3(shotDef.lookAt.x, shotDef.lookAt.y, shotDef.lookAt.z));
        shotMode = true; // IMPORTANT: set shotMode to true so it triggers the __shotReady logic
      }
    } else {

    shotMode = true;

    // Hide UI in shot mode
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) {
      uiRoot.style.display = 'none';
    }

    // Scene positioning
    if (shot === 'valley_overview') {
      character.teleport(0, 400, Math.PI);
    } else if (shot === 'river_crossing') {
      character.teleport(0, 0, Math.PI / 2);
    } else if (shot === 'character_closeup') {
      character.teleport(50, 50, 0);
    } else if (shot === 'rockslide') {
      const startX = 200;
      const startZ = 0;
      // Position character looking at the slope
      character.teleport(150, 0, Math.PI / 2);
      // y on steep slope ~200
      physics.spawnRockslide(scene, startX, startZ, 250);
    } else if (shot === 'bridge') {
      character.teleport(0, 10, 0);
      physics.createRopeBridge(scene, new THREE.Vector3(0, 20, -50), new THREE.Vector3(0, 20, 50));
    } else if (shot === 'buoyancy') {
      character.teleport(0, 2, 20); // Stand near river looking at it
      physics.spawnBuoyantDebris(scene, 10);
    } else {
      character.teleport(0, 0, 0);
    }

    }

    // Fast forward
    if (tStr) {
      const t = parseFloat(tStr);
      // Simulate multiple frames to let animations settle
      const steps = 60;
      const dt = t / steps;
      for (let i = 0; i < steps; i++) {
        physics.update(dt);
        character.update(dt);
        river.update(i * dt);
      }
    }
  } else {
    character.teleport(0, 0);
  }

  const clock = new THREE.Clock();

  let hasTriggeredRockslide = false;

  function animate() {
    if (!shotMode) {
      requestAnimationFrame(animate);
    }

    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.getElapsedTime();

    if (cinematicPass) {
       cinematicPass.uniforms['time'].value = time;
    }

    if (!shotMode) {
      physics.update(dt);
      character.update(dt);
      terrainManager.update(character.mesh.position);
      river.update(time);
      decor.update(camera);

      dustParticles.update(camera.position, 'dust');
      leavesParticles.update(camera.position, 'leaves');
      snowParticles.update(camera.position, 'snow');
      volumetrics.update(camera.position);

      // Check distance to rockslide trigger zone (approx x: 100, z: 0)
      if (!hasTriggeredRockslide) {
         const distSq = (character.mesh.position.x - 100)**2 + (character.mesh.position.z)**2;
         if (distSq < 400) { // 20 units radius
            hasTriggeredRockslide = true;
            physics.spawnRockslide(scene, 150, 0, 200);
            console.log("Rockslide triggered!");
         }
      }
      updateUI(dt);
    }

    if (!skipPost) {
       if (isWebGPU && postProcessing) {
           postProcessing.render();
       } else if (composer) {
           composer.render();
       }
    } else {
       renderer.render(scene, camera);
    }
  }

  // Initial render
  if (!skipPost) {
      if (isWebGPU && postProcessing) {
          await postProcessing.renderAsync();
      } else if (composer) {
          composer.render();
      }
  } else {
      if (renderer instanceof WebGPURenderer) {
          await renderer.renderAsync(scene, camera);
      } else {
          renderer.render(scene, camera);
      }
  }


  if (shotMode) {
    // Render once and signal ready
    if (!skipPost) {
        if (isWebGPU && postProcessing) {
            await postProcessing.renderAsync();
        } else if (composer) {
            composer.render();
        }
    } else {
        renderer.render(scene, camera);
        if (renderer instanceof WebGPURenderer) {
           await renderer.renderAsync(scene, camera);
        }
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
