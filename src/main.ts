import { registerServiceWorker, mountOfflineUI } from "./pwa/offline.js";
import * as THREE from 'three';
import { createRenderer, getRenderCaps, QUALITY_TIERS } from './renderer.js';
import { setupEnvironment, getActiveLightRig } from './environment.js';
import { createTerrain } from './terrain.js';
import { createRiver } from './river.js';
import { createDecor } from './decor.js';
import { CharacterController } from './character.js';
import { InputManager } from './input.js';
import { TouchControls } from './touch/controls.js';
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
import { ashlarTrimMaterial, buildAshlarTrimNodeMaterial, mapGeometryToTrimBand, type TrimNodeMaterialResult } from './materials.js';
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

  const dustParticles = new ParticleSystem(scene, 'dust');
  const leavesParticles = new ParticleSystem(scene, 'leaves');
  const snowParticles = new ParticleSystem(scene, 'snow'); // Could conditionally add based on biome later
  const volumetrics = new VolumetricLightShafts(scene, todParam);

  const input = new InputManager();

  // touch controls block
  const touchControls = new TouchControls(input);

  const character = new CharacterController(scene, camera, input);

  // PWA/offline boot block
  registerServiceWorker();
  mountOfflineUI();

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
  let composer: EffectComposer | null = null;
  let cinematicPass: ShaderPass | null = null;
  let postProcessing: PostProcessing | null = null;
  const isWebGPU = renderer instanceof WebGPURenderer;
  const skipPost = urlParams.get('tv') === '1';

  if (!skipPost) {
      if (isWebGPU) {
          // WebGPU TSL Post Processing.
          // Tone mapping + exposure are NOT applied here: PostProcessing's
          // default output transform already applies renderer.toneMapping
          // (ACES) and renderer.toneMappingExposure (set from the TOD grade
          // in environment.ts). Adding them in-graph double-grades the frame
          // to white — visual bible §5.4.
          const { pass, uv, float, vec4, Fn, vec2, fract } = await import('three/tsl');
          const { PostProcessing: PostProcessingCtor } = await import('three/webgpu');
          const { bloom } = await import('three/examples/jsm/tsl/display/BloomNode.js');

          const scenePass = pass( scene, camera );

          // Bloom: strength 0.35, radius 0.4, threshold 0.85 (§5.4)
          const bloomPass = bloom(scenePass, 0.35, 0.4, 0.85);

          const random = Fn(([p]: [any]) => {
              const K1 = vec2(23.14069263277926, 2.665144142690225);
              return fract(p.dot(K1).cos().mul(12345.6789));
          });

          const { convertToTexture } = await import('three/tsl');

          const cinematicNode = Fn( ( [ inputNode ]: [any] ) => {
             const uvNode = uv();
             const texNode = convertToTexture(inputNode);

             // Chromatic Aberration — channel-resampled at the source texture
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

             // Film Grain — static to ensure deterministic frames for A/B convergence.
             const noise = random(uvNode).sub(0.5).mul(0.035);
             col = vec4(col.rgb.add(noise), col.a);

             return col;
          } );

          postProcessing = new PostProcessingCtor( renderer as WebGPURenderer );
          postProcessing.outputNode = cinematicNode(bloomPass);

      } else {
          // WebGL2 Post Processing — same grade as the WebGPU graph (§5.4).
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
          const bloomPass = new UnrealBloomPass(bloomRes, 0.35, 0.4, 0.85);
          composer.addPass(bloomPass);

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
    } else if (shot === 'character_closeup') {
      character.teleport(50, 50, 0);
      character.disableCameraUpdate = true;
      camera.position.set(50, character.mesh.position.y + 1.5, character.mesh.position.z + 2);
      camera.lookAt(50, character.mesh.position.y + 1.0, character.mesh.position.z);
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
      getActiveLightRig()?.update(character.mesh.position, camera);

      dustParticles.update(camera.position, 'dust');
      leavesParticles.update(camera.position, 'leaves');
      snowParticles.update(camera.position, 'snow');
      let activeRegionId = regionManager.currentRegionId;
      if (shotMode && shot && shot.startsWith('region:')) {
          activeRegionId = shot.replace('region:', '');
      }
      volumetrics.update(camera.position, activeRegionId, todParam);

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
      window.__shotReady = true;
    }, 100);
  } else {
    animate();
  }
}

init().catch(e => {
  console.error(e);
});
