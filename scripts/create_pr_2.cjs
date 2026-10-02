// Creates the Phase 2 PR via GitHub API. Reads the credential from the
// configured remote URL; NEVER prints it. Prints only the PR URL.
const { execSync } = require('child_process');

const remote = execSync('git remote get-url origin').toString().trim();
// Accepts https://<token>@github.com/... and https://x-access-token:<token>@github.com/...
const m = remote.match(/^https?:\/\/(?:[^:\/]+:)?([^@]+)@github\.com\/(.+?)(?:\.git)?$/);
if (!m) { console.error('No credential in remote URL; aborting'); process.exit(1); }
const token = m[1];
const slug = m[2];

const body = `## Summary

Implements the visual bible §7.4 material catalog as real PBR surface work: a procedural 6-band ashlar trim sheet with baked joint AO, ORMH packed maps, a KTX2/Basis compressed-texture pipeline, and dual render paths (WebGL2 \`MeshStandardMaterial\` / WebGPU NodeMaterial POM). Verified with a 6-capture ToD×viewport shot matrix audited against the §8.3 gate checklist.

## Changes

- **src/materials.ts** — full §7.4 catalog (stone / metal / organic / character / water / lampEmissive) with ORMH channel pinning (O→R, R→G, M→B, H→A) verified by map dump. Emissive restricted to lamp surfaces per §4.4.
- **src/textures.ts** — procedural 1536px trim sheet (albedo + tangent normal + packed ORMH \`DataTexture\`s). Band profiles rebalanced to §4.3.1 block scale: 0.67 m fine ashlar, 1.0×0.67 m standard, 2.0×1.0 m megalithic, 0.4 m fieldstone, 1.0 m carved relief, plaster. Joint width ≤3 px at the normative 128 px/m consumer scale (§4.3.1 joints ≤0.02 m); joints render as geometry + AO, never texture stripes (§4.3).
- **src/assets.ts** (new) — KTX2/Basis loader pipeline with bundled transcoder (\`public/libs/basis/\`), \`window.__ktx2Supported\` hook (true in container).
- **src/main.ts** — \`?shot=material_check\`: six 2×3 m trim-band segments side by side, each grounded on the terrain beneath its own world center (sloped ground), character parked 200 m out with its cast shadow proven out of frame (with/without diff, \`scripts/p2_frustum_diff.cjs\`). Per-ToD look pitch via \`&lt=\` (m), measured against §8.3 — see Verification.
- **scripts/** — \`phase2_shots.cjs\` (matrix runner), \`p2_shot_one.cjs\` (single capture), \`p2_gate_audit.py\` (§8.3 gate table), \`dump_trimsheet.*\` (map audit pipeline), \`p2_curate.py\`.

## Verification

- \`tsc --noEmit\` clean; \`npm run build\` clean.
- **§8.3 gate audit** (all 6 WebGL2 captures PASS; script prints the table):

| capture | clipped >254.5 | near >250 | crushed <10 | wall p99 | verdict |
|---|---|---|---|---|---|
| day 1280 | 0.000% | 4.00% | 0.00% | 247.9 | PASS |
| dawn 1280 | 0.000% | 0.00% | 8.79% | 189.0 | PASS |
| dusk 1280 | 0.007% | 0.12% | 6.81% | 217.8 | PASS |
| night 1280 | 0.000% | 0.00% | 57.02% (night-exempt) | 61.8 | PASS |
| day 390 | 0.000% | 0.00% | 0.00% | 247.9 | PASS |
| dawn 390 | 0.000% | 0.00% | 8.33% | 190.8 | PASS |

- Day frame max luminance 252.3 with **zero clipped whites** (§8.3 counts clipped whites, sun disk exempt); the near-white energy is the sun-side sky gradient above the wall, not masonry (wall ROI 0% >250).
- Per-ToD pitch rationale: flat-on dawn framing crushed 25.6% of frame below luminance 10 (shadow-side ground; §8.3 limit 10% outside night) — measured sweep 0.9→25.6%, 1.8→19.5%, 2.6→12.3%, 3.0→8.7%. Dusk keeps 0.9 because at 3.0 the low west sun (az 270°, elev 6°) enters frame and its bloom halo clips 6.4% >254. Values recorded in the \`material_check\` comment.
- Masonry reads: band progression fine→standard→megalithic→fieldstone→carved→plaster legible in all captures; joints are hairline AO lines with lit bevels (dawn warm gold per §2.5); trim map audit contact sheet in \`docs/verification/phase-2/trimsheet_maps_contact.png\`.

## Observations for phase owners (no cross-phase silent fixes)

1. **§2.6×§5.4 day-grade threshold proximity (Phase 1 owner):** the day sky gradient sits at 250–252.3 luminance over ~4% of frame — 2–3 code values below the clip line. Any day-grade brightening flips the §8.3 clipped-whites gate. Measured, not acted on.
2. **WebGPU shot path untested in container (pre-existing, declared in Phase 1):** headless WebGPU loses the device on first render; the POM NodeMaterial builds but its rendered output needs on-device verification. WebGL2 path is the verified reference.
3. **Dev-only \`sw.js\` MIME console error** — pre-existing PWA artifact (service worker exists only in prod builds); present on baseline, not chased.
4. **Box end-face UV artifacts** on the carved band's segment ends (small dot cluster) — cosmetic; authored scenes hide trim end faces against adjoining geometry.

## Assumptions (minimal-surprise, per working rules)

1. \`material_check\` scenario added to \`main.ts\` (Phase 1-owned file) — no existing scenario frames materials; §8 requires per-material audit frames.
2. Trim-sheet band content follows §7.4's catalog order; moss/dirt variation limited to base-adjacent bands per §2 palette.
3. Deferred to owning phases: wet/molten specular variants (Phase 3), water surface look (Phase 5), character material closeup audit (Phase 7, \`character_closeup\`).

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
      title: 'Phase 2: PBR materials & trim-sheet pipeline',
      head: 'phase-2-pbr-materials',
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
