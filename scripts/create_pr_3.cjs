// Creates the Phase 3 PR via GitHub API. Reads the credential from the
// configured remote URL; NEVER prints it. Prints only the PR URL.
const { execSync } = require('child_process');

const remote = execSync('git remote get-url origin').toString().trim();
const m = remote.match(/^https?:\/\/(?:[^:\/]+:)?([^@]+)@github\.com\/(.+?)(?:\.git)?$/);
if (!m) { console.error('No credential in remote URL; aborting'); process.exit(1); }
const token = m[1];
const slug = m[2];

const body = `## Summary

V-TERRAIN session (visual bible Appendix A): terrain biome color script + tiled detail material. Deterministic seeded vertex colors with smooth biome blending, sierra snow line, riverbank wetness, and strictly low-frequency tiled detail maps replacing the old stretched fbm noise. Verified with a 12-capture terrain matrix audited against §8.3.

> **Stacked on #42** (phase-2-pbr-materials — branch cut from it; textures.ts/main.ts continue there). Merge #42 first; this diff then shows only Phase 3.

## Changes

- **src/terrain.ts** — biome color script (§2.2–§2.5):
  - **Seeded hash** replaces \`Math.random()\` in vertex jitter — the old code re-rolled every chunk's colors on each LOD swap (terrain visibly shimmered); colors are now deterministic per world position.
  - **Smooth 60 m transition bands** at the region boundaries (z 300 / z −400 / x 600) instead of hard switches that drew color seams; soft slope-based soil↔rock split (was binary at 0.4).
  - **Sierra snow line**: elevation+patch blend toward §2.3 snow \`#F2F5F7\` with \`#C9D6E2\` shadow tint (never pure grey), steep faces hold out; **lichen patches** on granite (\`#7A8A5A\`); **riverbank wetness** darkening along the riverBed falloff.
  - Hoisted per-vertex Color allocations out of the chunk loop.
- **src/terrain.ts material** — §5.2 T8 + §4.1:
  - Tiled **low-frequency** detail maps with per-map repeat: albedo flecks ~20 m, normal ridges ~20 m, roughness blotches ~40 m, AO macro ~100 m. The generic \`createNoiseTexture\`/\`createNormalTexture\` domain-warp fbm decorrelates neighboring texels — at terrain tiling it read as per-texel white-noise static (probe evidence, p3-5).
  - \`aoMap.channel = 0\` fix: PlaneGeometry has no uv1 — the previous aoMap sampled a missing attribute and was effectively inert.
  - **Anisotropy applied from RenderCaps** (T8: 8 WebGPU / 4 WebGL2) — the field existed but was never wired.
  - Roughness 0.92 × map 0.72–0.98 → composite 0.66–0.90: dry ground matte, wet blotches glint without mirror whiteout (the companion brief's "wet/molten specular = material noise roughnessMap" item).
  - \`normalScale\` 1.8 × generator 3.0 per §4.1's 2.0–8.0 band.
- **§7.2 contract**: \`TerrainManager\` now takes \`RenderCaps\` (old \`detectRenderer()\`/\`__isWebGPU\` probe removed). **LOW tier**: mid-ring chunk density 16→4 per §6.3, verified via \`?quality=low\` (tier logged in the matrix).
- **src/textures.ts** — \`createTerrainDetailTexture\` / \`createTerrainRoughnessTexture\`: periodic sin-lattice generators (seamless tiles, no per-texel static).
- **src/main.ts** — \`?shot=terrain_check\` verification scenario (§8 tooling; shot id added, none renamed): seven named vantages — sierra, sierra_lit (dawn-lit aim), snowline (dawn; day whiteouts, measured), river, cf, jungle, paititi, boundary — plus generic \`cx/cz/lx/lz\` override used for framing iteration.

## Verification

- \`tsc --noEmit\` clean; \`npm run build\` clean.
- **§8.3 gate audit** — 12/12 WebGL2 captures PASS (\`scripts/p3_gate_audit.py\`), zero render errors, ktx2=true:

| capture | clip >254.5 | crush <10 | chroma | verdict |
|---|---|---|---|---|
| sierra day / dawn | 0.000% | 0.00% | 43.4 / 28.1 | PASS |
| snowline (dawn) | 0.000% | 0.00% | 40.3 | PASS |
| river dawn (wet bank) | 0.000% | 9.92% | 26.5 | PASS |
| cloud forest / jungle / paititi day | 0.000% | 0.00% | 26.4 / 13.1 / 55.8 | PASS |
| boundary day (blend, no seam) | 0.000% | 0.00% | 26.9 | PASS |
| sierra day 390 / LOW tier | 0.000% | 0.00% | 56.0 / 44.0 | PASS |
| valley_overview day/dawn regression | 0.000% | 0.00 / 0.95% | 42.1 / 46.2 | PASS |

- Chroma column = mean R−G + G−B spread: flat single-hue terrain (Appendix B J1's "#1 photorealism killer") measures ~0; all biomes show real color variation.
- **Per-ToD framing rationale** (measured, recorded in the vantage comments): dawn crushes shadow-side ground >10% from any south-of-sun aim (16.2% measured) → dawn rows use the NE \`sierra_lit\` aim (0.0%); that aim clips 2.2% on LOW at day so day rows keep the north aim; snowline captures at dawn because §2.3 snow + altitude fog + day grade white out the frame at day (p50 249.9, structure-free).
- **A/B evidence** in \`docs/verification/phase-3/ab_reference_phase1_valley_day.png\`: Phase 1's curated valley still shows the terrain as marbled fbm static; the regression frame shows coherent ground.

## Observations for phase owners (no cross-phase silent fixes)

1. **Pre-existing (attributed via the Phase 1 A/B still):** blue water-plane quads poke through the river bed (river mesh doesn't conform — Phase 5) and a bloom ring traces the circular chunk-cull boundary (loader; visible from elevated cameras). Both appear in Phase 1's curated \`fixed_valley_day_webgl2.png\`.
2. **Chunk-seam sun-bleed streak**: LOD T-junction cracks between segment densities let sky-bleed through (featured in paititi frame). Candidate fix: chunk skirts in a terrain-geometry follow-up.
3. **Floating props at high sierra** (z > 900): decor/region structures with mismatched Y at altitude, visible at dawn (Phase 4 / V-REG1).
4. **materials.ts re-declares \`RenderCaps\`** locally instead of importing the §7.2 canonical interface from renderer.ts (structural duplicate, harmless; contract hygiene for a later pass).
5. **Headless WebGPU** device-loss unchanged (declared Phase 1); T8's identical-materials parity is by construction.

## Assumptions (minimal-surprise, per working rules)

1. \`terrain_check\` scenario added to \`main.ts\` — no existing shot frames biome ground; §8.1 requires terrain auditing per visual session.
2. \`getGlobalTerrainHeight\` untouched (physics/colliders/spawns depend on it); Paititi's plateau dome stays until V-REG2 authors the city.
3. Snow fields are vertex-color only (no material swap) — §2.3's roughness 0.55 for snow arrives with a splat/material variant pass if wanted.

Review requested — I will not merge.`;

async function main() {
  const res = await fetch(`https://api.github.com/repos/${slug}/pulls`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'juzu-phase-bot'
    },
    body: JSON.stringify({
      title: 'Phase 3: Terrain biome color script + tiled detail material',
      head: 'phase-3-terrain-materials',
      base: 'main',
      body
    })
  });
  const data = await res.json();
  if (res.ok) {
    console.log('PR created: ' + data.html_url);
  } else {
    console.error(`API ${res.status}: ${data.message}`);
    if (data.errors) console.error(JSON.stringify(data.errors));
    process.exit(1);
  }
}
main();
