import * as THREE from 'three';
import { createRenderer, getRenderCaps, QUALITY_TIERS } from './renderer.js';
import { setupEnvironment } from './environment.js';
import { createTerrain } from './terrain.js';
import { createRiver } from './river.js';
import { createDecor } from './decor.js';
import { CharacterController } from './character.js';
import { InputManager } from './input.js';
import { TouchControls } from './touch/controls.js';
import { WebGPURenderer } from 'three/webgpu';
import { physics } from './physics.js';
import { initUI, updateUI } from './ui/index.js';
import { ParticleSystem } from './particles.js';
import { VolumetricLightShafts } from './volumetrics.js';
import { CinematicShader } from './renderer.js';
import { createQuestFlags } from './save/questFlags.js';
import { createSaveSystem } from './save/saveSystem.js';
import { REGIONS } from './regions/registry.js';
import { createRegionManager } from './world/regionManager.js';
import { getGlobalTerrainHeight } from './terrain.js';

// Setup for global hook
declare global {
  interface Window {
    __shotReady?: boolean;
    __frameStats?: { fps: number; low1Percent: number; };
    __reducedMotion?: boolean;
    __currentQualityTier?: 'HIGH' | 'MEDIUM' | 'LOW';
  }
}

async function init() {
  await physics.init();

  const { renderer, quality: initialQuality } = await createRenderer();

  const urlParams = new URLSearchParams(window.location.search);

  // QUALITY BLOCK START (frame stats & adaptive quality)
  let quality = initialQuality;
  window.__currentQualityTier = quality.tier;
  const renderCaps = getRenderCaps(renderer as any, quality);

  const frameTimes: number[] = [];
  const maxFrames = 120;
  let lastFrameTime = performance.now();
  let framesBelow25 = 0;
  let framesAbove45 = 0;

  function updateFrameStats() {
    const now = performance.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    frameTimes.push(dt);
    if (frameTimes.length > maxFrames) frameTimes.shift();

    if (frameTimes.length === maxFrames) {
      let sum = 0;
      for (let i = 0; i < maxFrames; i++) sum += frameTimes[i];
      const avgDt = sum / maxFrames;
      const fps = 1000 / avgDt;

      const sorted = [...frameTimes].sort((a, b) => b - a);
      const p1Index = Math.floor(maxFrames * 0.01);
      const low1PercentDt = sorted[p1Index];
      const low1Percent = 1000 / low1PercentDt;

      window.__frameStats = { fps, low1Percent };

      // Heat-aware adaptive quality
      // Drop tier after 3s (approx 75 frames @25fps) < 25fps
      if (fps < 25) {
        framesBelow25++;
        framesAbove45 = 0;
      } else if (fps > 45) {
        framesAbove45++;
        framesBelow25 = 0;
      } else {
        framesBelow25 = 0;
        framesAbove45 = 0;
      }

      if (framesBelow25 > 75) {
        if (quality.tier === 'HIGH') adaptQuality('MEDIUM');
        else if (quality.tier === 'MEDIUM') adaptQuality('LOW');
        framesBelow25 = 0;
      } else if (framesAbove45 > 135) { // 3s @45fps
        if (quality.tier === 'LOW') adaptQuality('MEDIUM');
        else if (quality.tier === 'MEDIUM') adaptQuality('HIGH');
        framesAbove45 = 0;
      }
    }
  }

  function adaptQuality(newTier: 'HIGH' | 'MEDIUM' | 'LOW') {
    if (quality.tier === newTier) return;
    if (urlParams.has('quality')) return; // locked by URL

    quality = QUALITY_TIERS[newTier];
    window.__currentQualityTier = quality.tier;
    renderCaps.tier = quality.tier;
    renderer.setPixelRatio(quality.pixelRatio);
    renderer.shadowMap.type = (newTier === 'LOW' && !renderCaps.isWebGPU) ? THREE.PCFShadowMap : (renderCaps.isWebGPU ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap);
    console.log(`Adaptive quality changed to ${newTier}`);
  }

  // Battery-aware quality
  let batteryWasLow = false;
  let preBatteryTier: 'HIGH' | 'MEDIUM' | 'LOW' = quality.tier;
  if ('getBattery' in navigator) {
    (navigator as any).getBattery().then((battery: any) => {
      const checkBattery = () => {
        if (battery.level < 0.2 && !battery.charging) {
          if (!batteryWasLow) {
            preBatteryTier = quality.tier;
            adaptQuality('LOW');
            console.log("Toast: Battery low, dropping to LOW tier to save power.");
            batteryWasLow = true;
          }
        } else if (battery.charging && batteryWasLow) {
            adaptQuality(preBatteryTier);
            console.log("Toast: Device charging, restoring quality.");
            batteryWasLow = false;
        }
      };
      battery.addEventListener('levelchange', checkBattery);
      battery.addEventListener('chargingchange', checkBattery);
      checkBattery();
    });
  }

  // Reduced motion preference
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  window.__reducedMotion = mediaQuery.matches;
  mediaQuery.addEventListener('change', () => {
    window.__reducedMotion = mediaQuery.matches;
  });

  // Visibility pause
  let isPaused = false;
  document.addEventListener('visibilitychange', () => {
    isPaused = document.hidden;
    const ctx = THREE.AudioContext.getContext() as any;
    if (isPaused) {
      if (ctx.state === 'running') {
        ctx.suspend();
      }
    } else {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      lastFrameTime = performance.now();
    }
  });

  // Performance Overlay
  let perfOverlay: HTMLDivElement | null = null;
  if (urlParams.has('perf')) {
    perfOverlay = document.createElement('div');
    perfOverlay.style.position = 'absolute';
    perfOverlay.style.top = '10px';
    perfOverlay.style.left = '10px';
    perfOverlay.style.color = 'lime';
    perfOverlay.style.fontFamily = 'monospace';
    perfOverlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
    perfOverlay.style.padding = '5px';
    perfOverlay.style.zIndex = '9999';
    perfOverlay.style.pointerEvents = 'none';
    document.body.appendChild(perfOverlay);

    // Periodically update UI
    setInterval(async () => {
       if (!perfOverlay) return;
       let text = `FPS: ${Math.round(window.__frameStats?.fps || 0)}\n1% Low: ${Math.round(window.__frameStats?.low1Percent || 0)}\nTier: ${window.__currentQualityTier}\n`;

       if ('getBattery' in navigator) {
           const b: any = await (navigator as any).getBattery();
           text += `Battery: ${Math.round(b.level * 100)}% ${b.charging ? '(AC)' : '(DC)'}\n`;
       }
       if (navigator.storage && navigator.storage.estimate) {
           const est = await navigator.storage.estimate();
           const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(1);
           const quotaMB = ((est.quota || 0) / (1024 * 1024)).toFixed(1);
           text += `Storage: ${usedMB} / ${quotaMB} MB\n`;
       }
       perfOverlay.innerText = text;
    }, 1000);
  }

  // QUALITY BLOCK END

  // Need to append renderer to the DOM
  document.getElementById('app')?.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 5000);

  const todParam = urlParams.get('tod');

  setupEnvironment(scene, quality, renderer, todParam);
  const terrainManager = createTerrain(scene);
  const river = createRiver(scene);
  const decor = createDecor(scene);

  const dustParticles = new ParticleSystem(scene, 'dust');
  const leavesParticles = new ParticleSystem(scene, 'leaves');
  const snowParticles = new ParticleSystem(scene, 'snow'); // Could conditionally add based on biome later
  const volumetrics = new VolumetricLightShafts(scene, todParam);

  const input = new InputManager();

  // touch controls block
  const touchControls = new TouchControls(input);

  const character = new CharacterController(scene, camera, input);

  initUI(character);

  const flags = createQuestFlags();
  const saveAPI = createSaveSystem();

  const regionManager = createRegionManager({
    saveAPI,
    flags,
    worldState: {},
    inventory: [],
    solvedPuzzles: []
  });

  for (const region of REGIONS) {
    const api = {
      scene,
      flags,
      terrainHeight: getGlobalTerrainHeight,
      onEnterRegion: (cb: () => void) => regionManager.registerEnterCallback(region.id, cb),
      onExitRegion: (cb: () => void) => regionManager.registerExitCallback(region.id, cb),
      resolveEncounter: (id: string) => regionManager.resolveEncounter(id)
    };
    try {
      region.build(api);
    } catch (e) {
      console.error(`Failed to build region ${region.id}:`, e);
    }
  }

  // V-POST: post-processing block start
  let composer: any = null;
  let cinematicPass: any = null;
  let postProcessing: any = null;
  const isWebGPU = renderer instanceof WebGPURenderer;
  const skipPost = urlParams.get('tv') === '1';

  const envMod = await import('./environment.js');
  const gradeKey = (todParam || 'day') as keyof typeof envMod.TOD_GRADES;
  const grade = envMod.TOD_GRADES[gradeKey] || envMod.TOD_GRADES['day'];

  if (!skipPost) {
      if (isWebGPU) {
          // WebGPU TSL Post Processing
          const { pass, uv, float, vec4, Fn, vec2, time, fract, mod, color, toneMapping } = await import('three/tsl' as any);
          const { PostProcessing } = await import('three/webgpu');
          const { bloom } = await import('three/examples/jsm/tsl/display/BloomNode.js');

          const scenePass = pass( scene, camera );

          // Bloom full res on WebGPU HIGH, otherwise half resolution or no bloom if disabled
          // A budget optimization for WebGPU medium/low tiers as well
          const bloomPass = bloom(scenePass, 0.35, 0.4, 0.85);

          const random = Fn(([p]: [any]) => {
              const K1 = vec2(23.14069263277926, 2.665144142690225);
              return fract(p.dot(K1).cos().mul(12345.6789));
          });

          const { convertToTexture } = await import('three/tsl' as any);

          const cinematicNode = Fn( ( [ inputNode ]: [any] ) => {
             const uvNode = uv();
             const texNode = convertToTexture(inputNode);

             // Chromatic Aberration
             const offset = vec2(0.0015, 0.0);
             const r = texNode.sample(uvNode.add(offset)).r;
             const g = texNode.sample(uvNode).g;
             const b = texNode.sample(uvNode.sub(offset)).b;
             const a = texNode.sample(uvNode).a;
             let col = vec4(r, g, b, a);

             // Vignette
             const dist = uvNode.sub(0.5).length();
             const factor = float(1.0).sub(dist.mul(0.55)).clamp(0.0, 1.0);
             col = vec4(col.rgb.mul(factor), col.a);

             // Film Grain - static to ensure deterministic frames for A/B convergence.
             // Using mod(time, 0.0) or simply uv so it's always the same frame for ?shot=
             const noise = random(uvNode).sub(0.5).mul(0.035);
             col = vec4(col.rgb.add(noise), col.a);

             return col;
          } );

          postProcessing = new PostProcessing( renderer as WebGPURenderer );

          // Color Grading matching TOD_GRADES intent
          const colorGradingNode = Fn(([inputColor]: [any]) => {
              // Apply basic color grading tint based on ToD. This scales the colors based on sunColor and exposure.
              const sunTint = color(grade.sunColor).mul(grade.exposure);
              // Normalize the tint so we don't blow out the image completely
              return vec4(inputColor.rgb.mul(sunTint).mul(float(0.8)), inputColor.a);
          });

          const cinematic = cinematicNode(bloomPass);
          const graded = colorGradingNode(cinematic);

          // Output tone mapped
          postProcessing.outputNode = toneMapping(THREE.ACESFilmicToneMapping, grade.exposure, graded);

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

          // iPhone budget rule: Bloom at half resolution on WebGL2 fallback
          const bloomRes = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
          const bloomPass = new UnrealBloomPass(bloomRes, 0.35, 0.4, 0.85);
          composer.addPass(bloomPass);

          // WebGL2 color grading pass matching TOD_GRADES intent
          const colorGradingShader = {
              uniforms: {
                  tDiffuse: { value: null },
                  sunColor: { value: new THREE.Color(grade.sunColor) },
                  exposure: { value: grade.exposure }
              },
              vertexShader: `
                  varying vec2 vUv;
                  void main() {
                      vUv = uv;
                      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                  }
              `,
              fragmentShader: `
                  uniform sampler2D tDiffuse;
                  uniform vec3 sunColor;
                  uniform float exposure;
                  varying vec2 vUv;
                  void main() {
                      vec4 tex = texture2D(tDiffuse, vUv);
                      vec3 graded = tex.rgb * sunColor * exposure * 0.8;
                      gl_FragColor = vec4(graded, tex.a);
                  }
              `
          };
          const colorGradingPass = new ShaderPass(colorGradingShader);
          composer.addPass(colorGradingPass);

          cinematicPass = new ShaderPass(CinematicShader);
          // Set deterministic time for WebGL2 grain
          cinematicPass.uniforms['time'].value = 0.0;
          composer.addPass(cinematicPass);

          const outputPass = new OutputPass();
          composer.addPass(outputPass);
      }
  }
  // V-POST: post-processing block end

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

  const shot = urlParams.get('shot');
  const tStr = urlParams.get('t');

  let shotMode = false;

  if (shot) {
    shotMode = true;

    // Hide UI in shot mode
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) {
      uiRoot.style.display = 'none';
    }
    const pauseMenu = document.getElementById('pause-menu');
    if (pauseMenu) {
      pauseMenu.remove();
    }

    // Scene positioning
    if (shot.startsWith('region:')) {
      const shotId = shot.replace('region:', '');
      let found = false;
      for (const region of REGIONS) {
        const s = region.shots.find(x => x.id === shotId);
        if (s) {
          camera.position.set(s.camera.x, s.camera.y, s.camera.z);
          camera.lookAt(s.lookAt.x, s.lookAt.y, s.lookAt.z);
          character.teleport(0, -1000, 0); // Hide character out of frame
          found = true;
          break;
        }
      }
      if (!found) {
        console.warn(`Shot ID not found: ${shotId}`);
        character.teleport(0, 0, 0);
      }
    } else if (shot === 'valley_overview') {
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
    if (urlParams.get('load') === '1') {
      const data = saveAPI.load(0);
      if (data) {
        console.log(`Loaded save slot 0 from ${new Date(data.savedAt).toLocaleString()}`);
        character.teleport(data.player.position.x, data.player.position.z, data.player.rotationY);
        flags.restore(data.questFlags);
      } else {
        console.warn('No save found in slot 0 to load.');
        character.teleport(0, 0);
      }
    } else {
      character.teleport(0, 0);
    }
  }

  const clock = new THREE.Clock();

  let hasTriggeredRockslide = false;

  function animate() {
    if (!shotMode) {
      requestAnimationFrame(animate);
      if (isPaused) return;
      updateFrameStats();
    }

    const dt = Math.min(clock.getDelta(), 0.1);
    const time = clock.getElapsedTime();

    if (cinematicPass) {
       cinematicPass.uniforms['time'].value = time;
    }

    if (!shotMode) {
      touchControls.update(dt);
      physics.update(dt);
      character.update(dt);
      terrainManager.update(character.mesh.position);
      regionManager.update(character.mesh.position);
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
