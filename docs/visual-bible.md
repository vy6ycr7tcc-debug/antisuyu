# Juzu Visual Bible v1.0

**Status:** normative. Every visual session treats this document as law.
**Scope:** LOOK only. Spoiler-free — no plot, no story beats, no quest content.
**Repo:** `vy6ycr7tcc-debug/juzu`. Do not modify the repo to satisfy this file; the bible is a doc, not code.

## How to read this document

- **NORMATIVE** sections (numbered rules, DO / DO NOT pairs, numeric ranges, interface
  shapes) are buildable spec. Follow them exactly. Where a rule gives a range, any value
  inside the range is acceptable; where it gives an exact value, use that value.
- **MOOD** blocks are evocative description. They are separated from spec and marked
  `> MOOD:`. Use them to calibrate taste; never treat them as build instructions.
- Adjectives never override numbers. If a MOOD block says "golden" and a rule says
  sun color `#FFB347`, the hex wins.
- "Photorealism bar" (from BRIEF.md): **every frame must be defensible as a photograph.**
  No stylization, no toon shading, no gamey glow.

## Terminology

- **WebGPU path** = `WebGPURenderer` from `three/webgpu`. Primary renderer, design target.
- **WebGL2 path** = `THREE.WebGLRenderer`. Mandatory fallback (older iPhones are WebGL-only).
- **TSL** = Three Shading Language, imported from `'three/tsl'` (bundled via Vite; this is
  the import the existing `src/main.ts` post pipeline already uses).
- **Shot** = `?shot=<sceneId>` still-frame capture, gated on `window.__shotReady`.
- **Blind agent** = you, the reader. If a rule is ambiguous to you, it is ambiguous, period.
  Prefer the more literal reading.

---

## §0 — Recon: file-ownership map (informative, locks session boundaries)

Inventory of every file that controls how the game looks, as of main after Phase 7
(7A save, 7B2 cleanup, 7C/7D/7E regions merged). This table defines the non-overlapping
file boundaries for the parallel visual sessions. **Two sessions never own the same file.**

| File | Visual system owned | Owned subsystems / notes |
|---|---|---|
| `src/renderer.ts` | Renderer bootstrap + quality tiers | `createRenderer()` → `{renderer, quality}`; `QUALITY_TIERS` (HIGH/MEDIUM/LOW); `CinematicShader` (grain + chromatic aberration, WebGL2 path). Detects WebGPU, falls back to WebGL2. |
| `src/environment.ts` | Sky, atmosphere, fog, IBL | Preetham physical sky (`SkyMesh` on WebGPU, `Sky` on WebGL2); `FogExp2`; `?tod=` grades; `scene.environment` (PMREM on WebGL2, flat 4×4 DataTexture placeholder on WebGPU — see judgment call J4). |
| `src/lighting.ts` | **NEW — light rig** (extract from `environment.ts`) | Sun/moon directional, hemisphere ambient, camera fill, shadow-map config, per-region light overrides. See §7 for the exact interface. |
| `src/materials.ts` | **NEW — shared PBR material library** | Every stone/metal/wood/fabric/water material in the game. Regions and systems import from here; they do not define their own. See §4 and §7. |
| `src/terrain.ts` | Terrain geometry + ground material | `getGlobalTerrainHeight(x, z)` — **shared height function** used by `decor.ts`, all four region modules, and character placement. Chunked LOD meshes, vertex-color biome blending, terrain PBR material. |
| `src/textures.ts` | Procedural texture factory | `createNoiseTexture(size, scale, octaves)`, `createNormalTexture(size, scale, intensity)` — shared by terrain, decor, river. |
| `src/decor.ts` | Instanced vegetation + rocks + mist | `DecorManager`: 5000 tree instances, 2000 rock instances, 200 mist planes; deterministic seeded placement around camera. Currently cone "trees" — slated for full replacement (§4). |
| `src/river.ts` | Water surfaces | `createRiver(scene)` → `{mesh, update}`. Currently one 40×1000 plane, glass-like transmission, **no flow animation** (update is a no-op). |
| `src/volumetrics.ts` | Light shafts | `VolumetricLightShafts(scene, todParam)`: additive gradient billboards in 5 clusters. **Uses `Math.random()` — non-deterministic**; must become seeded. |
| `src/particles.ts` | Ambient particles | `ParticleSystem(scene, type)` with types `dust | leaves | snow | spray`; `update(cameraPosition, type)`. CPU-simulated `THREE.Points`, soft radial sprites. |
| `src/character.ts` | Protagonist materials | Naira's skin/cloth/hair/leather `MeshPhysicalMaterial`s. Geometry/rig out of scope for visual pass; material response is in scope. |
| `src/regions/cloudForest.ts` | Cloud-forest set dressing | Exports `RegionModule` (`id: 'cloud_forest'`). Builds: blockade, excavated ruin, quipu archive chamber, cliff staircase. Uses ad-hoc flat `MeshStandardMaterial`s — must migrate to `materials.ts`. |
| `src/regions/highSierra.ts` | High-sierra set dressing | `id: 'high_sierra'`. Builds: qenko marker, chakana gate + cliff walls, sayhuite table plaza, outpost, paqarina descent. Own `stoneMat/carvedStoneMat/bronzeMat` — must migrate. |
| `src/regions/jungleLowlands.ts` | Jungle set dressing | `id: 'jungle_lowlands'`. Builds: serpent arches, tunnels, vanguard holdout, submerged passage. **Contains neon emissive fungus + teal point light — violates §4, must be restrained/removed.** |
| `src/regions/paititi.ts` | Paititi set dressing | `id: 'paititi'`. Builds: terraces, plaza of sun (gold disk + rings), sanctuary rotunda, aqueduct line, solar observatory. Own `stoneMaterial/goldMaterial/bronzeMaterial/waterMaterial` — must migrate. |
| `src/world/contracts.ts` | **FROZEN — read-only** | `RegionModule`, `POIDef`, `EncounterDef`, `QuestStageDef`, `RegionShotDef`, `RegionBuildAPI`, normative region AABBs. Never modified by visual sessions. |
| `src/main.ts` | Composition + post + shot hook | Owns: `?shot=` dispatch, post pipelines (TSL graph on WebGPU / EffectComposer on WebGL2), animate loop, `?tod=` param. Visual sessions touch ONLY their named sections. |

### Shared interfaces (import, don't duplicate)

1. `getGlobalTerrainHeight(x: number, z: number): number` (`terrain.ts`) — the single source
   of truth for ground height. Used by `decor.ts`, all four region `build()` functions.
   **DO NOT** invent a second height function.
2. `createNoiseTexture` / `createNormalTexture` (`textures.ts`) — the only procedural
   texture generators. New noise needs go here.
3. `setupEnvironment(scene, quality, renderer, todParam)` (`environment.ts`) — sky/fog/IBL.
4. `createRenderer()` (`renderer.ts`) — renderer + quality tier. Renderer-type detection
   pattern used across the codebase: `renderer instanceof WebGPURenderer` (WebGPU branch)
   vs `renderer.isWebGLRenderer` (WebGL2 branch). **Every new visual module must follow
   this exact detection pattern** (see §5).
5. `RegionBuildAPI` (`contracts.ts`) — `{ scene, flags, terrainHeight(x,z), onEnterRegion(cb),
   onExitRegion(cb) }`. Region `build()` functions receive everything through this; they
   never touch renderer internals.
6. `window.__shotReady` — set `true` after the shot frame renders. The gate polls it.

### Current-state notes (what the visual wave is fixing)

- Region modules define materials inline as flat untextured `MeshStandardMaterial`s
  (e.g. `color: 0x808080, roughness: 0.8`). This is the single biggest photorealism gap.
- `environment.ts` mixes sky, fog, lights, and IBL in one 127-line function; the light rig
  must be extracted to `src/lighting.ts` so V-SKY and V-LIGHT don't collide.
- Post pipelines diverge: WebGPU gets vignette only; WebGL2 gets bloom + grain + chromatic
  aberration. The primary renderer currently has the *weaker* grade. §5 fixes this.
- Trees are `ConeGeometry` instances. Rocks are `DodecahedronGeometry`. Both read as
  low-poly placeholders at any distance under 60 m.

---

## §1 — Target look

Drawn from the locked reference set — **Assassin's Creed, Tomb Raider, Horizon Zero Dawn,
Uncharted** — original art in their spirit, never copying their IP (no named locations,
characters, costumes, UI motifs, or music from those games).

> MOOD: You crest a ridge at dawn and the valley below is real — mist sitting in the
> folds, a river catching the sun in one bright thread, stone terraces stepping down like
> something built by people who intended to stay a thousand years. Nothing glows that
> shouldn't. Nothing floats. The wonder is that it all *works*.

### 1.1 What "AAA third-person adventure" means here (normative)

1. **Composition.** Every authored shot follows: a clear foreground anchor (rock, tree,
   terrace wall) within 8–25 m of camera, a midground subject (POI structure) at
   25–120 m, and layered background ridges fading into atmospheric perspective. No shot
   may be an empty vista with no foreground.
2. **Density of set dressing.** Within a 60 m radius of any POI anchor: minimum 40
   discrete dressing elements (stones, plants, debris, structural fragments), no two
   identical transforms adjacent (vary rotation ±180°, scale ±25%). Beyond 60 m, density
   may fall off; beyond 300 m, silhouette and atmosphere carry the frame.
3. **Material response.** Every surface shows: albedo variation (no flat color fields
   larger than 2 m without texture breakup), a roughness story (wet vs dry, worn vs
   fresh), and contact darkening (AO or gradient) where objects meet the ground.
   Specular highlights must resolve on stone edges, water, and metal — a frame with zero
   visible specular response fails the photorealism bar.
4. **Atmosphere.** Every exterior shot contains at least two of: distance haze, mist
   planes, dust motes in light, light shafts, or cloud shadows. Interiors/caverns
   contain at least one of: dust motes, shaft from an opening, or bounce-light gradient.
5. **Camera.** Third-person over-the-shoulder, 55–65° FOV (current: 60° — keep).
   Shot-mode cameras (see §8) use 40–70° FOV; never wider (fisheye distortion breaks
   the photograph test).

### 1.2 Per-touchstone emulation targets (which system copies what, structurally)

| Touchstone | Systems to emulate | What it means concretely |
|---|---|---|
| Assassin's Creed | Traversal readability, living-world density | Climbable surfaces read via consistent edge highlighting (worn stone color, not UI markers); ambient wildlife/insects as particle systems; viewpoints framed with foreground anchors. |
| Tomb Raider | Tomb/puzzle spaces, survival texture | Enclosed stone spaces: damp roughness (0.55–0.7), dripping water particles, single strong key light from an opening; Naira's materials weather-worn, never clean. |
| Horizon Zero Dawn | Vegetation density, light quality | Instanced foliage at 3–5k instances per region view with per-instance hue/scale variation; tall grass/fern cards; god-ray shafts through canopy; rich warm/cool color contrast. |
| Uncharted | Cinematic set-pieces, authored climbing | Hand-placed dressing along traversal lines (every handhold within a climb path gets a worn-edge material variant); vista reveals staged with foreground framing. |

### 1.3 Hard prohibitions (apply to every session)

- DO NOT use emissive materials for anything that is not a real light source
  (torch, lamp, work light, sun disk). See §4.4 for the emissive budget.
- DO NOT use saturated neon colors anywhere (no `#00FFAA` fungus, no pure-red
  `#FF0000` markers — the current `chargeMaterial` in `paititi.ts` must be replaced).
- DO NOT float geometry. Every mesh either rests on terrain height
  (`getGlobalTerrainHeight`), is embedded ≥0.3 m into it, or is structurally supported
  (bridge cables, pillars) with visible load paths.
- DO NOT leave interiors lit evenly. Real enclosed spaces fall off to near-black away
  from openings; use 1–2 motivated lights maximum per enclosed space.
- DO NOT add UI markers, floating icons, or outline highlights to make puzzle elements
  "read." Readability comes from material contrast, lighting, and composition.

---

## §2 — Palette

### 2.1 Global rules

- All hex values are sRGB albedo/paint colors. Under ACES tone mapping they render
  darker and more saturated — author 10–15% brighter than the mental target.
- Sky, fog, and light colors are specified per time-of-day in §3, not here.
- Accent colors (gold, orchid, fungus) may occupy **at most 5% of any frame's pixels**.
  If an accent dominates a shot, desaturate it.

### 2.2 Cloud forest (`cloud_forest`) — wet, green, mist

| Role | Hex | Usage |
|---|---|---|
| Canopy deep green | `#2D4A22` | Foliage base, shadowed leaves |
| Canopy mid green | `#3E5E2A` | Foliage lit variation |
| Moss | `#5A7247` | Stone/wood moss patches (roughness 0.95) |
| Mist blue-grey | `#A8B8B0` | Mist planes, fog tint |
| Wet stone | `#5A5A58` | Ruin stone (roughness 0.6, darker when wet) |
| Humus/earth | `#3B2E22` | Ground, excavation pit |
| Rotting wood | `#5C4033` | Fallen trunks, blockade timbers |
| Orchid accent | `#C9A0DC` | Sparse flowers only, ≤2% of frame |
| Canvas/tent (Sol Negro) | `#7A2E2E` | Muted dark red, desaturated — antagonists' gear is worn, not vivid |

Dressing vocabulary: hanging moss strands, broadleaf cards, orchid clusters on trunks,
fallen logs, stone blocks half-sunk in humus, rope bridges (fiber, not chain).

### 2.3 High sierra (`high_sierra`) — thin air, hard light, gold grass

| Role | Hex | Usage |
|---|---|---|
| Ichu grass | `#9A8B4F` | Grass tufts, lit |
| Ichu shadow | `#6B6335` | Grass tufts, shadowed |
| Granite | `#6E6A63` | Cliff faces, outcrops |
| Granite dark | `#4E4A44` | Crevices, scree |
| Snow | `#F2F5F7` | Snowfields (roughness 0.55, slight blue in shadow) |
| Snow shadow blue | `#C9D6E2` | Snow in shadow — never pure grey |
| Sky zenith | `#2E5FA3` | Reference for sky shader tuning at altitude |
| Terracotta | `#A85B32` | Village roofs, pottery shards |
| Ashlar limestone | `#B5A98F` | Inca stonework (see §4.3) |
| Bronze | `#8C6A3F` | Mechanisms, dials (metalness 0.85, roughness 0.45) |

Dressing vocabulary: terraced retaining walls, ashlar gateways, gnomons and solar
markers, stone-lined water channels, cairns, condor silhouettes (distant, animated),
lichen patches on rock (`#7A8A5A`, roughness 1.0).

### 2.4 Jungle lowlands (`jungle_lowlands`) — dense, dark water, swallowed ruins

| Role | Hex | Usage |
|---|---|---|
| Canopy dark | `#1E3A1E` | Upper canopy, low light |
| Understory green | `#2F5230` | Mid-layer foliage |
| Dark water | `#14261E` | River/pools (near-black green) |
| Mud | `#4A3826` | Banks, tunnel floors |
| Swallowed limestone | `#B8B0A0` | Ruin stone reclaimed by jungle, heavy moss |
| Fungus (restrained) | `#7FB069` | Desaturated sage — NOT neon; emissiveIntensity ≤ 0.35, only as faint bioluminescent accent |
| Carved spiral accent | `#C9A86A` | Weathered gold-ochre on carvings (metalness 0.3, roughness 0.6) |

Dressing vocabulary: buttress roots, liana strands, serpent-arch stonework, half-buried
carved blocks, black-water pools with foam edges, tunnel debris fields.

### 2.5 Paititi (`paititi`) — the earned city; stone, sun, water

| Role | Hex | Usage |
|---|---|---|
| Ashlar light | `#CFC6B4` | Primary city stone, sunlit faces |
| Ashlar shadow | `#A89E86` | City stone, shaded faces |
| Plaza stone | `#9A917E` | Worn paving (roughness 0.7, polished paths 0.45) |
| Gold | `#D4A017` | Metalness 1.0, roughness 0.32–0.38. Sun disk, rings, inlay. NEVER emissive. |
| Bronze | `#8C6A3F` | Mechanisms (metalness 0.85, roughness 0.45) |
| Channel water | `#2E5A6E` | Aqueduct/canal water, clear over stone |
| Encroaching green | `#2E5A2E` | Vegetation at the city's edges only — the city itself is maintained stone |

Dressing vocabulary: concentric terraces, precision-fit ashlar walls (joints ≤ 2 cm
visually), solar observatory rings, water channels with audible-visible flow, plaza
dais, pillar colonnades. Scale rule: civic structures ≥ 3× Naira's height (5.4 m+);
doorways 2.2–2.8 m.

### 2.6 Global day / sunset / night grades

These tint the light rig (§3), not the albedo palette. Listed here so sessions grade consistently.

| Grade | Sun color / intensity | Hemi sky / ground / intensity | Fog color / density | Exposure | Sky turbidity / rayleigh |
|---|---|---|---|---|---|
| Day (default, `?tod` unset) | `#FFF4E5` / 4.5 | `#BDD3F0` / `#5A5A48` / 0.5 | `#87B5FF` / 0.0015 | 1.1 | 10 / 2.0 |
| Dawn (`?tod=dawn`) | `#FFA500` / 2.2, elev 6° | `#D8C4B0` / `#4A4038` / 0.25 | `#D0B49F` / 0.0022 | 1.0 | 12 / 2.5 |
| Noon (`?tod=noon`) | `#FFFFFF` / 5.5, elev 82° | `#C8DCF5` / `#6A6A55` / 0.65 | `#9BC0FF` / 0.0011 | 1.15 | 8 / 3.0 |
| Dusk (`?tod=dusk`) | `#FF8C00` / 2.0, elev 6° | `#C4A490` / `#423A30` / 0.25 | `#B28C70` / 0.0022 | 1.0 | 12 / 2.5 |
| Night (moon) | `#9FB8DD` / 0.5, elev 35° | `#2A3A55` / `#1A1A18` / 0.15 | `#1E2A3A` / 0.0028 | 0.85 | n/a (stars) |

- Sun elevation/azimuth: day 25°/135°, dawn 6°/90° (east), noon 82°/180°, dusk 6°/270° (west).
- Night is a required grade: the moon rig must exist even though no session has built it yet.
- Under-exposure is preferable to clipping: no pixel region larger than 2% of frame may
  clip to pure white except the sun disk itself.

---

## §3 — Lighting rules

### 3.1 The rig (normative — implemented in `src/lighting.ts`)

Every scene uses exactly this rig. No additional lights except the two narrow cases in 3.4.

| Light | Type | Color | Intensity (day) | Position / notes |
|---|---|---|---|---|
| Sun | `DirectionalLight`, `castShadow: true` | §2.6 per ToD | §2.6 per ToD | Elevation/azimuth per §2.6; target follows the player (see 3.2) |
| Sky ambient | `HemisphereLight` | sky/ground per §2.6 | §2.6 per ToD | No shadows; carries the "thin-air blue" |
| Camera fill | `DirectionalLight`, `castShadow: false` | `#CFD8E8` | 0.35 | Positioned at camera position + camera forward × −50 + up × 30, updated per frame; lifts crushed shadows on Naira's camera-facing side only |
| Moon | `DirectionalLight`, `castShadow: true` | `#9FB8DD` | 0.5 | Night grade only; reuses the sun's shadow camera |

- Tone mapping: `ACESFilmicToneMapping` on both renderers. Exposure per §2.6.
- IBL: `scene.environment` from PMREM of the sky (see §5.2). `scene.environmentIntensity`:
  0.55 day, 0.35 dawn/dusk, 0.25 night. Materials' `envMapIntensity` multiplies this —
  keep material-level `envMapIntensity` at 1.0 and control globally unless a material
  needs a deliberate exception (water: 1.2; deep interiors: 0.3).
- Shadow type: `PCFSoftShadowMap` on WebGPU, `PCFShadowMap` on WebGL2 (see §5.3).

### 3.2 Shadow discipline (the current d=1500 box is too coarse — replace)

- Shadow camera follows the player: each frame, set `sunLight.position = playerPos +
  sunDir × 300`, `sunLight.target.position = playerPos`.
- Ortho frustum half-extent `d`: **120** on HIGH, **90** on MEDIUM/LOW (was 1500 — that
  spread 2048 px over 3 km; texel density was ~1.5 m/px, which is why shadows look soft
  and detached).
- `shadow.mapSize`: 2048 HIGH / 1024 MEDIUM / 1024 LOW (WebGPU); 1024 / 1024 / 512 (WebGL2).
- `shadow.bias`: −0.0005. `shadow.normalBias`: 1.5 (was 2.0 — was detaching contact shadows).
- `shadow.camera.near`: 10, `far`: 800.
- Contact rule: any object resting on terrain must show a visible contact shadow at
  10 m viewing distance. If it doesn't, tighten `normalBias` before adding AO decals.

### 3.3 Andean light (what makes it the Andes, not generic fantasy)

1. **High-altitude sun is hard.** Shadow edges crisp (small shadow radius), sun
   intensity high (4.5–5.5 day). Interiors and north faces go properly dark — do not
   "help" them with extra fill beyond the camera fill in 3.1.
2. **Thin air, deep blue.** Zenith sky at altitude must read cobalt (`#2E5FA3`
   reference); rayleigh 2.0–3.0. Haze sits in valleys (fog density higher at low
   altitude — the FogExp2 global value is the floor; region sessions may add local mist
   planes, never subtract).
3. **Golden hour is the money light.** Dawn/dusk grades exist for beauty shots and
   solar-alignment puzzle beats: long shadows, warm key at 6° elevation, cool blue
   shadow fill. Volumetric shaft intensity peaks here (see §6 in volumetrics: 0.15).

### 3.4 Additional lights — allowlist (only these, nothing else)

1. **Functional lamps**: torches, work lights, interior lanterns. `PointLight`,
   color `#FFB45E`, intensity 8–20 (physical falloff, distance 12–25, decay 2).
   Maximum 4 active within 60 m of the player; region `build()` must register lamps and
   the region manager culls beyond range. Lamp meshes use the emissive budget (§4.4).
2. **Water sparkle accents**: none as lights. Sparkle comes from env reflection on the
   water material, not from lights.
3. Everything else — bioluminescence, magic glows, rim lights on characters — is
   **forbidden**. If a region currently has such a light (jungleLowlands' teal
   `PointLight`), remove it or convert it to a restrained emissive surface per §4.4.

---

## §4 — Material rules

### 4.1 PBR standards (every material in the game)

| Property | Rule |
|---|---|
| Albedo | sRGB hex from §2. No pure black (`#000000`) or pure white (`#FFFFFF`) albedos — clamp to `#0A0A0A`…`#F0F0F0`. |
| Roughness | Always set explicitly. Ranges: fresh ashlar 0.75–0.85; weathered stone 0.85–0.95; worn paving (polished by feet) 0.45–0.55; bronze 0.4–0.5; gold 0.32–0.38; wood 0.8–0.9; cloth 0.9–1.0; skin 0.55–0.65; water 0.05–0.15; snow 0.5–0.6; wet rock 0.5–0.65. |
| Metalness | Stone/wood/cloth/vegetation: 0.0–0.1. Bronze: 0.85. Gold: 1.0. Never leave metalness at the three.js default 0.0 for metals — set it. |
| Normal maps | Required on any surface larger than 2 m² viewed within 30 m. Procedural from `textures.ts` (`createNormalTexture`) is acceptable; intensity 2.0–8.0 by scale. |
| Roughness variation | Required on stone and terrain: `roughnessMap` from `createNoiseTexture`, or vertex-color-driven. No uniform roughness on hero surfaces. |
| AO | `aoMap` or baked vertex darkening at every ground-contact edge. `aoMapIntensity` 0.6–1.0. |
| Env response | `envMapIntensity` 1.0 default; water 1.2; deep interior stone 0.3. |
| Texture anisotropy | `min(8, renderer.capabilities.getMaxAnisotropy())` on WebGPU; 4 on WebGL2. |

### 4.2 The shared material library (`src/materials.ts` — V-MAT session builds this)

After V-MAT lands, **no session defines its own stone/metal/wood/fabric/water material.**
Region and system sessions import from `materials.ts`. Exact export shapes are in §7.4.
Minimum catalog:

- Stone: `ashlarLight()`, `ashlarWeathered()`, `granite()`, `limestoneSwallowed()`,
  `plazaWorn()`, `caveDark()` — each with per-block color jitter (±4% lightness) and
  tight-joint bump.
- Metal: `gold()`, `bronze()`, `ironDark()` (Sol Negro gear), `copperWorn()`.
- Organic: `woodAged()`, `woodWet()`, `thatchIchu()`, `fabricWorn(hex)`, `leatherDark()`.
- Character: `skinNaira()`, `clothField()`, `hairDark()` — owned by V-MAT, applied in
  `character.ts` by V-CHAR.
- Water: `riverWater()`, `poolStill()`, `channelClear()` — owned by V-WATER's spec but
  constructed through `materials.ts` helpers.
- Special: `lampEmissive()` — the ONLY emissive material factory (§4.4).

### 4.3 Inca stonework (the signature surface — get this right)

1. **Ashlar geometry**: blocks 0.6–1.2 m, joints ≤ 0.02 m visually. Use box geometry
   with slight per-block inset (0.005–0.01 m) and per-block albedo jitter ±4%.
   Trapezoidal doorways: top width 0.85× bottom width.
2. **No mortar lines painted on.** Joints are geometry + AO, never texture stripes.
3. **Weathering gradient**: base of walls darker (moisture) by 8–12% lightness;
   top edges lighter (sun-bleached) by 5%.
4. **Moss/lichen**: only on north faces and near water (moss `#5A7247`), as decal
   patches or vertex-color tint, coverage 5–20% — never uniform green wash.

### 4.4 Emissive budget (anti-glow law)

- Emissive materials are allowed ONLY for: the sun disk, lamp flames/bulbs, and
  genuinely bioluminescent accents (fungus) at restrained levels.
- `emissiveIntensity` cap: **2.0** for lamps (with visible lamp geometry — flame, bulb,
  shade), **0.35** for bioluminescent accents.
- Lamp emissive color: `#FFB45E` (warm). Never white-blue, never green, never magenta.
- Bloom threshold is 0.85 (§5.4): correctly-exposed emissives will bloom slightly;
  that is the ONLY bloom source allowed. If a non-lamp surface blooms, its emissive
  is a bug.
- Current violations to fix: `jungleLowlands.ts` `emissiveFungusMat` (1.5 → ≤0.35,
  color `#22FFAA` → `#7FB069`); `paititi.ts` `chargeMaterial` (`#FF0000` MeshBasic —
  replace with a stone/bronze mechanism material, no emissive).

### 4.5 How the ancient devices READ (wonder without magic)

The creative north star: wonder comes from **functional ancient Andean devices** —
stone, sun, water, sound, fiber — grounded in real engineering (Chavín acoustics, water
engineering, solar alignments, quipu, ashlar masonry). Never ancient aliens, never
explicit magic, supernatural stays ambiguous.

1. **Monumental, not mystical.** Devices are large, heavy, precise. A solar dial is a
   3 m bronze ring on a stone plinth, not a floating hologram.
2. **Function is visible.** Water devices show water moving (flow vectors, foam,
   wet-stone darkening downstream). Counterweights show mass (thick ropes, worn grooves).
   Solar devices show light doing the work — a shaft landing on a marked stone at the
   right hour (author the `?tod=` grade so the alignment actually reads at dawn).
3. **No glow to explain function.** If a mechanism's purpose isn't clear without
   emissive, fix the geometry/composition, not the material.
4. **Sound devices** (Chavín-style): architecture implies acoustics — flared stone
   channels, resonating chambers with visible openings. No visual "sound waves."
5. **Quipu/fiber**: cordage with per-cord color variation (dyed fiber palette:
   `#8A6F4D`, `#A83A32`, `#3E5E6E`, `#D8CBB0`), knot geometry (torus knots at
   0.05–0.12 m), slight sag via catenary curve — never straight lines.

---

## §5 — WebGPU-first techniques + WebGL2 fallback

WebGPU is the **design target**. Every technique below is specified WebGPU-first with an
exact WebGL2 degradation. The fallback is mandatory for every system — a black screen on
either path is a ship-blocker (BRIEF.md pillar 4).

### 5.1 The existing renderer abstraction (build on it, don't replace it)

`src/renderer.ts` `createRenderer()` already returns
`{ renderer: WebGPURenderer | THREE.WebGLRenderer, quality: RendererQuality }` and tries
WebGPU before falling back to WebGL2. The codebase detection pattern is:

```ts
import { WebGPURenderer } from 'three/webgpu';
const isWebGPU = renderer instanceof WebGPURenderer;   // WebGPU branch
// ... else branch: renderer.isWebGLRenderer            // WebGL2 branch
```

**RULE:** every new visual module follows this exact pattern. TSL imports (`'three/tsl'`)
are dynamically imported ONLY inside the WebGPU branch (the existing `main.ts` post
pipeline already does this — copy that pattern). The WebGL2 branch must never import TSL.

### 5.2 Per-technique spec + fallback table

| # | Technique (WebGPU reference) | WebGL2 fallback (exact) |
|---|---|---|
| T1 | **Sky**: `SkyMesh` from `three/webgpu` (already in `environment.ts`) | `Sky` from `three/examples/jsm/objects/Sky.js` (already in `environment.ts`). Same turbidity/rayleigh/mie values per §2.6. |
| T2 | **IBL**: `PMREMGenerator.fromScene(skyOnlyScene)` on the WebGPU renderer → `scene.environment`. (Supported in three ≥ r167 for WebGPURenderer.) | `PMREMGenerator.fromScene` on the WebGLRenderer (existing behavior — keep). Emergency fallback on EITHER path if PMREM throws: the current 4×4 `DataTexture`. Log loudly if the emergency path is hit. |
| T3 | **Shadows**: `PCFSoftShadowMap`, 2048, frustum d=120 following player (§3.2) | `PCFShadowMap`, 1024, same frustum logic. |
| T4 | **Post**: TSL `PostProcessing` node graph (see 5.4): scene → bloom → vignette → grain → chromatic aberration → output | `EffectComposer`: RenderPass → `UnrealBloomPass(res, 0.35, 0.4, 0.85)` → `ShaderPass(CinematicShader)` (grain 0.035, CA 0.0015 — see 5.4) → `OutputPass` (existing chain — keep, retune params). |
| T5 | **Foliage wind**: TSL `material.positionNode` vertex displacement, math: `offset.x += sin(time*1.3 + worldPos.x*0.5 + hash)*0.15*heightFactor` | `onBeforeCompile` vertex-shader injection with the IDENTICAL formula. Same amplitude, same phase inputs. |
| T6 | **Water**: `MeshPhysicalMaterial`, transmission 0.6, roughness 0.08, normal-scroll flow (two scrolling `createNormalTexture` layers), planar reflection via scene env + a `Reflector`-style mirror plane at 0.5 opacity for hero pools | transmission 0 (unsupported cost on mobile), opacity 0.85, same normal-scroll, no mirror plane. Color/roughness identical. |
| T7 | **Particles**: identical `THREE.Points` CPU-simulated system on both paths (counts in §6 make GPU compute unnecessary) | Same code path — no divergence. (Compute upgrade is a named stretch goal, not normative: if a session implements TSL compute advection for motes, the WebGL2 path keeps the CPU system.) |
| T8 | **Terrain**: identical `MeshPhysicalMaterial` + vertex colors + splat detail on both; anisotropy 8 | Same materials; anisotropy 4. |
| T9 | **Volumetrics**: additive gradient billboards, seeded placement, 5 clusters | Same; cluster count 3 on LOW tier. |

### 5.3 WebGPU-only code rules

1. No `three/tsl` import may execute on the WebGL2 path. Dynamic `await import('three/tsl')`
   inside `if (isWebGPU)` only.
2. No `WebGPURenderer`-only API (`renderAsync`, `PostProcessing`) outside the WebGPU branch.
3. If a WebGPU technique fails at runtime (adapter lost, shader compile error), the module
   must catch and fall back to its §5.2 WebGL2-equivalent rendering — degraded, never black.

### 5.4 Post pipeline values (both paths must converge)

| Stage | WebGPU (TSL) | WebGL2 (EffectComposer) |
|---|---|---|
| Bloom | threshold 0.85, strength 0.35, radius 0.4 | `UnrealBloomPass(res, strength 0.35, radius 0.4, threshold 0.85)` |
| Vignette | multiply `1 - dist(uv,0.5)*0.55`, clamp 0..1 (current factor 1.2 is too strong — retune to 0.55) | fold into `CinematicShader` |
| Film grain | ±0.035 luminance noise, animated | `CinematicShader` amount 0.035 (current 0.1 noise amplitude is too strong — retune) |
| Chromatic aberration | 0.0015 uv offset at edges | `CinematicShader` amount 0.0015 (current 0.005 — retune) |
| Output | tone-mapped output node | `OutputPass` (existing) |

**RULE:** A/B the two paths on the same `?shot=` id. If the WebGL2 frame is visibly
more "cinematic" than the WebGPU frame (or vice versa) beyond tone-mapping nuance, the
post session has not converged — retune until a blind viewer can't tell which is which
at thumbnail size.

---

## §6 — iPhone frame budget

Target device class: iPhone (Safari). The game must be **playable at 30 fps sustained**
on the WebGL2 fallback path. Desktop WebGPU targets 60 fps.

### 6.1 Resolution / DPR

| Tier | DPR cap | Shadow map | Notes |
|---|---|---|---|
| HIGH (desktop WebGPU) | `min(devicePixelRatio, 2)` | 2048 | Current code uses uncapped `devicePixelRatio` — cap it; DPR 3 phones gain nothing but fill-rate pain |
| MEDIUM | `min(devicePixelRatio, 1.5)` | 1024 | |
| LOW (old iPhones, WebGL2) | 1.0 | 512 (WebGL2) / 1024 (WebGPU) | |

**RULE:** never render above DPR 2 on any device. Fill-rate cost scales with pixels²;
a DPR-3 iPhone renders 2.25× the pixels of DPR 2 for zero visible gain at arm's length.

### 6.2 Draw calls / triangles / texture memory

| Budget | HIGH | MEDIUM | LOW |
|---|---|---|---|
| Draw calls / frame | ≤ 220 | ≤ 150 | ≤ 100 |
| Triangles / frame | ≤ 1.2M | ≤ 600k | ≤ 300k |
| Texture memory | ≤ 512 MB | ≤ 256 MB | ≤ 128 MB |
| Active point lights | ≤ 4 | ≤ 3 | ≤ 2 |
| Shadow-casting lights | 1 (sun) | 1 (sun) | 1 (sun, 512) |

Counting rules: one `InstancedMesh` = 1 draw call regardless of instance count. Terrain
chunks ≈ 40–60 draw calls at view distance 4 — that is the single biggest chunk of the
budget; do not add per-chunk extra passes.

### 6.3 Per-system mobile guidance

| System | Mobile-safe (all tiers) | Desktop-only / reduce on LOW |
|---|---|---|
| Terrain | Chunked LOD (existing), vertex colors | Far-chunk segment density 16→4 on LOW |
| Foliage | Instanced cards, alpha-test (NOT alpha-blend) | Instance count 5000→2500 on LOW; wind displacement keep (cheap) |
| Water | Normal-scroll, no transmission (T6 fallback) | Transmission 0.6, mirror plane (WebGPU HIGH only) |
| Particles | Points systems, counts below | Snow 400→150, mist planes 200→80 on LOW |
| Volumetrics | 3 clusters on LOW | 5 clusters HIGH/MEDIUM |
| Post | Bloom at half resolution on WebGL2 | Full-res bloom WebGPU HIGH |
| Shadows | Per §3.2 | PCFSoft only on WebGPU |
| Mist planes | `depthWrite: false`, max 200 | — |

- **Alpha-test, not alpha-blend, for foliage.** Blended transparency overdraw kills
  mobile fill rate; `alphaTest: 0.5` with `side: DoubleSide` is the required foliage
  material mode.
- **No per-frame allocations in hot loops.** The current `decor.ts` `update()` runs a
  3600-iteration grid scan per frame — acceptable, but it must not allocate vectors
  inside the loop (reuse the `dummy` Object3D; it already does).
- **Texture sizes**: terrain detail ≤ 256², foliage cards ≤ 256², normal maps ≤ 256².
  No 1k textures except the sky (which is procedural).

---

## §7 — Stable contracts

Interfaces every region/visual session shares so parallel work composes without
collisions. Shapes are exact — implement them verbatim.

### 7.1 Light rig config (`src/lighting.ts`)

```ts
export interface LightRigConfig {
  sunColor: number;        // hex, e.g. 0xFFF4E5
  sunIntensity: number;    // e.g. 4.5
  sunElevationDeg: number; // e.g. 25
  sunAzimuthDeg: number;   // e.g. 135
  hemiSky: number;         // hex
  hemiGround: number;      // hex
  hemiIntensity: number;   // e.g. 0.5
  fillIntensity: number;   // camera fill, e.g. 0.35
  exposure: number;        // toneMappingExposure, e.g. 1.1
  fogColor: number;        // hex
  fogDensity: number;      // FogExp2 density, e.g. 0.0015
  envIntensity: number;    // scene.environmentIntensity, e.g. 0.55
}

export const TOD_GRADES: Record<'day'|'dawn'|'noon'|'dusk'|'night', LightRigConfig>;
// Values: §2.6 table, transcribed exactly.

export function createLightRig(scene: THREE.Scene, quality: RendererQuality): {
  applyGrade(grade: keyof typeof TOD_GRADES): void;
  update(playerPos: THREE.Vector3): void;  // repositions sun + shadow frustum (§3.2)
  sun: THREE.DirectionalLight;
};
```

**RULES:** `environment.ts` keeps sky + fog + IBL; `lighting.ts` owns all lights.
Region sessions may request a regional light tweak (e.g. darker hemi in tunnels) ONLY
through `applyRegionalBias(partial: Partial<LightRigConfig>)` — they never create lights
except allowlisted lamps (§3.4), which they register via
`registerLamp(position: THREE.Vector3): void` for distance culling.

### 7.2 Renderer capabilities

```ts
export interface RenderCaps {
  isWebGPU: boolean;   // renderer instanceof WebGPURenderer
  tier: 'HIGH' | 'MEDIUM' | 'LOW';
  maxAnisotropy: number; // 8 WebGPU / 4 WebGL2 (clamped by hardware)
}
export function getRenderCaps(renderer: THREE.WebGLRenderer | WebGPURenderer,
                              quality: RendererQuality): RenderCaps;
```

**RULE:** every visual module that branches on renderer type takes `RenderCaps`, never
re-detects. `main.ts` computes it once and passes it down.

### 7.3 Foliage instance contract (`src/decor.ts`)

```ts
export interface FoliageSpec {
  cardTexture: THREE.Texture;   // alpha-tested leaf/grass card, ≤256²
  colorA: number;               // hex, instance color variation low
  colorB: number;               // hex, instance color variation high
  count: number;                // instances (5000 HIGH, 2500 LOW)
  windAmp: number;              // 0.15 default (§5 T5)
  castShadow: boolean;          // true HIGH/MEDIUM, false LOW
}
```

Per-region species palettes live in `decor.ts` keyed by region id; region sessions do
NOT place their own vegetation — they may request density biases via
`setRegionFoliageBias(regionId: string, density: number): void`.

### 7.4 Material library (`src/materials.ts`)

```ts
// Every function returns a NEW material instance (callers may tweak per-mesh).
// Signatures:
ashlarLight(): THREE.MeshStandardMaterial;
ashlarWeathered(): THREE.MeshStandardMaterial;
granite(): THREE.MeshStandardMaterial;
limestoneSwallowed(): THREE.MeshStandardMaterial;
plazaWorn(): THREE.MeshStandardMaterial;
caveDark(): THREE.MeshStandardMaterial;
gold(): THREE.MeshStandardMaterial;            // metalness 1.0, roughness 0.35
bronze(): THREE.MeshStandardMaterial;          // metalness 0.85, roughness 0.45
ironDark(): THREE.MeshStandardMaterial;
woodAged(): THREE.MeshStandardMaterial;
woodWet(): THREE.MeshStandardMaterial;
thatchIchu(): THREE.MeshStandardMaterial;
fabricWorn(hex: number): THREE.MeshStandardMaterial;
leatherDark(): THREE.MeshStandardMaterial;
lampEmissive(): THREE.MeshStandardMaterial;    // the ONLY emissive factory (§4.4)
skinNaira(): THREE.MeshPhysicalMaterial;
clothField(): THREE.MeshPhysicalMaterial;
hairDark(): THREE.MeshPhysicalMaterial;
```

**RULES:**
- Parameter values must fall inside the §4.1 ranges; the bible's hex anchors (§2) are
  the albedo defaults.
- No caller may set `.emissive` on a material except via `lampEmissive()`.
- `materials.ts` imports textures only from `textures.ts`. It never imports renderer state.

### 7.5 Water contract (`src/river.ts`)

```ts
export interface WaterSpec {
  color: number;          // e.g. 0x335566 river, 0x14261E jungle pool
  roughness: number;      // 0.05–0.15
  opacity: number;        // 0.85 WebGL2 / 1.0 w/ transmission WebGPU
  flowSpeed: number;      // uv scroll units/sec, e.g. 0.6
  flowDir: [number, number];
  foamAtEdges: boolean;   // true for rivers/channels
}
export function createWaterSurface(scene: THREE.Scene, spec: WaterSpec,
                                   width: number, length: number, caps: RenderCaps)
  : { mesh: THREE.Mesh; update(time: number): void };
```

Region sessions create water through `createWaterSurface`, never raw planes.

### 7.6 Shot contract (extends the existing hook)

`main.ts` keeps the `?shot=<id>` dispatcher. 7F adds `?shot=region:<regionShotId>`.
**RULES:**
- Shot ids are permanent once merged. Never rename an id; add new ones.
- Every shot sets `window.__shotReady = true` after one full render + 100 ms.
- Shot mode hides ALL UI (`#ui-root` display none) and removes (not fades) `#pause-menu`.
- `?tod=` composes with `?shot=` (e.g. `?shot=region:pa_plaza_of_sun&tod=dawn`).
- `?t=` fast-forward seconds compose as today.

---

## §8 — The visual gate

Every visual session passes a `?shot=` still-frame review before its PR is accepted.
No exceptions, no "it typechecks so it's fine."

### 8.1 Canonical shot list (judge the bible's look against these)

Existing shots (`?shot=<id>`):
`valley_overview`, `river_crossing`, `character_closeup`, `bridge`, `buoyancy`, `rockslide`

Region shots (`?shot=region:<id>`, wired by 7F):
- Cloud forest: `cf_overview`, `cf_lower_blockade`, `cf_excavated_ruin`, `cf_quipu_archive`, `cf_cliff_staircase`
- High sierra: `hs_overview`, `hs_qenko_marker`, `hs_chakana_gate`, `hs_sayhuite_table`, `hs_outpost`, `hs_paqarina_descent`
- Jungle: `jl_overview`, `jl_serpents_path`, `jl_trembling_tunnels`, `jl_vanguard_choke`, `jl_submerged_passage`
- Paititi: `pa_overview`, `pa_outer_terraces`, `pa_plaza_of_sun`, `pa_sanctuary`, `pa_aqueduct_line`

**RULE:** every visual session captures at minimum: its primary region's `*_overview`
plus two POI shots, at `?tod=dawn` AND default day (4+ frames), plus one existing shot
as a regression check. Character/material sessions use `character_closeup` at day and dusk.

### 8.2 Gate procedure

1. Boot the branch build in headless Chromium (or the user's iPhone for the WebGL2 path).
2. Load `?shot=<id>&t=2&tod=<grade>`. Poll for `window.__shotReady === true` (timeout 30 s).
3. Capture at 1280×800 (desktop) and 390×844 (iPhone).
4. Judge against the §8.3 checklist. Any FAIL item blocks the PR.

### 8.3 Gate checklist (all must pass)

- [ ] **Photograph test**: could this frame pass as a photograph? No flat untextured
  surfaces > 2 m², no visible polygon silhouettes on organic shapes, no floating geometry.
- [ ] **Palette**: dominant hues match the region's §2 script within eyeball tolerance;
  accents ≤ 5% of frame.
- [ ] **Light**: shadows present and attached (contact darkening visible); no crushed
  blacks larger than 10% of frame except night grade; no clipped whites > 2% except sun disk.
- [ ] **No glow violations**: nothing blooms except lamps/sun (§4.4).
- [ ] **Composition**: foreground anchor present within 8–25 m in authored shots.
- [ ] **Motion-ready**: foliage shows wind displacement between two `t=` captures;
  water shows flow between two `t=` captures.
- [ ] **Performance**: frame time within §6 budgets on the target device class.
- [ ] **Both paths**: the same shot on WebGPU and WebGL2 is the same image within
  tone-mapping nuance (§5.4 A/B rule).

---

## Appendix A — Proposed session map (10 sessions, non-overlapping files)

Order matters: V-MAT first (everyone imports it), V-SKY/V-LIGHT next (everyone reads the rig).

| # | Session | Files owned | Depends on |
|---|---|---|---|
| V-MAT | Shared PBR material library + character materials | `src/materials.ts` (new); applies materials in `src/character.ts` | — |
| V-SKY | Sky, fog, ToD grades, IBL | `src/environment.ts` | V-MAT (uses its water/sky-adjacent helpers if any) |
| V-LIGHT | Light rig extraction | `src/lighting.ts` (new, extracted from `environment.ts`) | V-SKY (grade values) |
| V-TERRAIN | Terrain material + biome color script | `src/terrain.ts`, `src/textures.ts` | V-MAT, V-LIGHT |
| V-FOLIAGE | Vegetation/rock/mist instancing redo | `src/decor.ts` | V-MAT, V-TERRAIN |
| V-WATER | Water system | `src/river.ts` | V-MAT |
| V-ATMOS | Shafts + particles | `src/volumetrics.ts`, `src/particles.ts` | V-LIGHT (shaft angles follow sun) |
| V-POST | Post pipelines convergence | `src/main.ts` (post sections only), `src/renderer.ts` (`CinematicShader`) | V-SKY (grade intent) |
| V-REG1 | Cloud forest + high sierra dressing pass | `src/regions/cloudForest.ts`, `src/regions/highSierra.ts` | V-MAT (materials migrate here) |
| V-REG2 | Jungle + Paititi dressing pass | `src/regions/jungleLowlands.ts`, `src/regions/paititi.ts` | V-MAT |

**RULE:** `src/world/contracts.ts` is frozen for all sessions. `src/main.ts` shot-hook
and animate-loop sections are owned by the integration track, not visual sessions —
V-POST touches only the clearly-delimited post-processing block.

## Appendix B — Judgment calls (where the repo was ambiguous)

- **J1 — Flat region materials are the #1 photorealism killer.** All four region modules
  define inline `MeshStandardMaterial`s with solid hex colors and no textures. No amount
  of lighting fixes that. Hence the mandatory `src/materials.ts` library (V-MAT) and the
  rule that regions stop defining their own materials.
- **J2 — The jungle's neon glow had to die.** `jungleLowlands.ts` ships emissive fungus
  at intensity 1.5 in `#22FFAA` plus a teal point light — textbook gamey glow, directly
  against BRIEF.md pillar 1. Restrained to emissiveIntensity ≤ 0.35 in desaturated sage
  `#7FB069`; the teal light is removed outright.
- **J3 — Cone trees are placeholders, not a style.** `decor.ts` renders vegetation as
  `ConeGeometry` instances. The bible mandates alpha-tested foliage cards with
  per-instance variation and TSL/onBeforeCompile wind — the Horizon-style density target
  (3–5k instances) is kept, the geometry is not.
- **J4 — WebGPU IBL is currently a flat color.** `environment.ts` gives the WebGL2 path
  a real PMREM sky capture and the WebGPU path a 4×4 flat `DataTexture`, which starves
  every PBR material of reflections on the *primary* renderer. The bible requires
  `PMREMGenerator.fromScene` on both paths (supported for WebGPURenderer in three ≥ r167).
- **J5 — The primary renderer had the weaker grade.** WebGPU post is vignette-only while
  WebGL2 gets bloom + grain + chromatic aberration. The bible specs a matched TSL node
  graph so WebGPU — the design target — gets the full cinematic treatment, with an A/B
  rule to prove convergence.
- **J6 — Shadow frustum d=1500 destroys texel density.** A 2048 px map over a 3 km box
  gives ~1.5 m texels: shadows look detached and blobby. Replaced with a player-following
  frustum at d=120/90 and tightened normalBias (2.0 → 1.5) to restore contact shadows.
- **J7 — `volumetrics.ts` uses `Math.random()`.** Shaft placement changes every load,
  which breaks shot-to-shot comparability for the visual gate. Mandated seeded placement.

---

*End of Juzu Visual Bible v1.0. Sessions: read the normative sections as law, the MOOD
blocks as taste, and the appendices as your marching orders.*
