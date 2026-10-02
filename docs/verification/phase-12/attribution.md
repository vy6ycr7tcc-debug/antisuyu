# Phase 12 — Attribution (backlog sweep: selective bloom + buoyancy)

Branch `phase-12-backlog` from `phase-10-vreg1` (b32a7b2). PR base `phase-10-vreg1`,
stacked on flush PR #58. Plan: `docs/verification/phase-12/plan.md`.
WebGL2 / SwiftShader / MEDIUM tier; tsc + build clean; 0 real render errors
(1/row on some loads = the documented pre-existing sw.js dev MIME artifact).

## Work item A — selective emissive-only bloom (p9 flag, §5.4)

### Shipped design (v3)

The bloom source = **the scene itself, rendered through a sky-masked camera**:
- `bloomSources.ts`: the sky dome moves to `SKY_LAYER = 1`; the main camera
  enables it (`src.layers.enable`); the bloom camera (a clone with an INDEPENDENT
  `Layers` mask — `Object3D.copy` shares the Layers object, so the mask is
  reassigned) excludes exactly that bit. Pose/projection synced per frame and
  on resize.
- WebGL2: `bloomComposer = [RenderPass(scene, bloomCamera) → UnrealBloomPass
  (§5.4 bt/bs/br, half-res)]`, output kept HDR; a `BloomMixShader` ShaderPass
  (textureID `baseTexture`, the official selective-bloom construction) adds
  `base.rgb + bloom.rgb` at the exact slot UnrealBloom's internal blend occupied
  — J8 order preserved: bloom (HDR) → OutputPass → CinematicShader.
- WebGPU TSL: `skylessPass = pass(scene, bloomCamera)`;
  `bloomInput = scenePass.add(vec4(bloom(skylessPass, ...).rgb, 0))` — same
  composition point, `renderOutput()` untouched.
- `&sel=0` rebuilds the EXACT p9 whole-scene chain (attribution lever).

### Measured results (§8.3 + A/B rows in gate_audit.txt)

- **The p9 defect (day-sky wash) is fixed exactly**: cc_day `sel=1` = raw
  (`&bt=99`) **bit-exact** — meanL 119.69 vs the p9 chain's 178.63 (−58.94 of
  wash removed, residual 0.00), clip stays 0.000%.
- Dawn lamp framing: sel1-vs-sel0 63.2% of frame (mean|d| 21.3) — the dawn-sky
  wash gone; cc_day sel1-vs-sel0 97.6%; vo_day 0.9%; jl_overview 7.0% — region
  content identical, only sky-glow deltas.
- **XFAIL (in-container, measured)**: the selective chain's night lamp halo is
  ~1000× weaker than the whole-scene chain's (sel1-vs-bt99 < 8 display levels;
  the p9 chain's same-class pass produces max +169 AT the lamps, and a broad
  +31 sky-gradient lift). Lamp CORES still render (emissive in the base pass).
  Debug evidence trail (bloom-only views, high-pass blits, scale/gain sweeps):
  the whole-scene pass blurs the same lamp pixels its input contains, while a
  second composer's identical pass yields <8 levels from the same input —
  mapped to SwiftShader's HalfFloat mip behavior on isolated small sources
  (enlarging emitters restores blur but floods 14.7% of frame; a dim background
  field changes the behavior — both recorded here). **Halo magnitude is
  unmeasurable in-container; on-device pass owed** (extends the standing
  p1/p8/p9 device-owed item). `&sel=0` keeps the p9 chain one flag away.

### Dead ends (recorded so nobody re-walks them)

1. **Proxy-emitter scene** (v1): MeshBasicMaterial copies of lamp heads on an
   empty background — blur ≈ 0 (mip dilution of isolated sub-20 px emitters).
2. **Emitter scale/gain sweeps** (scale 2.5–8 × gain 1–12): blur returns but
   floods 14.3–14.7% of frame (in-ROI mean|d| 34–184 vs p9's 26) — the emitter
   model cannot reproduce the p9 footprint.
3. **Stale vite dep cache**: a long-lived dev server served a pre-optimization
   module graph that rendered the selective chain black (base unbound +
   missing re-bundle). Any node_modules edit or suspicion of staleness →
   restart vite with `--force`. Several "black frame" results in this trail
   were this artifact, not code.
4. Float32 `readRenderTargetPixels` on HalfFloat targets fails silently
   (GL INVALID_OPERATION → zeros): stage-probe readbacks lie; only final-frame
   canvas evidence is trustworthy.

## Work item B — buoyancy force model (p5 flag) + J7 seeds

- `river.ts`: exported `waterSurfaceY(x, z)` (surface height under the SAME
  channel solve as `waterDepthAt`; null = dry) and `WATER_FLOW = {x:0, z:-1}`
  (flowDir [0,1] in uv = −Z world after the plane's rotateX(-π/2)).
- `physics.ts`: per-body record `{mass, halfY, buoyK}`; fixed-step submerged-
  fraction model `a_up = g·K·f − 1.5·f·v_y` (equilibrium f = 1/K), gentle flow
  acceleration `1.2·f` along WATER_FLOW, water/land damping 2.0/0.5. Wood K=1.6
  (floats ~62% submerged), stone K=0.25 (sinks — rockslide unchanged). The
  bot-era block (hardcoded surface y=0.5, `|x|<20`, depth×500 impulse, 20 m/s
  per-step flow kick) removed.
- `spawnBuoyantDebris`: mulberry32(P12_SEED_DEBRIS) spawns INSIDE the trench
  just above the measured surface (was `Math.random()` ±5 m blanket).
  `spawnRockslide`: seeded (P12_SEED_ROCKSLIDE). Rope-bridge planks: wood.
- Probe: `&shot=buoyancy` exposes `window.__buoyancyProbe()` (position, vy,
  surface per body; shot-mode only).

### Measured results

- **Float equilibrium**: at t=4 every log center sits 0.28–0.92 m below its
  local surface (equilibrium predicts 0.375; late stragglers at t=8: all
  0.28–0.30 m, uniform terminal vy ≈ −0.17 m/s, gentle −Z flow drift
  z −2.27 → −3.72 over t=4→8). Pre-fix the logs rested on the trench bed
  ~6 m below the surface (p5 measurement).
- Pixel pairs: pre/post day 5.73% moved, dawn 4.62% (threshold 0.05%) — logs
  visibly risen.
- Determinism: buoyancy det repeat 0.000%, jl 0.000%, cc 0.000% (seeded spawns
  + fixed step; the documented wind-phase family absent in these framings).
- Probe outputs (JSON in the capture log): day/dawn identical bit-for-bit
  (tod-independent physics, deterministic).

## Gate

`scripts/p12_gate_audit.py` → `gate_audit.txt`: 18 §8.3 clip/crush rows PASS
(worst crush 9.76% = the documented mc_dawn lt=3.0 row), bloom A/B rows PASS,
buoyancy rows PASS, 1 documented in-container XFAIL (lamp-halo magnitude).
GATE: PASS.
