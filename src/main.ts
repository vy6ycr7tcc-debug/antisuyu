import { registerServiceWorker, mountOfflineUI } from "./pwa/offline.js";
import * as THREE from 'three';
import { createRenderer, getRenderCaps, QUALITY_TIERS } from './renderer.js';
import { setupEnvironment, getActiveLightRig } from './environment.js';
import { createTerrain } from './terrain.js';
import { createRiver } from './river.js';
import { createDecor } from './decor.js';
import { CharacterController } from './character.js';
import { InputManager, isTouchLikeDevice } from './input.js';
import { TouchControls } from './touch/controls.js';
import { TouchUI } from './ui/touchui.js';
import { WebGPURenderer } from 'three/webgpu';
import type { PostProcessing } from 'three/webgpu';
import type { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import type { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
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
import { ashlarTrimMaterial, buildAshlarTrimNodeMaterial, mapGeometryToTrimBand, setCharacterDetailMapsEnabled, type TrimNodeMaterialResult } from './materials.js';
import { getKTX2Loader } from './assets.js';

// Setup for global hook
declare global {
  interface Window {
    __shotReady?: boolean;
    __frameStats?: { fps: number; low1Percent: number; };
    __reducedMotion?: boolean;
    __currentQualityTier?: 'HIGH' | 'MEDIUM' | 'LOW';
    __rendererType?: 'webgpu' | 'webgl2';
    __frameDataURL?: string;
    __ktx2Supported?: boolean;
    __atmosDebug?: { dust: THREE.Points; pollen: THREE.Points; motes: THREE.Points };
    __charDebug?: {
      pos: THREE.Vector3; rotY: number; visible: boolean; state: string; camPos: THREE.Vector3;
    };
    // Phase 8 shadow probe: full runtime shadow-rig state, evaluated AFTER the
    // shot render (same discipline as __charDebug/__atmosDebug). projScaleX/Y
    // are the ortho projection matrix scale terms (2/(r-l), 2/(t-b)) — if the
    // rig configured ±120 but projScaleX reads ~0.2 (= 2/10, the ±5 DEFAULT
    // frustum), the projection matrix is stale: updateProjectionMatrix() was
    // never called after the rig set its bounds (the p7-flagged latent bug).
    __shadowInfo?: {
      rendererType: string;
      shadowMapEnabled: boolean;
      shadowMapAutoUpdate: boolean;
      shadowMapType: number;
      sunCastShadow: boolean;
      sunIntensity: number;
      mapSize: [number, number];
      frustum: { left: number; right: number; top: number; bottom: number; near: number; far: number };
      projScaleX: number;
      projScaleY: number;
      bias: number;
      normalBias: number;
      sunPos: [number, number, number];
      targetPos: [number, number, number];
      meshCensus: { meshes: number; casters: number; receivers: number };
      shadowMapAllocated: boolean;
    };
  }
}

async function init() {
  await physics.init();

  const { renderer, quality: initialQuality } = await createRenderer();

  const urlParams = new URLSearchParams(window.location.search);

  // QUALITY BLOCK START (frame stats & adaptive quality)
  let quality = initialQuality;
  window.__currentQualityTier = quality.tier;
  const renderCaps = getRenderCaps(renderer, quality);

  // KTX2/Basis pipeline (companion brief, "Asset pipeline"): initialize the
  // shared loader so future phases can drop compressed PBR sets in without
  // touching material code. Cheap — the transcoder WASM loads lazily on the
  // first .ktx2 parse.
  try {
    getKTX2Loader(renderer);
    window.__ktx2Supported = true;
  } catch {
    window.__ktx2Supported = false;
  }

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
    renderer.shadowMap.type = THREE.PCFShadowMap;
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

  // P-MOBILE F10: screen wake lock (Safari 17+ / Chromium; feature-detected).
  interface WakeLockSentinelLike {
    release: () => Promise<void>;
  }
  let wakeLock: WakeLockSentinelLike | null = null;
  let journeyStarted = false;
  const requestWakeLock = async (): Promise<void> => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> };
      };
      if (!nav.wakeLock) return;
      wakeLock = await nav.wakeLock.request('screen');
    } catch {
      // Denied or unsupported — play proceeds without wake lock.
    }
  };
  const releaseWakeLock = (): void => {
    void wakeLock?.release().catch(() => { /* already released */ });
    wakeLock = null;
  };

  // P-MOBILE F12: iOS suspends the AudioContext until a user gesture
  // resumes it. First pointerdown keys the unlock; journey start re-keys it
  // inside the New-Journey gesture chain. (three's AudioContext type is its
  // own minimal wrapper — narrow to the DOM type once, no `any`.)
  const getAudioCtx = (): globalThis.AudioContext =>
    THREE.AudioContext.getContext() as unknown as globalThis.AudioContext;
  const resumeAudioContext = (): void => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
  };
  window.addEventListener('pointerdown', resumeAudioContext, { once: true });

  // Visibility pause
  let isPaused = false;
  document.addEventListener('visibilitychange', () => {
    isPaused = document.hidden;
    const ctx = getAudioCtx();
    if (isPaused) {
      if (ctx.state === 'running') {
        ctx.suspend();
      }
      releaseWakeLock();
    } else {
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      if (journeyStarted) void requestWakeLock();
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
  const terrainManager = createTerrain(scene, renderCaps);
  // §7.2: river takes RenderCaps (the old callsite passed nothing — the
  // WebGPU transmission branch never ran and tier rules never applied).
  // &nf=1 disables the foam band (p5 foam A/B isolation).
  const river = createRiver(scene, renderCaps, { foam: urlParams.get('nf') !== '1' });
  // §7.2: decor takes RenderCaps (the old callsite passed nothing — tier
  // counts/shadow rules never applied and the WebGPU wind branch was dead).
  const decor = createDecor(scene, renderCaps);
  // Verification A/B: &nm=1 suspends mist placement (isolates the mist read
  // in §8 captures; zero cost otherwise).
  if (urlParams.get('nm') === '1') decor.mist.prob = {};

  // V-ATMOS: particles are biome-gated (dust → high_sierra, pollen →
  // jungle_lowlands, motes → cloud_forest) and take RenderCaps for the
  // §6.3 LOW-tier counts; shafts take caps for the 5/3 cluster rule.
  // spray stays unwired (no cascade fires in this height field — p5).
  const dustParticles = new ParticleSystem(scene, 'dust', renderCaps);
  const leavesParticles = new ParticleSystem(scene, 'leaves', renderCaps);
  const snowParticles = new ParticleSystem(scene, 'snow', renderCaps);
  const volumetrics = new VolumetricLightShafts(scene, todParam, renderCaps);

  // One atmosphere step shared by play mode and the shot harness: biome
  // visibility gate + deterministic sim-to-t + shaft re-anchor/opacity.
  // &np=1 suspends particles and &nv=1 suspends the shaft clusters (A/B
  // isolation of the shaft/particle reads, same discipline as &nm=1 for
  // mist and &nf=1 for foam).
  const particlesSuspended = urlParams.get('np') === '1';
  const shaftsSuspended = urlParams.get('nv') === '1';
  const updateAtmosphere = (pos: THREE.Vector3, time: number, regionId: string | null, tod: string | null) => {
    const gate = (system: ParticleSystem, region: string) => {
      system.points.visible = !particlesSuspended && regionId === region;
      if (system.points.visible) system.update(pos, time);
    };
    gate(dustParticles, 'high_sierra');
    gate(leavesParticles, 'jungle_lowlands');
    gate(snowParticles, 'cloud_forest');
    volumetrics.group.visible = !shaftsSuspended;
    volumetrics.update(pos, regionId, tod);
  };
  // Verification probe (shot tooling, same discipline as __rendererType):
  // lets the §8 harness assert the biome gate + particle field state.
  window.__atmosDebug = {
    dust: dustParticles.points,
    pollen: leavesParticles.points,
    motes: snowParticles.points,
  };

  const input = new InputManager();

  // P-MOBILE: the touch layer mounts its UI only on touch-capable devices
  // (or &touch=1 for desktop verification captures — plan §P5.3).
  const touchMode = isTouchLikeDevice() || urlParams.get('touch') === '1';
  const touchControls = new TouchControls(input, { active: touchMode });

  // p7 gate A/B suspension (&ncm=1): construct the character with the detail
  // maps disabled — the flat pre-p7 surface read for the wiring A/B pair
  // (same discipline as &np/&nv/&nm; must be set BEFORE construction).
  if (urlParams.get('ncm') === '1') setCharacterDetailMapsEnabled(false);

  const character = new CharacterController(scene, camera, input);

  // PWA/offline boot block
  registerServiceWorker();
  mountOfflineUI();

  const ui = initUI(character);

  // P-MOBILE F2/F7: the touch MENU button toggles the pause menu, and
  // pausing now actually pauses the sim (isPaused) and releases held touch
  // input. Previously the menu was Escape-only — unreachable on iPhone —
  // and even when open the loop kept running (stick input stayed live).
  const touchUI = new TouchUI(ui.root, {
    onPauseToggle: () => {
      if (ui.menu.isOpen) {
        ui.menu.close();
      } else {
        ui.menu.open();
      }
    }
  });
  touchUI.setVisible(false);

  ui.menu.onPause = () => {
    isPaused = true;
    touchControls.releaseAll();
    releaseWakeLock();
  };
  ui.menu.onResume = () => {
    isPaused = false;
    lastFrameTime = performance.now();
    if (journeyStarted && !ui.title.isOpen) void requestWakeLock();
  };

  ui.onJourneyStart = () => {
    journeyStarted = true;
    touchUI.setVisible(touchMode);
    resumeAudioContext();
    void requestWakeLock();
  };

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
  let composer: EffectComposer | null = null;
  let cinematicPass: ShaderPass | null = null;
  let postProcessing: PostProcessing | null = null;
  const isWebGPU = renderer instanceof WebGPURenderer;
  const skipPost = urlParams.get('tv') === '1';

  // Phase 9 V-POST adjudication levers (p8 &sx= pattern): §5.4 defaults, overridable
  // per capture so each post stage can be isolated/retuned without code forks.
  //   &bt= bloom threshold   (§5.4 default 0.85)
  //   &bs= bloom strength    (§5.4 default 0.35)
  //   &br= bloom radius      (§5.4 default 0.4)
  //   &vs= vignette strength (display-referred; §5.4 original 0.55 retuned → 0.25
  //        by the p9 measured sweep — 0 = off)
  //   &gs= grain amplitude   (§5.4 default 0.035; 0 = off)
  // Both post paths consume the SAME five numbers (§5.4 convergence rule).
  const postNum = (k: string, d: number) => {
    const s = urlParams.get(k);
    return s === null ? d : parseFloat(s);
  };
  const bloomThreshold = postNum('bt', 0.85);
  const bloomStrength = postNum('bs', 0.35);
  const bloomRadius = postNum('br', 0.4);
  const vignetteStrength = postNum('vs', 0.25);
  const grainAmount = postNum('gs', 0.035);

  if (!skipPost) {
      if (isWebGPU) {
          // WebGPU TSL Post Processing.
          // Phase 9 (J8): the cinematic grade is DISPLAY-referred — tone mapping
          // (ACES + TOD exposure) + sRGB encode happen IN-GRAPH via renderOutput()
          // BEFORE the vignette/grain, and PostProcessing's default end-of-graph
          // transform is disabled (outputColorTransform = false) so the frame is
          // graded exactly once. This mirrors the WebGL2 pass order: bloom (HDR)
          // → OutputPass → grade. (Pre-p9 the grade ran on linear HDR: the
          // ±0.035 grain was ±30 SDR levels on shadow pixels — the measured dusk
          // edge-crush driver. The p1 double-grade lesson is respected: the
          // default transform is REMOVED, not stacked on.)
          const { pass, uv, float, vec4, Fn, vec2, fract, renderOutput } = await import('three/tsl');
          const { PostProcessing: PostProcessingCtor } = await import('three/webgpu');
          const { bloom } = await import('three/examples/jsm/tsl/display/BloomNode.js');

          const scenePass = pass( scene, camera );

          // Bloom: §5.4 (0.35, 0.4, 0.85) — levered for the p9 attribution A/Bs
          const bloomPass = bloom(scenePass, bloomStrength, bloomRadius, bloomThreshold);

          const random = Fn(([p]: [any]) => {
              const K1 = vec2(23.14069263277926, 2.665144142690225);
              return fract(p.dot(K1).cos().mul(12345.6789));
          });

          const { convertToTexture } = await import('three/tsl');

          const cinematicNode = Fn( ( [ inputNode ]: [any] ) => {
             const uvNode = uv();
             const texNode = convertToTexture(inputNode);

             // Chromatic Aberration — channel-resampled at the source texture
             // (HDR; a pure spatial resample, ±0.0015 uv)
             const offset = vec2(0.0015, 0.0);
             const r = texNode.sample(uvNode.add(offset)).r;
             const g = texNode.sample(uvNode).g;
             const b = texNode.sample(uvNode.sub(offset)).b;
             const a = texNode.sample(uvNode).a;

             // Tone map + encode IN-GRAPH — display-referred from here on,
             // mirroring OutputPass on the WebGL2 path.
             let col = renderOutput(vec4(r, g, b, a)).rgb;

             // Vignette (display-referred)
             const dist = uvNode.sub(0.5).length();
             const factor = float(1.0).sub(dist.mul(vignetteStrength)).clamp(0.0, 1.0);
             col = col.mul(factor);

             // Film Grain — static (deterministic A/B frames) + display-referred
             // (±0.035 SDR ≈ ±9/255, the §5.4 intent)
             const noise = random(uvNode).sub(0.5).mul(grainAmount);
             col = col.add(noise);

             return vec4(col, a);
          } );

          postProcessing = new PostProcessingCtor( renderer as WebGPURenderer );
          postProcessing.outputColorTransform = false;
          postProcessing.outputNode = cinematicNode(bloomPass);

      } else {
          // WebGL2 Post Processing — same grade as the WebGPU graph (§5.4).
          // Phase 9 (J8): OutputPass (tone map + sRGB encode; its encode keys off
          // renderer.outputColorSpace, so mid-chain placement is supported — the
          // OutputPass docs bless sRGB-consuming followers) runs BEFORE the
          // cinematic grade, so vignette/grain operate display-referred: grain
          // ±0.035 is ±9/255 (the §5.4 intent), not the pre-p9 linear-HDR
          // ±30 SDR levels on shadows that measured as the dusk edge-crush.
          const { EffectComposer: EffectComposerCtor } = await import('three/examples/jsm/postprocessing/EffectComposer.js');
          const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
          const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
          const { ShaderPass } = await import('three/examples/jsm/postprocessing/ShaderPass.js');
          const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js');

          composer = new EffectComposerCtor(renderer as THREE.WebGLRenderer);
          const renderPass = new RenderPass(scene, camera);
          composer.addPass(renderPass);

          // iPhone budget rule: Bloom at half resolution on WebGL2 fallback
          const bloomRes = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
          const bloomPass = new UnrealBloomPass(bloomRes, bloomStrength, bloomRadius, bloomThreshold);
          composer.addPass(bloomPass);

          // Tone map + encode BEFORE the grade (display-referred grade, J8)
          const outputPass = new OutputPass();
          composer.addPass(outputPass);

          cinematicPass = new ShaderPass(CinematicShader);
          // Set deterministic time for WebGL2 grain
          cinematicPass.uniforms['time'].value = 0.0;
          cinematicPass.uniforms['vignetteStrength'].value = vignetteStrength;
          cinematicPass.uniforms['grainAmount'].value = grainAmount;
          composer.addPass(cinematicPass);
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
  let pomResult: TrimNodeMaterialResult | null = null;

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
          character.disableCameraUpdate = true;
          character.mesh.visible = false;
          camera.position.set(s.camera.x, s.camera.y, s.camera.z);
          camera.lookAt(s.lookAt.x, s.lookAt.y, s.lookAt.z);
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
    } else if (shot === 'sky_check') {
      // Verification-only framing (visual bible §8): horizon view with a slight
      // up-tilt so the sky dome + sun/moon discipline is auditable. `az` (deg)
      // picks the facing: az 135 = into the day sun; az 315 = anti-sun for the
      // blue-gradient check. Day: sun disc (elev 25°, az 135°). Night: sky-sun
      // parked BELOW the horizon (elev −12°, az 90°) — dome must read as night.
      character.teleport(0, 60, 0);
      character.disableCameraUpdate = true;
      camera.position.set(0, 60, 0);
      const azDeg = parseFloat(urlParams.get('az') || '135');
      const azRad = THREE.MathUtils.degToRad(azDeg);
      camera.lookAt(Math.sin(azRad) * 99, 78, Math.cos(azRad) * 99);
    } else if (shot === 'material_check') {
      // Verification-only framing (visual bible §8 + companion brief items
      // 1/2/5): six-band ashlar trim wall — fine ashlar, standard, megalithic,
      // fieldstone, carved, plaster — so the trim sheet, baked joint AO, and
      // (WebGPU MEDIUM/HIGH) POM read side by side in one capture. Block
      // pitches (0.67–2.0 m) provide scale; the §8.1 character audit stays in
      // `character_closeup` (Naira is parked ~200 m out — see below).
      // `az` (deg) picks the facing (sky_check convention). Default 240 puts
      // the wall normal ~77° off the day sun (az 135) — front-lit raking
      // light that shows joints/relief without normal-incidence blowout.
      // Measured (p2-5 audit): wall band p99 luminance 248, 0% of wall pixels
      // >250, no bloom spill across silhouettes; full frame max 252.3 with
      // zero pixels at pure white (strict §8.3 pass: the gate counts clipped
      // whites, of which there are none). The near-white 250–252 energy is
      // confined to the sun-side sky gradient above the wall (top-right
      // corner, ~4% of frame, bluish-white RGB mean — sky/fog, not masonry):
      // a near-miss noted in the PR (same §2.6×§5.4 threshold-proximity
      // observation for the Phase 1 grade owner).
      const azDeg = parseFloat(urlParams.get('az') || '240');
      const azRad = THREE.MathUtils.degToRad(azDeg);
      const dirX = Math.sin(azRad), dirZ = Math.cos(azRad);
      const perpX = dirZ, perpZ = -dirX;
      const anchorX = 50, anchorZ = 46;

      // Park Naira ~200 m out. A with/without diff capture (p2-5) proved her
      // dawn shadow reached the frame terrain even with her body off-screen
      // (sun elev 6° casts ~16 m shadows), so the material frame must be
      // character-free AND shadow-free — body and cast shadow out of range.
      character.teleport(anchorX + 200, anchorZ + 200, 0);
      character.disableCameraUpdate = true;

      const wallDist = 4.5, camDist = 2.5;
      const wallX = anchorX + dirX * wallDist, wallZ = anchorZ + dirZ * wallDist;
      const wallBase = getGlobalTerrainHeight(wallX, wallZ) - 0.1;

      const pom = await buildAshlarTrimNodeMaterial(renderCaps);
      pomResult = pom;
      const wallMat: THREE.Material = pom ? pom.material : ashlarTrimMaterial();
      const wallGroup = new THREE.Group();
      wallGroup.position.set(wallX, wallBase, wallZ);
      wallGroup.lookAt(anchorX - dirX * camDist, wallBase, anchorZ - dirZ * camDist);
      wallGroup.updateMatrixWorld(true);
      for (let i = 0; i < 6; i++) {
        const segGeo = new THREE.BoxGeometry(2, 3, 0.3);
        mapGeometryToTrimBand(segGeo, i, { vScale: 1.5 });
        const seg = new THREE.Mesh(segGeo, wallMat);
        // Ground each segment on the terrain beneath its own world center —
        // the wall stands on sloped ground, and a single flat base lets the
        // slope poke through the masonry in frame.
        seg.position.set(-5 + i * 2, 1.5, 0);
        wallGroup.add(seg);          // attach first so matrixWorld composes
        seg.updateMatrixWorld();     // group.matrixWorld × seg.matrix
        const segWorld = seg.getWorldPosition(new THREE.Vector3());
        const groundY = getGlobalTerrainHeight(segWorld.x, segWorld.z);
        seg.position.y = 1.5 + (groundY - wallBase);
        seg.castShadow = true;
        seg.receiveShadow = true;
      }
      scene.add(wallGroup);

      const camX = anchorX - dirX * camDist, camZ = anchorZ - dirZ * camDist;
      const eyeY = getGlobalTerrainHeight(camX, camZ) + 1.6;
      camera.position.set(camX, eyeY, camZ);
      // `lt` (m) sets the look-target height on the wall face. Per-ToD pitch,
      // measured against §8.3: dawn uses 3.0 (~17° up-tilt) because the flat-on
      // frame crushed 25.6% of frame to <10 luminance on shadow-side ground
      // (gate: 10% outside night); +1.8 → 19.5%, +2.6 → 12.3%, +3.0 → 8.7%.
      // dusk keeps 0.9 — at +3.0 the low west sun (az 270, elev 6°) enters the
      // frame and its bloom halo clips 6.4% >254 (gate: 2% clipped whites).
      // day/night pass at 0.9 (day: 0 clipped whites, frame max 252.3).
      const lt = parseFloat(urlParams.get('lt') || '0.9');
      camera.lookAt(wallX, wallBase + lt, wallZ);
    } else if (shot === 'shadow_check') {
      // Phase 8 verification scenario (visual bible §3.2/§3.3): MINIMAL
      // controlled shadow repro on a known flat deck — three 1 m boxes plus
      // the character on a uniform-albedo conforming plane, side-lit by the
      // day sun (elev 25°, az 135°; shadows fall toward az 315). Purpose:
      // adjudicate the p7-flagged "cast shadows dead scene-wide" between
      // (a) a rig-config bug — fixable, and (b) a headless rendering-stack
      // limitation — documentable. If even THIS repro casts nothing in the
      // container, the defect is the stack, not the scene.
      // &az= rotates the camera around the deck; default 225 puts the shadow
      // direction perpendicular to the view axis (side-lit read).
      // Pair with &sx= runtime experiments (below) for the A/B adjudication:
      // baseline vs sx=upm (apply the missing updateProjectionMatrix) vs
      // sx=off (shadowMap disabled). baseline==off pixel-identical proves
      // shadows never rendered; upm differing convicts the stale projection.
      character.teleport(250, 246, 0); // parked out of frame by default
      character.disableCameraUpdate = true;
      const azDeg = parseFloat(urlParams.get('az') || '225');
      const azRad = THREE.MathUtils.degToRad(azDeg);
      const dirX = Math.sin(azRad), dirZ = Math.cos(azRad);
      const perpX = dirZ, perpZ = -dirX;
      const ax = 50, az2 = 46; // material_check's measured valley-floor anchor

      // Deck: 24×24 m conforming plane floating 6 cm above the terrain so no
      // slope pokes through; uniform albedo = clean ROI for pixel-diff gates.
      const deckGeo = new THREE.PlaneGeometry(24, 24, 24, 24);
      deckGeo.rotateX(-Math.PI / 2); // XZ-planar, +y up
      const deckY = getGlobalTerrainHeight(ax, az2) + 0.06;
      const deckPos = deckGeo.attributes.position;
      for (let i = 0; i < deckPos.count; i++) {
        const wx = ax + deckPos.getX(i);
        const wz = az2 + deckPos.getZ(i);
        deckPos.setY(i, getGlobalTerrainHeight(wx, wz) + 0.06 - deckY);
      }
      deckGeo.computeVertexNormals();
      const deck = new THREE.Mesh(
        deckGeo,
        new THREE.MeshStandardMaterial({ color: 0xCFCFCF, roughness: 0.95, metalness: 0 })
      );
      deck.position.set(ax, deckY, az2);
      deck.receiveShadow = true;
      scene.add(deck);

      // Three known casters on the deck (castShadow AND receiveShadow).
      const boxMat = new THREE.MeshStandardMaterial({ color: 0x8A6F4D, roughness: 0.85, metalness: 0 });
      for (const off of [-2, 0, 2]) {
        const bx = ax + perpX * off, bz = az2 + perpZ * off;
        const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boxMat);
        box.position.set(bx, getGlobalTerrainHeight(bx, bz) + 0.56, bz);
        box.castShadow = true;
        box.receiveShadow = true;
        scene.add(box);
      }

      // Naira ON the deck (right of the box row, facing the camera): a
      // humanoid caster in the same controlled frame — also re-verifies the
      // p7 levitation fix under a working shadow pass.
      const chX = ax + perpX * 4, chZ = az2 + perpZ * 4;
      const camX = ax + dirX * 9, camZ = az2 + dirZ * 9;
      character.teleport(chX, chZ, Math.atan2(camX - chX, camZ - chZ));
      character.disableCameraUpdate = true;

      const eyeY = getGlobalTerrainHeight(camX, camZ) + 1.7;
      camera.position.set(camX, eyeY, camZ);
      camera.lookAt(ax, getGlobalTerrainHeight(ax, az2) + 0.8, az2);
    } else if (shot === 'river_crossing') {
      // East rim of the channel: with the Phase 5 water solve the trench at
      // x=0 holds ~6 m of water — the old (0, 0) teleport stands her on the
      // submerged bed. x=16 sits ~2.5 m above the waterline at z=0 (measured
      // from the height field), river in frame behind her.
      character.teleport(16, 0, Math.PI / 2);
    } else if (shot === 'terrain_check') {
      // Verification-only framing (visual bible §8.1 + T8/§4.1/§2.2–2.5):
      // biome color script, detail maps, snow line, riverbank wetness.
      // `&v=` picks the vantage; each keeps the character near the vantage
      // center (terrain chunks load around the CHARACTER, main.ts feeds
      // character position to terrainManager.update) but outside the frame.
      const v = urlParams.get('v') || 'sierra';
      const vantages: Record<string, { cx: number; cz: number; look: [number, number] }> = {
        // sierra: granite slopes + ichu flats (z 280–900). North aim: at
        // dawn ANY south-of-sun aim crushes shadow-side ground (16% <10 lum
        // measured), so the dawn capture uses sierra_lit below instead.
        sierra: { cx: 0, cz: 620, look: [0, 800] },
        // sierra_lit: NE-facing aim — dawn-lit slopes (0% crush measured);
        // NOT used at day, where it faces the sun and clips 2.2% on LOW.
        sierra_lit: { cx: -120, cz: 700, look: [-40, 920] },
        // snowline: in-snowfield aim, captured at DAWN — at day the snow
        // albedo (§2.3 #F2F5F7) + altitude fog + day grade white out the
        // frame (p50 249.9, structure-free — measured p3-5); dawn's warm
        // grade shows the blend. Also visible at altitude: a hard
        // loaded/unloaded chunk edge into fog void (pre-existing loader
        // cull, decor/region phases to revisit).
        snowline: { cx: 0, cz: 930, look: [-160, 970] },
        // riverbank: wet darkening along x≈0; stands on the EAST bank
        // looking NORTH along it (sun-ward frames fog-wash — p3-5 probe).
        river: { cx: 45, cz: 120, look: [10, 280] },
        // cloud forest floor: humus + wet stone
        cf: { cx: -60, cz: 100, look: [-140, 40] },
        // jungle lowlands: mud + swallowed limestone (z < -400); vantage
        // sits EAST of the river line (x≈0 is the river bed — in-bed
        // cameras whiteout on water+fog, measured p3-5), look ~65 m out so
        // fog-dense distance stays out of frame.
        jungle: { cx: 60, cz: -560, look: [-10, -620] },
        // paititi: north-along-flank aim (the height function makes x>600 a
        // vast smooth dome — no plaza flats until V-REG2 structures;
        // south aims face the day sun and clip ~27%, measured p3-5).
        // A faint chunk-seam sun-bleed streak may show (pre-existing
        // LOD T-junction crack — see worklog/PR observation).
        paititi: { cx: 680, cz: -40, look: [740, 90] },
        // boundary: cloud→sierra transition band — must blend, not seam.
        // North aim keeps the day sun out of frustum (east aim clipped
        // 11.3% on fog glow, measured p3-5); gradient reads in depth.
        boundary: { cx: -40, cz: 280, look: [0, 460] }
      };
      const vant = vantages[v] || vantages.sierra;
      // Generic override for verification iteration (p3-5): &cx=&cz=&lx=&lz=
      const num = (k: string, d: number) => {
        const s = urlParams.get(k);
        return s === null ? d : parseFloat(s);
      };
      const VX = { cx: num('cx', vant.cx), cz: num('cz', vant.cz), lx: 0, lz: 0 };
      VX.lx = num('lx', vant.look[0]);
      VX.lz = num('lz', vant.look[1]);
      const camDist = 26, camH = 15;
      const [lx, lz] = [VX.lx, VX.lz];
      const dx = lx - VX.cx, dz = lz - VX.cz;
      const dl = Math.max(0.001, Math.hypot(dx, dz));
      const ux = dx / dl, uz = dz / dl;
      const camX = VX.cx - ux * camDist, camZ = VX.cz - uz * camDist;
      // Character parks 10 m BEHIND the camera: near enough for the chunk
      // loader (which follows the character), behind the frustum so the
      // frame is terrain-only (blocky character is Phase 7's audit).
      character.teleport(camX - ux * 10, camZ - uz * 10, 0);
      character.disableCameraUpdate = true;
      const camY = getGlobalTerrainHeight(camX, camZ) + camH;
      camera.position.set(camX, camY, camZ);
      camera.lookAt(lx, getGlobalTerrainHeight(lx, lz) + 2, lz);
    } else if (shot === 'foliage_check') {
      // Verification-only framing (visual bible §8 + §7.3/§5.2 T5/§6.3/J3):
      // instanced foliage species per region palette, boulder rocks, valley
      // mist, T5 wind. `&v=` picks the vantage; day aims keep the day sun
      // (az 135) out of the frustum, dawn aims face the low east sun (az 90)
      // — the p3-measured lesson that shadow-side aims crush >10% of frame.
      // `&cd=`/`&ch=` override camera distance/height for framing iteration;
      // `&cx=&cz=&lx=&lz=` generic override as in terrain_check.
      const v = urlParams.get('v') || 'cf_floor';
      // `ly` = look-target height offset (m). Dawn rows tilt UP toward the
      // lit ridgeline: at the 6° dawn elevation every valley-floor bump casts
      // a 100–200 m shadow, so a ground-level aim crushes >20% of frame —
      // measured per vantage against §8.3 (p2's `lt` discipline).
      const vantages: Record<string, { cx: number; cz: number; look: [number, number]; ly?: number; ch?: number }> = {
        // cloud forest floor: broadleaf canopy + ferns + orchids + mist
        // (look ~55 m out so 8–25 m foliage fills the foreground band; aims
        // keep the frame on near-level contours — measured h(x,z) deltas ≤ 3 m
        // — so the eye-height camera never stares into a hillside)
        cf_floor: { cx: -60, cz: 100, look: [-110, 62] },
        // dawn (measured ch/aim sweep vs §8.3): elevated camera on the high
        // point, aim NNE across descending lit terrain, sun glow out of frame.
        // crush 9.96% / clip 0.000%. Earlier westward aims + ly tilts crushed
        // 18–28% (shadow faces fill the frame at any pitch — ly sweep 0/14/30/45).
        cf_dawnlit: { cx: -140, cz: 80, look: [-100, 160], ch: 18 },
        // sierra: ichu hillsides. Day aim runs NNW from the z 660 shoulder —
        // the earlier WNW aim raked a sun-facing slope into bloom blowout
        // (measured), and the z 610 dip aim stared into a 37 m climb. Dawn
        // keeps p3's NE-lit aim shortened for close-range grass.
        sierra_ichu: { cx: 40, cz: 660, look: [-20, 702] },
        // dawn aim keeps the far chunk boundary OUT of the sky region — a
        // higher aim catches the pre-existing LOD T-junction sun-bleed along
        // a chunk edge (p3-documented, skirt fix deferred) as a bright line.
        sierra_dawnlit: { cx: -120, cz: 700, look: [-90, 780] },
        // jungle: understory ferns + dark broadleaf (short aim keeps the
        // river-line fog wash out of the right half — measured)
        jungle_fern: { cx: 60, cz: -560, look: [38, -580] },
        jungle_dawnlit: { cx: 60, cz: -560, look: [140, -480], ch: 25, ly: 6 },
        // paititi: encroaching green at the city's edge. p3's proven
        // north-along-flank aim (the dome's pale stone + altitude fog
        // whiteouts straight-across day aims — measured p3 and again in the
        // first p4 probe); the west flank IS the city's edge, falloff region.
        paititi_edge: { cx: 680, cz: -40, look: [740, 90] },
        // valley: trees + riverbank boulders + mist over the river line
        valley_mix: { cx: 70, cz: 60, look: [10, 128] },
        // dawn (XFAIL row — measured 15.41% at ch 18): the channel floor sits
        // in 950 m shadow reach at the 6° sun; no valley-floor aim passes.
        // Documented, flagged to the light-rig owner.
        valley_dawnlit: { cx: 260, cz: 40, look: [0, 60], ch: 18 },
      };
      const vant = vantages[v] || vantages.cf_floor;
      const num = (k: string, d: number) => {
        const s = urlParams.get(k);
        return s === null ? d : parseFloat(s);
      };
      const VX = { cx: num('cx', vant.cx), cz: num('cz', vant.cz), lx: 0, lz: 0 };
      VX.lx = num('lx', vant.look[0]);
      VX.lz = num('lz', vant.look[1]);
      const camDist = num('cd', 10), camH = num('ch', vant.ch ?? 2.6);
      const [lx, lz] = [VX.lx, VX.lz];
      const dx = lx - VX.cx, dz = lz - VX.cz;
      const dl = Math.max(0.001, Math.hypot(dx, dz));
      const ux = dx / dl, uz = dz / dl;
      const camX = VX.cx - ux * camDist, camZ = VX.cz - uz * camDist;
      // Character parks behind the camera (chunk loader follows her), out of
      // frame; foliage instances fill the 8–25 m foreground anchor band (§1.1.1).
      character.teleport(camX - ux * 10, camZ - uz * 10, 0);
      character.disableCameraUpdate = true;
      const camY = getGlobalTerrainHeight(camX, camZ) + camH;
      camera.position.set(camX, camY, camZ);
      camera.lookAt(lx, getGlobalTerrainHeight(lx, lz) + 2 + num('ly', vant.ly ?? 0), lz);
    } else if (shot === 'water_check') {
      // Verification-only framing (visual bible §8 + §7.5/§5.2 T6/§2.4):
      // water body fill, Beer-Lambert depth read, edge foam, flow. `&v=`
      // picks the vantage; cx/cz/lx/lz/cd/ch/ly generic overrides as in
      // terrain_check/foliage_check; &nf=1 disables foam (A/B isolation).
      const v = urlParams.get('v') || 'run';
      const vantages: Record<string, { cx: number; cz: number; look: [number, number]; ly?: number; ch?: number; cd?: number }> = {
        // wide slow section at z≈55 (measured: water spans x −50…45, 6 m
        // deep at center) — camera on the east shoulder looking WNW across
        // the water toward the far bank. First aim (58,60)→(−30,78) gazed
        // ~6 m ABOVE the water plane at 90 m (hill-filled frame) — the
        // working aim crosses the surface at ~65 m.
        run: { cx: 45, cz: 55, look: [-20, 70], ch: 4 },
        // deep pool close-up at the z=0 narrows (trench floor −10, 6 m
        // column) — low camera, near bank foam in the foreground band.
        pool: { cx: 26, cz: 4, look: [-14, 16], ch: 3.2 },
        // §2.4 dark-water stretch (z < −400 jungle band): near-black green
        // blend + foam on the banks. North-facing aim — the day sun (az 135)
        // sky-glow whiteout wiped the first SSE attempt (p3's sun-ward rule).
        jungle_dark: { cx: 25, cz: -520, look: [-5, -450], ch: 4, ly: 2 },
        // waterline close-up: shore foam band + depth fade read (camera
        // looks across the shelf at grazing incidence).
        bank_foam: { cx: 30, cz: -30, look: [0, -46], ch: 2.2 },
        // DAWN rows (measured §8.3 sweeps, p5): at the 6° dawn sun the whole
        // trench is in wall shadow — the passing recipe is a LOW camera over
        // the water surface (sky-mirror fill) with the lit east bank as the
        // foreground anchor. run_dawnlit 9.70% crush, pool_dawnlit 8.82%
        // (both PASS <10); the standard day aims crush 13.9–29%.
        run_dawnlit: { cx: 20, cz: 30, look: [-30, 55], ch: 1.5, cd: 8 },
        pool_dawnlit: { cx: 20, cz: 45, look: [-30, 65], ch: 1.5, cd: 8 },
        // DUSK row (measured): the day aim mirrors the bright west sky and
        // clips 6.76% >254.5 (gate 2%); the north aim keeps the sun quadrant
        // out of the water streak — 0.000% clip / 5.33% crush.
        run_duskaim: { cx: 45, cz: 55, look: [0, 140], ch: 4 },
      };
      const vant = vantages[v] || vantages.run;
      const num = (k: string, d: number) => {
        const s = urlParams.get(k);
        return s === null ? d : parseFloat(s);
      };
      const VX = { cx: num('cx', vant.cx), cz: num('cz', vant.cz), lx: 0, lz: 0 };
      VX.lx = num('lx', vant.look[0]);
      VX.lz = num('lz', vant.look[1]);
      const camDist = num('cd', vant.cd ?? 10), camH = num('ch', vant.ch ?? 4);
      const [lx, lz] = [VX.lx, VX.lz];
      const dx = lx - VX.cx, dz = lz - VX.cz;
      const dl = Math.max(0.001, Math.hypot(dx, dz));
      const ux = dx / dl, uz = dz / dl;
      const camX = VX.cx - ux * camDist, camZ = VX.cz - uz * camDist;
      // Character parks behind the camera (chunk loader follows her), out
      // of frame — the frame is water-only.
      character.teleport(camX - ux * 10, camZ - uz * 10, 0);
      character.disableCameraUpdate = true;
      const camY = getGlobalTerrainHeight(camX, camZ) + camH;
      camera.position.set(camX, camY, camZ);
      camera.lookAt(lx, getGlobalTerrainHeight(lx, lz) + 2 + num('ly', vant.ly ?? 0), lz);
    } else if (shot === 'atmos_check') {
      // Verification-only framing (visual bible §8 + §5.2 T7/T9 + §3.3.3):
      // biome particles in their home regions + golden-hour shaft peak + a
      // far-vista row for the companion brief's aerial-perspective item.
      // &v= picks the vantage; cx/cz/lx/lz/cd/ch/ly generic overrides;
      // &rg= forces the biome gate; &np=1 suspends particles (A/B).
      const v = urlParams.get('v') || 'cf_shafts';
      const vantages: Record<string, { cx: number; cz: number; look: [number, number]; ly?: number; ch?: number; cd?: number; rg: string }> = {
        // Cloud forest, dawn: p4's measured cf_dawnlit recipe (elevated
        // camera on the high point, aim NNE across descending lit terrain,
        // sun glow out of frame — crush 9.96% / clip 0.000% in p4). The
        // first probe aimed ENE into the dawn sun disc (az 90) and clipped
        // 8.9% — the sun-ward rule again. Shafts read against the lit
        // hillside at 0.225 additive; motes drift through the beams.
        cf_shafts: { cx: -140, cz: 80, look: [-100, 160], ch: 18, rg: 'cloud_forest' },
        // Sierra, day: p4's sierra_ichu NNW shoulder, but pulled in tight
        // (aim ~35 m, camera ch 12, look 3 m DOWN into the shadowed valley
        // fold): the wide-haze first framing washed the dust out completely
        // (presence A/B 0.09% — backlit dust needs a darker background than
        // mist-bright hillsides; visibility is a framing property first).
        sierra_dust: { cx: 40, cz: 660, look: [-2, 692], ch: 12, ly: -3, rg: 'high_sierra' },
        // Jungle, day (bounds z ≤ −701): short NNW aim per p4's
        // jungle_fern lesson (river-line fog wash stays out of frame).
        jungle_pollen: { cx: 20, cz: -800, look: [-20, -845], ch: 4, rg: 'jungle_lowlands' },
        // Paititi, dawn: p4's paititi_edge vantage (west flank, north aim
        // along the flank — straight-across aims whiteout, measured p3+p4).
        // The p4 deferred hard-edged shaft cards showed in this region.
        paititi_regr: { cx: 680, cz: -40, look: [740, 90], ch: 9, rg: 'paititi' },
        // Far vista (companion brief item 7 — aerial perspective): from
        // the valley floor looking N at the sierra range ~800 m out;
        // distant peaks must fade blue into the sky with NO hard cutoff
        // (FogExp2 floor per §3.3.2 — evidence row, no geometry change).
        vista: { cx: 0, cz: 300, look: [0, 1150], ch: 14, rg: 'high_sierra' },
      };
      const vant = vantages[v] || vantages.cf_shafts;
      const num = (k: string, d: number) => {
        const s = urlParams.get(k);
        return s === null ? d : parseFloat(s);
      };
      const VX = { cx: num('cx', vant.cx), cz: num('cz', vant.cz), lx: 0, lz: 0 };
      VX.lx = num('lx', vant.look[0]);
      VX.lz = num('lz', vant.look[1]);
      const camDist = num('cd', vant.cd ?? 10), camH = num('ch', vant.ch ?? 4);
      const [lx, lz] = [VX.lx, VX.lz];
      const dx = lx - VX.cx, dz = lz - VX.cz;
      const dl = Math.max(0.001, Math.hypot(dx, dz));
      const ux = dx / dl, uz = dz / dl;
      const camX = VX.cx - ux * camDist, camZ = VX.cz - uz * camDist;
      character.teleport(camX - ux * 10, camZ - uz * 10, 0);
      character.disableCameraUpdate = true;
      const camY = getGlobalTerrainHeight(camX, camZ) + camH;
      camera.position.set(camX, camY, camZ);
      camera.lookAt(lx, getGlobalTerrainHeight(lx, lz) + 2 + num('ly', vant.ly ?? 0), lz);
      // Biome gate follows the vantage (generic &rg= still wins below).
      if (!urlParams.get('rg')) urlParams.set('rg', vant.rg);
    } else if (shot === 'character_closeup') {
      // V-CHAR material audit framing. Defaults keep the canonical framing
      // (2 m face-on at the torso); generic overrides follow the p3/p4/p5
      // pattern (all optional, all measured in the p7 evidence):
      //   cx/cz — character ground position (default 50, 50)
      //   cd    — camera distance south of the character (default 2 m)
      //   ch    — camera height above the character's ground (default 1.5 m)
      //   ly    — look-target height above the character's ground (default 1.0 m)
      //   ry    — character facing (radians, default 0 = toward the +z camera)
      //   nc=1  — hide the character (presence A/B: proves what pixels are hers)
      const num = (k: string, d: number) => {
        const s = urlParams.get(k);
        return s === null ? d : parseFloat(s);
      };
      const cx = num('cx', 50), cz = num('cz', 50);
      const cd = num('cd', 2), ch = num('ch', 1.5), ly = num('ly', 1.0), ry = num('ry', 0);
      character.teleport(cx, cz, ry);
      character.disableCameraUpdate = true;
      if (urlParams.get('nc') === '1') character.mesh.visible = false;
      const gy = character.mesh.position.y;
      camera.position.set(cx, gy + ch, cz + cd);
      camera.lookAt(cx, gy + ly, cz);
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
      // Bank position (p5): the trench at x=0 now holds water — spawn her on
      // the east shoulder so the shot frames logs dropping INTO the river.
      character.teleport(16, 2, 20);
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

    // Sun/shadow rig follows the shot's viewpoint (§3.2)
    getActiveLightRig()?.update(camera.position, camera);

    // V-FOLIAGE: decor was never updated in shot mode — every §8 capture so
    // far rendered the instances as an origin pile (all identity matrices).
    // Place foliage around the shot camera; ?t= drives the T5 wind clock so
    // two captures at different t show the §8.3 motion-ready displacement.
    decor.update(camera, tStr ? parseFloat(tStr) : 0);
    // p5: same discipline for the water flow clock — ?t= drives the scroll
    // uniforms so two captures at different t show §8.3 water motion.
    river.update(tStr ? parseFloat(tStr) : 0);
    // p6: same discipline for the atmosphere — particles simulate
    // deterministically to ?t= (fixed-timestep catch-up) and re-wrap around
    // the SHOT camera; shaft clusters re-anchor on the camera grid and read
    // their §3.3 intensity from the active grade. Region: prefix shots gate
    // biomes via the shot id; custom vantages can force one with &rg=.
    // (Particles/volumetrics were never updated in shot mode before —
    // every §8 capture rendered the origin-seeded pile or nothing.)
    {
      let activeRegionId = regionManager.currentRegionId;
      if (shot && shot.startsWith('region:')) activeRegionId = shot.replace('region:', '');
      const rg = urlParams.get('rg');
      if (rg) activeRegionId = rg;
      updateAtmosphere(camera.position, tStr ? parseFloat(tStr) : 0, activeRegionId, todParam);
    }

    // Shot-time chunk streaming (p4): the origin-centered chunk disc is
    // circle-culled (corners beyond chunk radius 4 unload), leaving fog-void
    // holes inside far vantage frames — p3's deferred "loader cull revisit",
    // measured as white void slabs in the early p4 probes. Stream chunks
    // around the SHOT camera so every vantage frames solid terrain.
    terrainManager.update(camera.position);

    // POM self-shadow uniform (HIGH tier): the tangent-space light march
    // consumes the active sun direction in view space, updated from the rig.
    if (pomResult) {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      const rig = getActiveLightRig();
      if (rig) {
        pomResult.sunDirectionView.value
          .copy(rig.sun.position).sub(rig.sun.target.position).normalize()
          .transformDirection(camera.matrixWorldInverse);
      }
    }

    // Phase 8 shadow experiments (&sx=): runtime A/B levers applied BEFORE the
    // first render so one capture isolates one candidate cause. These are
    // measurement probes — the committed fix (if convicted) lives in
    // lighting.ts. Levers:
    //   upm  — call shadow.camera.updateProjectionMatrix() on sun+moon (the
    //          p7-flagged latent bug: rig sets ±120 bounds, ortho projection
    //          matrix still holds the ±5 constructor default)
    //   wide — frustum ±400 + updateProjectionMatrix (shadow-REACH probe:
    //          dawn sun elev 6° casts 9.5× height — does ±120 truncate?)
    //   nb0  — normalBias 0 (rule out over-bias light leak; p7 A/B'd 1.5→0.1
    //          with no change, 0 is the floor)
    //   off  — renderer.shadowMap.enabled = false (control: what "no
    //          shadows at all" looks like; baseline must differ from this
    //          if any shadow renders anywhere)
    const sx = urlParams.get('sx');
    if (sx) {
      const rig = getActiveLightRig();
      if (rig) {
        const sunCam = rig.sun.shadow.camera;
        const moonCam = rig.moon.shadow.camera;
        if (sx === 'upm') {
          sunCam.updateProjectionMatrix();
          moonCam.updateProjectionMatrix();
        } else if (sx === 'wide') {
          sunCam.left = -400; sunCam.right = 400; sunCam.top = 400; sunCam.bottom = -400;
          moonCam.left = -400; moonCam.right = 400; moonCam.top = 400; moonCam.bottom = -400;
          sunCam.updateProjectionMatrix();
          moonCam.updateProjectionMatrix();
        } else if (sx === 'nb0') {
          rig.sun.shadow.normalBias = 0;
          rig.moon.shadow.normalBias = 0;
        } else if (sx === 'off') {
          renderer.shadowMap.enabled = false;
        }
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

    const rawDt = Math.min(clock.getDelta(), 0.1);
    const time = clock.getElapsedTime();

    if (cinematicPass) {
       cinematicPass.uniforms['time'].value = time;
    }

    // P-MOBILE verification tooling (&turbo=1): headless SwiftShader renders
    // at ~0.5 fps while dt is clamped to 0.1 s per rAF — the simulation then
    // advances ~30× slower than wall time and time-based control gates
    // starve. Turbo pumps fixed 1/60 s sub-steps — ~1 s of sim time per
    // rendered frame — so gate-relevant time passes at a workable rate.
    // Physics stays stable (fixed 1/60 step); rendering still happens once
    // per rAF. Off by default; zero effect on normal play or §8 captures.
    const turboSteps = urlParams.get('turbo') === '1' ? 60 : 1;

    if (!shotMode) {
      for (let step = 0; step < turboSteps; step++) {
        const dt = turboSteps > 1 ? 1 / 60 : rawDt;
        touchControls.update(dt);
        physics.update(dt);
        character.update(dt);
        terrainManager.update(character.mesh.position);
        regionManager.update(character.mesh.position);
        river.update(time);
        decor.update(camera);
        getActiveLightRig()?.update(character.mesh.position, camera);

        // V-ATMOS: one gated atmosphere step (region id first — the old order
        // updated particles before computing it, so the gate could not exist).
        const activeRegionId = regionManager.currentRegionId;
        updateAtmosphere(camera.position, time, activeRegionId, todParam);

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
    // Re-apply the wind clock: the pre-render decor.update ran BEFORE the
    // first render compiled the foliage shaders, so its uTime write hit a
    // not-yet-existing uniform object (the t0/t2 A/B pair diffed to exactly
    // zero — p4 gate audit caught it). Uniforms exist after render #1.
    decor.update(camera, tStr ? parseFloat(tStr) : 0);
    // p5: re-apply the water flow clock AFTER first-render compilation, same
    // reasoning as decor above.
    river.update(tStr ? parseFloat(tStr) : 0);
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

    // Verification readback (?readback=1): headless SwiftShader cannot present
    // WebGPU frames to the canvas, so expose the final post-processed frame as
    // a data URL for the capture tool. Only active in shot mode with the
    // explicit parameter — zero cost during normal play.
    if (urlParams.get('readback') === '1' && isWebGPU) {
      try {
        const { RenderTarget } = await import('three/webgpu');
        // SwiftShader (headless CI) is unstable for large/heavy readbacks, so
        // capture at a reduced resolution — enough to judge the grade.
        const w = 640;
        const h = 400;
        const rt = new RenderTarget(w, h);
        renderer.setRenderTarget(rt);
        if (!skipPost && postProcessing) {
          postProcessing.render();
        } else {
          await renderer.renderAsync(scene, camera);
        }
        const buf = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        const rgba = new Uint8ClampedArray(buf);
        const row = w * 4;
        const flipped = new Uint8ClampedArray(rgba.length);
        for (let y = 0; y < h; y++) {
          flipped.set(rgba.subarray((h - 1 - y) * row, (h - y) * row), y * row);
        }
        for (let i = 3; i < flipped.length; i += 4) flipped[i] = 255;
        const cnv = document.createElement('canvas');
        cnv.width = w; cnv.height = h;
        cnv.getContext('2d')?.putImageData(new ImageData(flipped, w, h), 0, 0);
        window.__frameDataURL = cnv.toDataURL('image/png');
        renderer.setRenderTarget(null);
        rt.dispose();
      } catch (e) {
        console.error('Verification readback failed:', e);
      }
    }

    setTimeout(() => {
      // V-CHAR probe (same discipline as __rendererType/__atmosDebug): lets the
      // §8 harness assert the character's final runtime state in shot mode.
      window.__charDebug = {
        pos: character.mesh.position.clone(),
        rotY: character.mesh.rotation.y,
        visible: character.mesh.visible,
        state: character.state,
        camPos: camera.position.clone(),
      };
      // Phase 8 shadow probe: evaluated AFTER the render so shadowMapAllocated
      // reflects whether the shadow pass actually ran (LightShadow.map is
      // allocated lazily on first shadow render).
      {
        const rig = getActiveLightRig();
        if (rig) {
          const sun = rig.sun;
          const sc = sun.shadow.camera;
          let meshes = 0, casters = 0, receivers = 0;
          scene.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              meshes++;
              if (o.castShadow) casters++;
              if (o.receiveShadow) receivers++;
            }
          });
          window.__shadowInfo = {
            rendererType: window.__rendererType || 'unknown',
            shadowMapEnabled: renderer.shadowMap.enabled,
            // WebGPURenderer's shadowMap type has no autoUpdate field (only
            // WebGLShadowMap does); the union needs narrowing.
            shadowMapAutoUpdate: renderer instanceof THREE.WebGLRenderer ? renderer.shadowMap.autoUpdate : true,
            shadowMapType: renderer.shadowMap.type,
            sunCastShadow: sun.castShadow,
            sunIntensity: sun.intensity,
            mapSize: [sun.shadow.mapSize.width, sun.shadow.mapSize.height],
            frustum: { left: sc.left, right: sc.right, top: sc.top, bottom: sc.bottom, near: sc.near, far: sc.far },
            projScaleX: sc.projectionMatrix.elements[0],
            projScaleY: sc.projectionMatrix.elements[5],
            bias: sun.shadow.bias,
            normalBias: sun.shadow.normalBias,
            sunPos: [sun.position.x, sun.position.y, sun.position.z],
            targetPos: [sun.target.position.x, sun.target.position.y, sun.target.position.z],
            meshCensus: { meshes, casters, receivers },
            shadowMapAllocated: !!sun.shadow.map,
          };
        }
      }
      window.__shotReady = true;
    }, 100);
  } else {
    animate();
  }
}

init().catch(e => {
  console.error(e);
});
