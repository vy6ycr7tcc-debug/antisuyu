# Phase 12 — Backlog Sweep Plan (selective bloom + buoyancy)

Branch: `phase-12-backlog` from `phase-10-vreg1` (b32a7b2). PR base: `phase-10-vreg1`
(stacked on flush PR #58). Scope: the last two actionable flags from the phase
audit trail. Out of scope (unchanged, container-owed): on-device WebGPU TSL +
shadow verification (p1/p8/p9).

## Work item A — selective emissive-only bloom (p9 flag, §5.4)

p9 measured that no linear threshold separates day-sky radiance (HDR 2–50) from
lamp emissive (2.0): the whole-scene high-pass bloom washes the day sky. The
flagged fix: bloom sources = emissive objects only.

Design (both paths symmetric, §5.4 numbers shared):

- `src/bloomSources.ts` — a proxy registry. After world build, traverse the
  scene for meshes whose material carries `emissiveIntensity > 0` (provenance:
  `lampEmissive()` is the ONLY emissive factory, §4.4). For each, add to a
  dedicated tiny `bloomProxyScene` a mesh sharing the source geometry and world
  transform, with a `MeshBasicMaterial` of `emissiveColor × emissiveIntensity`
  (HDR: 2.0 > threshold 0.85). Non-emissive geometry never enters the proxy
  scene, and the proxy scene has no background → day sky contributes nothing.
- `bloomCamera` = clone of the main camera; pose + projection synced each
  frame / on resize. The proxy pass renders from her exact viewpoint.
- WebGL2 chain (selective ON): `bloomComposer` = RenderPass(proxyScene,
  bloomCamera) → UnrealBloomPass (§5.4 bt/bs/br, half-res iPhone budget rule)
  kept HDR (no OutputPass); `finalComposer` = RenderPass(scene, camera) →
  mixPass (base.rgb + bloom.rgb, the official selective-bloom composition) →
  OutputPass → CinematicShader. J8 order preserved: bloom (HDR) → tonemap+encode
  → display-referred grade.
- WebGPU TSL chain (selective ON): `proxyPass = pass(bloomProxyScene,
  bloomCamera)`; `lampBloom = bloom(proxyPass, bs, br, bt)`; cinematic input =
  `scenePass.add(vec4(lampBloom.rgb, 0))` (HDR add before `renderOutput`).
- `&sel=0` lever: builds the EXACT p9 whole-scene chain for A/B attribution.
  Default `sel=1`.
- Registered set includes jungle fungus (0.35 < 0.85 threshold) — honest
  provenance; its bloom contribution is nil by the high-pass, verified below.
- Known caveat (documented, measured): proxy lamps have no depth from the main
  scene → a fully occluded lamp would halo through. No gate framing contains a
  fully-occluded lamp; observed and accepted.

Verification A (bloom):
1. Lamp intent alive: p9's ruin-lamp vantage (cloudForest 150,−300, night,
   &t= fixed) — sel=1 vs sel=0 vs bt=99 ROI diff. Expect sel=1 ≈ sel=0 (halo
   preserved), both ≫ bt=99.
2. Day wash removed: cc_day framing — sel=1 meanL vs sel=0 meanL vs raw
   (&bt=99 pre-tonemap reference). Expect sel=1 closer to raw than sel=0.
3. Sky-heavy clip: cc_day clip% must stay 0.000 (clip is raw-sky, not bloom).
4. Full §8.3 core matrix re-run (p11's 13 rows) — all PASS, deltas recorded.
5. Determinism: det pair 0.000% (no new randomness; grain static).

## Work item B — buoyancy force model (p5 flag) + J7 seeds

p5 measured "logs rest on the bed under water": the bot-era buoyancy block
hardcodes `riverLevel = 0.5` + `|x| < 20` (pre-dates the rebuilt river: the
trench holds 6 m, surface = bed(0,z) + DEPTH_CENTER), applies a raw
`depth × 500` impulse and a 20 m/s-per-step flow kick, and spawns debris with
`Math.random()` (J7 violation family, p10 ①/p11 ①).

Design:

- `river.ts`: export `waterSurfaceY(x, z): number | null` (surface height
  where flooded — same channel solve as `waterDepthAt`; null = dry) and
  `WATER_FLOW = { x: 0, z: -1 }` (river flowDir [0,1] in uv = −Z world, derived
  from the plane geometry's post-rotateX v-axis orientation).
- `physics.ts`: per-body record gains `{ mass, halfY, buoyK }`. Fixed-step
  buoyancy (before `world.step()`): submerged fraction
  `f = clamp((surface − y + halfY) / (2·halfY), 0, 1)`; upward accel
  `g·K·f` (equilibrium at f = 1/K); vertical drag `−vy·1.5·f`; horizontal flow
  accel `flowA·f` along WATER_FLOW. `K` defaults 0.25 (stone — sinks, rockslide
  behavior preserved); wood = 1.6 (floats ~62% submerged). Water damping 2.0 /
  land 0.5 (unchanged). Hardcoded riverLevel/|x|<20 removed.
- `spawnBuoyantDebris`: mulberry32(P12_SEED) spawns INSIDE the trench
  (x ∈ ±4, z ∈ ±4) just above the measured surface, wood K. `spawnRockslide`:
  seeded too (J7 discipline; canonical rockslide shot must be reproducible).
- Shot probe: `&shot=buoyancy` exposes `window.__buoyancyProbe()` (body x/y/z,
  vy, surface at body) — dev-shot-gated, zero cost in play.

Verification B (buoyancy):
1. Probe: after shot-mode settle (t=3), log centers float NEAR the surface
   (|center − (surface − submerged)| < 0.35 m, |vy| < 0.15 m/s) vs pre-fix
   centers ≈ 6 m below surface on the trench bed.
2. Pixel pair: pre/post fix at &shot=buoyancy (day + dawn) — diff > 1% moved
   (logs visibly risen), plus det repeat = 0.000%.
3. Rockslide det repeat 0.000% (seeded); rockslide visual behavior unchanged
   (stones still plummet — buoyK 0.25).

## Gate

§8.3 core matrix (p11 rows) + A/B rows above; thresholds per §8.3 (clip < 2%,
crush < 2% unless documented XFAIL). tsc + build clean. Evidence in
docs/verification/phase-12/.
