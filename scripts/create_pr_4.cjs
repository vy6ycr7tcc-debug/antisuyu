// Creates the Phase 4 PR via GitHub API. Reads the credential from the
// configured remote URL; NEVER prints it. Prints only the PR URL.
const { execSync } = require('child_process');

const remote = execSync('git remote get-url origin').toString().trim();
const m = remote.match(/^https?:\/\/(?:[^:\/]+:)?([^@]+)@github\.com\/(.+?)(?:\.git)?$/);
if (!m) { console.error('No credential in remote URL; aborting'); process.exit(1); }
const token = m[1];
const slug = m[2];

const body = `## Summary

V-FOLIAGE session (visual bible Appendix A): vegetation/rock/mist instancing redo in \`src/decor.ts\`. Cone trees and dodecahedron rocks replaced with alpha-tested instanced foliage cards per §7.3 (FoliageSpec contract + per-region species palettes + \`setRegionFoliageBias\`), the §5.2 T5 wind formula implemented identically on both render paths, and deterministic camera-following placement matched to the Phase 3 biome bands. Verified with an 18-capture §8.3 matrix including a wind motion A/B pair.

> **Stacked on #43** (phase-3-terrain-materials — branch cut from it; textures.ts/main.ts continue there). Merge #43 first; this diff then shows only Phase 4.

## Changes

- **src/decor.ts** — full rewrite:
  - **§7.3 contract**: \`FoliageSpec\` (shape verbatim), per-region species palettes keyed by region id, \`setRegionFoliageBias(regionId, density)\`. \`RenderCaps\` now imported from renderer.ts — the old local re-declaration plus a main.ts callsite that passed **no caps** silently forced HIGH tier and disabled the WebGPU branch entirely.
  - **J3 geometry replacement**: cone trees → 3 crossed alpha-tested canopy cards (22-leaf seeded silhouettes with baked depth gradient) over instanced 7-sided trunks (\`woodAged\` + bark normal, dark value jitter); dodecahedron rocks → displaced, welded icospheres (deterministic position hash, no cracks); mist planes → radial-alpha sprites, **NormalBlending** (the old ADDITIVE white quads read as glow), depthWrite:false, 200→80 on LOW.
  - **§5.2 T5 wind, identical both paths**: \`offset.x += sin(time*1.3 + worldPos.x*0.5 + hash) * amp * heightFactor\`. WebGPU: TSL \`positionNode\` on \`MeshStandardNodeMaterial\` (dynamic import inside the WebGPU branch only, §5.3; falls back to the WebGL2 material on failure). WebGL2: \`onBeforeCompile\` injection into \`<begin_vertex>\` **plus the same injection into a wind-synced \`customDepthMaterial\`** so shadows sway with the cards. Per-instance phase via an \`aHash\` instanced attribute. \`instanceColor\` tinting works on both paths (verified in three r186 sources: NodeMaterial.setupDiffuseColor + WebGLProgram \`instancingColor\` → USE_COLOR).
  - **Deterministic placement**: three camera-following grids (coarse/mid/fine), sin-hashed cells (same family as the terrain script), rescan only on 12 m camera movement, no per-frame allocations. Biome selection uses the SAME 60 m transition bands as the terrain color script — species switch where ground color switches. River-bed exclusion (|x| < 22 for vegetation), sierra snow/treeline fades, **paititi edge-only falloff** (§2.5 maintained stone core, green only at the city's edges).
  - **Slope-safe grounding** (§1.3): every instance is grounded/embedded at its FINAL jittered world position — cell-center-only sampling is what made props hover on slopes (the deferred Phase 3 "decor Y at altitude" defect).
  - Capacity per §6.3/§7.3: foliage 5000 HIGH → 2500 LOW across species; rocks 800/mesh (the old 2000-per-mesh capacity processed ~336k parked vertices per frame); mist 200/80. castShadow per §7.3 (false LOW).
- **src/textures.ts** — \`createFoliageCardTexture(kind)\` for broadleaf/grass/fern/orchid (≤256², seeded, hard alpha edges for alphaTest 0.5, internal luminance ramp) + \`createMistTexture\` (radial falloff). Evidence: \`docs/verification/phase-4/p4_foliage_cards_contact.png\` (rendered from the real generators).
- **src/main.ts**:
  - \`createDecor(scene, renderCaps)\` (§7.2).
  - **Shot mode now updates decor** — prior to this, every §8 capture since Phase 1 rendered the instances as an all-identity origin pile; foliage was effectively never verified. \`?t=\` also drives the T5 wind clock for the motion gate (uniform written after first-render compilation — the audit caught the pre-compile write diffing to exactly zero).
  - **Shot-time chunk streaming** (p3's deferred "loader cull revisit"): the origin-centered chunk disc is circle-culled, leaving fog-void holes inside far vantage frames (measured as white void slabs); chunks now stream around the shot camera.
  - \`?shot=foliage_check\` (§8 tooling; new id, none renamed): eight named vantages across all four region palettes with measured per-ToD \`ch\`/\`ly\` framing params + generic \`cx/cz/lx/lz\` overrides.

## Verification

- \`tsc --noEmit\` clean; \`npm run build\` clean.
- **§8.3 gate audit** (\`scripts/p4_gate_audit.py\`), 18 WebGL2 captures, zero render errors, ktx2=true, HIGH/LOW tiers verified:

| capture | clip >254.5 | crush <10 | chroma | verdict |
|---|---|---|---|---|
| cf_floor day / dawn | 0.000% | 0.00 / 0.00% | 27.0 / 25.3 | PASS |
| sierra_ichu day / dawn | 0.000% | 0.00 / 0.10% | 34.6 / 40.5 | PASS |
| jungle_fern day / dawn | 0.000% | 0.00 / 8.67% | 20.0 / 24.6 | PASS |
| paititi_edge day | 0.000% | 0.00% | 62.9 | PASS |
| valley_mix day | 0.000% | 0.00% | 28.9 | PASS |
| cf_floor day LOW / 390 | 0.000% | 0.00% | 26.5 / 31.1 | PASS |
| valley_overview day (regr) | 0.000% | 0.00% | 40.8 | PASS |
| terrain_check cf day (regr) | 0.000% | 0.00% | 29.5 | PASS |
| **wind A/B t0→t2** | — | — | — | **PASS** — 4.4% of canopy pixels displaced >8 lum, p99 = 31 |

- **Documented XFAIL rows** (physical grade×geometry interaction, not foliage defects — flagged to the light-rig owner below):

| capture | crush | measured best | physics |
|---|---|---|---|
| paititi_edge dawn | 17.64% | ch 0–25 sweep | the convex maintained-stone dome self-shadows at the 6° sun |
| valley_dawnlit dawn | 15.42% | ch 0–25 sweep | the channel floor sits in 950 m shadow reach (6° sun: height/tan 6°) |
| valley_overview dawn (regr) | 10.73% | framing owned by Phase 1 | 0.95% in p3 → canopy cast shadows at HIGH tier (66 m stripe shadows, §3.3.3 working as designed) |

- Chroma column: all biomes show real color variation (J1 flat-color killer stays dead).
- folSig column (audit): 42–88% of downsampled pixels deviate >18 from the frame median — the alpha-tested card layer adds the mandated high-frequency breakup (§1.1.3 "no flat color fields larger than 2 m").

## Observations for other phase owners

1. **Light-rig owner (§2.6/§8.3 interaction)**: at the 6° dawn elevation, flat ground receives ~10% of the sun term (sin 6°) and every height-function bump casts a 9.5×-height shadow. Valley-floor dawn aims cannot pass the 10% crush line regardless of framing (measured sweeps: aims ×5, ch 0–25, ly −10…45). Either the dawn grade/carve-out is revisited, or dawn captures stay on high ground (p3's pattern). The three XFAIL rows above are the full evidence.
2. **V-ATMOS**: the volumetric billboards (J7: \`Math.random()\` placement) render as hard-edged bright quads at dawn when in frame (visible in \`p4_paititi_edge_dawn.png\`, upper left). Seeded placement + soft edges will fix; dawn is their peak-intensity grade per §3.3.3.
3. **Phase 5 (water)**: the river bank intersection shows the pre-existing water-quad poke-through/z-fight in \`p4_valley_mix_day_1280.png\` (documented in Phase 1/3; unchanged here).
4. **Terrain geometry**: the LOD T-junction chunk-edge sun-bleed (p3-documented, skirt fix deferred) shows along far chunk boundaries in dawn frames.
5. **WebGPU rendered-path verification** remains deferred (headless device-loss, Phase 1 limitation). The foliage NodeMaterial constructs and the wind formula is parity-by-construction (identical T5 math); needs an on-device pass like the Phase 2 POM path.

## Instance census (measured, \`scripts/p4_census.cjs\`)

Camera-centered placement fills ~1.5–2.7k foliage instances at HIGH tier (capacity 5000; §1.1.1: "beyond 60 m density may fall off; beyond 300 m silhouette and atmosphere carry the frame"), ~300–800 rocks, ≤200 mist. Per-region palettes: cf 4 species (broadleaf/fern/tuft/orchid), sierra 3 (ichu-dominant), jungle 3, paititi 3 (edge falloff).
`;

const pr = {
  title: 'Phase 4: foliage/rock/mist instancing redo (V-FOLIAGE)',
  head: 'phase-4-foliage',
  base: 'phase-3-terrain-materials',
  body,
};

const res = execSync(
  `curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" ` +
  `-d '${JSON.stringify(pr).replace(/'/g, "'\\''")}' https://api.github.com/repos/${slug}/pulls`
).toString();
const out = JSON.parse(res);
if (out.html_url) console.log(out.html_url);
else { console.error('PR creation failed:', res.slice(0, 500)); process.exit(1); }
