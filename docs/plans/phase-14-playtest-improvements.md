# P14 — Owner-Request Playtest & Improvement Backlog

**Trigger:** owner asked the agent to "play the game yourself, take shots and ideate
improvements" (after the P-MOBILE-Q / P-CANON-2 / P-FRESH merges).

**Method:** driven play sessions on the touch profile (390×844, dpr 1, webgl2,
`touch=1&turbo=1` for sim compression), CDP screenshot capture, in-game joystick +
camera + pause input through the real UI, `__testTeleport` region tour, plus
single-frame shot-mode stills of the four regions. All captures:
`docs/verification/phase-14-playtest/`.

**Headless caveat (do NOT chase):** without the `navigator.gpu = undefined` guard the
game selects WebGPURenderer in this container and loses the device → 100 % white
frames (pre-existing Phase 1 limitation, proven by `scripts/p14_profile_isolate.cjs`
A/B/C). Real Safari hardware is unaffected. All evidence below uses the webgl2 path.

---

## A. What works (verified this session)

- **Movement end-to-end: G3 gate 9/9 PASS** (`p5_results.json`) — title tap, journey
  start, analog move (full-deflection run + half-deflection walk bands), camera drag,
  pause/resume, tier governor, safe-area hit targets, render health, visibility
  release. The "character doesn't move" owner report is resolved on current main
  (stale-SW trap + swim-spawn, both fixed in P-FRESH).
- Run animation, camera follow, buoyant physics props (visible floating prop in
  `play_03_running.png`), pause menu with quality/volume/offline controls, quest HUD
  ("Find the path to Paititi"), save/continue slot, offline download UI.
- Engine rendering is healthy at curated vantages (`p5_world_regr_cf_day_390.png`:
  0.000 % clip, 0.000 % crush, tier HIGH).

## B. Evidence index

| File | Shows |
|---|---|
| `play_01_title.png` | Title screen: flat gray placeholder, "J" clipped off-screen |
| `play_02_spawn.png` | Spawn: placeholder character, HUD, dark grainy terrain |
| `play_03_running.png` | Mid-run: anim + follow cam work; terrain noise reads as dirt |
| `tour_pause_menu.png` | Pause menu: unstyled slider/button, HUD bleed-through, joystick visible |
| `tour_cloud_forest_blockade.png` | Camera clipped inside structure geometry |
| `tour_paititi_plaza_close.png` | Paititi plaza: white void ground, floating props, no city |
| `still_paititi.png` | Paititi vantage: bare grass hill, one tree |
| `still_high_sierra.png` | Sierra: smooth swirl-textured hill, mid-frame seam artifact |
| `still_snowline_dawn.png` | Snowline: featureless beige blob, no snow character |
| `still_jungle_lowlands.png` | Jungle: best-looking region; still sparse + dark ground |
| `still_river_valley.png` | River: opaque water, hard shoreline, white slab artifact in sky |

## C. Improvement backlog

### P0 — Player-facing blockers

1. **Replace the placeholder character.** She is a gold sphere + cylinders + box pack
   (`character.ts` builds primitives; no GLB anywhere in the pipeline). This is the
   single biggest "Minecraft" contributor. Ship a stylized rigged GLB (CC0 sources:
   Quaternius/Kenney) with idle/walk/run/swim clips, keep the wardrobe colors, add a
   subtle rim/outline so she reads against dark terrain.
2. **Paititi is empty at its own destination.** Standing at `pa_plaza_of_sun`
   (1100,−50): white void ground, no structures visible anywhere, floating blue decor
   props overhead (the documented >z/x-900 decor-Y defect zone). The city that is the
   point of the journey cannot be seen. Build the plaza/terraces mass (the materials
   already exist: `plazaWorn`, `gold`, `bronze`), fix decor Y at altitude, and audit
   the plaza chunk streaming/physics floor (void ground needs diagnosis: un-streamed
   chunk vs missing plaza mesh).
3. **Third-person camera has no collision.** At cf_lower_blockade the camera buries
   into structure/terrain and the frame becomes a wall close-up. Add a sphere-cast
   pull-in against terrain + structures, plus a near-plane floor clamp.
4. **Sky/river artifacts.** A giant white slab floats over the river valley
   (`still_river_valley.png`) — orphaned water/volumetric/billboard geometry; hunt by
   frustum-culling audit at that vantage. Same family: mid-frame vertical seam in the
   sierra still (chunk-edge T-junction, skirts already deferred from P3).

### P1 — Visual quality (the "awful" gap closers)

5. **Terrain surface.** The periodic-lattice detail reads as stirred marble-cake swirl
   at gameplay range and the valley floor is dark muddy gray-green. Direction: lower
   contrast between octaves, slope/altitude rock exposure bands, scatter hero detail
   (grass tufts already exist as cards — densify near camera), per-biome tint
   saturation lift. Snowline needs actual snow behavior (smooth slope hold-out reads
   as beige dune today).
6. **Empty skies.** No clouds, no sun/moon disc, no birds, flat gray gradient + heavy
   haze wash kills ridgelines. Add: sky-model sun/moon discs, cloud cards layer,
   far-mountain silhouette ring / impostor tree line (deferred from Phase 4 far-field
   item), and pull far-fog density back ~30 % at day so silhouettes read.
7. **Water.** Opaque flat blue with hard shoreline. Depth-based alpha (fade to shore),
   foam band at the waterline, subtle normal-scroll flow. The river is the game's
   visual spine — highest ROI per line of shader.
8. **First-impression grade.** Boot ToD is flat day; a golden-hour boot grade (long
   shadows, warm key) would flatter every region for near-zero cost, and the title→
   spawn transition deserves a 2 s cinematic drop (camera swoop from sky) instead of a
   hard cut.

### P2 — Feel & UI polish

9. **Title screen art.** Flat gray + letterspaced text with the J clipped; add key art
   background (live ToD render of the valley is already available in-engine), fix the
   clip, add version/build stamp.
10. **Pause menu styling.** Native blue volume slider and bright red offline button
    clash with the muted palette; HUD text bleeds through the panel; the joystick
    stays visible while paused; typography mixes serif display + sans + ALL CAPS.
11. **HUD collisions.** CURRENT OBJECTIVE text runs under the MENU chip at 390 pt;
    the bottom progress bar is unlabeled (what does it measure?).
12. **Guidance.** Paititi needs a visible beacon (sun-glint column / smoke plume) so
    "find the path" is answerable; POI approach prompts ("Lower Blockade — investigate")
    would make regions legible.

### Suggested phase order

P-CHAR (model+clips) → P-WORLD-DRESS (terrain/sky/water) → P-PAITITI (city mass +
decor-Y + plaza floor) → P-CAM (collision) → P-UI-POLISH (title/pause/HUD).

Items 2, 3, 4 need a diagnosis pass before implementation; items 1, 5, 6, 7 are
directly implementable on this baseline.
