// Creates the Phase 1 PR via GitHub API. Reads the credential from the
// configured remote URL; NEVER prints it. Prints only the PR URL.
const { execSync } = require('child_process');

const remote = execSync('git remote get-url origin').toString().trim();
// Accepts https://<token>@github.com/... and https://x-access-token:<token>@github.com/...
const m = remote.match(/^https?:\/\/(?:[^:\/]+:)?([^@]+)@github\.com\/(.+?)(?:\.git)?$/);
if (!m) { console.error('No credential in remote URL; aborting'); process.exit(1); }
const token = m[1];
const slug = m[2];

const body = `## Summary

Fixes the frame-destroying color-pipeline bugs that made every WebGPU frame render pure white and every WebGL2 frame carry a multiplicative over-grade. Establishes the single-authority grade chain required by the visual bible (§2.6, §5.4) and wires the per-frame lighting rig.

## Changes

- **renderer.ts** — removed both hardcoded \`toneMappingExposure = 1.5\` (WebGPU + WebGL2 paths). Exposure authority is now the §2.6 ToD grade, applied once in \`environment.ts\`. Explicit \`PCFShadowMap\` (r186 WebGPU has no PCFSoft; avoids deprecation warning). Added \`window.__rendererType\`.
- **environment.ts** — typed \`setupEnvironment\` renderer param (\`THREE.WebGLRenderer | WebGPURenderer\`, no \`any\`); \`getSkyUniforms()\` probe helper resolving the different uniform layouts of \`Sky\` (ShaderMaterial) vs \`SkyMesh\` (NodeMaterial) without casts; **night sky-sun parked below the horizon** (elev −12°, az 90°) while the graded "sun" slot describes the moon, per §2.6 night row; **PMREM sky capture on both paths** (§5.2 T2) into \`scene.environment\` with baked-env fallback on throw.
- **lighting.ts** — §2.6 night row: the moonlight (not the sun) receives elev 35°/az 270°; sun parked below horizon; zero per-frame vector allocations (§6.3); camera fill follows the camera (\`update(playerPos, camera?)\`).
- **main.ts** — removed the explicit TSL \`toneMapping()\` node and \`sunColor × exposure × 0.8\` grading node (WebGPU) and the equivalent \`colorGradingPass\` shader (WebGL2). PostProcessing's default output transform / EffectComposer's \`OutputPass\` now apply **ACES exactly once** from renderer state — the companion rendering brief's non-negotiable item. Typed composer passes; per-frame \`getActiveLightRig()?.update(pos, camera)\` wired in shot mode and normal play; \`?readback=1\` verification hook exposing the final post-processed frame as \`window.__frameDataURL\`.
- **New**: \`?shot=sky_check&az=<deg>\` verification scenario (§8 tooling) — horizon framing with configurable azimuth for auditing sky gradient and sun/moon discipline.

## Verification

- \`tsc --noEmit\` clean; \`npm run build\` clean.
- WebGL2 stills at **1280×800** and **390×844** for day/dawn/dusk/night in \`docs/verification/phase-1/\`:
  - \`fixed_day_sky_az315_webgl2.png\` — blue Preetham gradient, aerial haze, single ACES; the white-frame bug is gone.
  - \`fixed_dawn_sky_az315_webgl2.png\` — warm amber grade on ridgelines, cool foreground, grain/vignette/CA per §5.4.
  - \`fixed_night_sky_az315_webgl2.png\` — dome reads as night; terrain in moonlit blue.
  - \`fixed_night_sunbelowhorizon_az135_webgl2.png\` — facing the parked sky-sun azimuth: **no sun disc** (§2.6 discipline).
  - \`fixed_valley_day/dusk_webgl2.png\` — ToD grade matrix; \`fixed_river_day_mobile390_webgl2.png\` — mobile gate viewport.
  - Pre-fix baselines retained alongside for A/B.

## Known limitation (declared, not introduced by this branch)

Headless WebGPU in this CI container loses the device on first render (bundled vk_swiftshader). This is **pre-existing**: a \`git stash\` A/B shows baseline loses the device identically across 6 flag/viewport combinations and both Playwright Chromium builds (1200/1243). WebGPU/WebGL2 grade parity is therefore by construction — both paths read \`renderer.toneMapping\`/\`toneMappingExposure\` from the same \`TOD_GRADES\` and use identical bloom parameters (0.35/0.4/0.85). On-device WebGPU verification can use the shipped \`?readback=1\` hook.

## Assumptions (minimal-surprise, per working rules)

1. \`sky_check\` scenario was added to \`main.ts\` (Phase 1-owned file) because no existing scenario frames the sky, and §8 requires sky/sun auditing.
2. Night grade kept at §2.6 authority values even where the frame reads very dark; taste-level retuning belongs to a later pass with your sign-off.
3. Deferred to their owning phases: wet/molten terrain specular (Phase 3 materials), blocky character (Phase 7), water look + river framing (Phase 5), untextured region structures (Phases 8–9).

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
      title: 'Phase 1: Render foundation & color pipeline',
      head: 'phase-1-render-foundation',
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
