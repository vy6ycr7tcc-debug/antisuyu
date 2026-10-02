// Creates the Phase 5 PR via GitHub API. Reads the credential from the
// configured remote URL; NEVER prints it. Prints only the PR URL.
const { execSync } = require('child_process');

const remote = execSync('git remote get-url origin').toString().trim();
const m = remote.match(/^https?:\/\/(?:[^:\/]+:)?([^@]+)@github\.com\/(.+?)(?:\.git)?$/);
if (!m) { console.error('No credential in remote URL; aborting'); process.exit(1); }
const token = m[1];
const slug = m[2];

const body = `## Summary

P-MOBILE session: the full loop — **title → explore → pause — is now playable thumb-driven on iPhone Safari**. Visible dynamic-origin virtual joystick with analog walk→run blending, always-on camera-look drag, a touch MENU/pause entry point that actually pauses the sim, safe-area-aware HUD, wake lock, iOS PWA metas, gesture-keyed audio resume, and a measured fix for an invisible-UI hit-testing bug that swallowed right-half camera drags. Verified with a 9/9 frame-synchronous functional gate run at iPhone 14 geometry plus a dpr-3 world regression that matches Phase 4's PASS row.

> **Stacked on #44** (phase-4-foliage — branch cut from it; controls work touches no world rendering). Merge #44 (and its stack) first; this diff then shows only Phase 5.
>
> Per repo rule this PR is opened for review only — never merged by me.

## Audit findings fixed (docs/plans/phase-5-mobile-controls.md §P5.1)

| # | Finding | Fix |
|---|---------|-----|
| F1 **P0** | Title gate was \`click\`/\`keydown\`-only while TouchControls suppressed non-UI touchstart defaults — the game could not be started on an iPhone at all | title listens to \`pointerdown\`; TAP TO BEGIN label on coarse pointers; touches starting in \`#ui-root\` are no longer preventDefault'd |
| F2 **P0** | Pause was Escape-only — unreachable on iPhone | 44 px touch MENU button (safe-area top-right) toggling MenuManager; pausing now also stops the loop (\`isPaused\`) and releases held touch input — previously the "paused" game kept simulating |
| F3 **P0** | Analog magnitude discarded; \`inputDir.normalize()\` + Shift-only sprint made touch permanently walk-speed | stick magnitude → walk→run blend (t² ease, ≥0.95 sustains 5 m/s); keyboard path unchanged (Shift sprint intact) |
| F4 | Joystick was invisible (dynamic origin, zero visuals) | 112 px base ring + 48 px knob, resting dock bottom-left at \`calc(84px + env(safe-area-inset-*))\`, knob tracks clamped deflection |
| F5 | Camera drag only fired while the left thumb held the stick | right-half drag rotates the camera any time (G4: 200 px → 2.0 rad) |
| F6 | TouchControls claimed joystick/look slots from touches on UI elements | \`isUITargetDown\` guard on DOWN (claimed pointers keep routing on MOVE/UP); hold ring moved into \`#touch-root\` |
| F7 | No input release on app switch; joystick stayed live while the pause menu was open | \`releaseAll()\` + \`InputManager.clear()\` on visibilitychange→hidden and on menu open; keys wiped on hide |
| F8 | HUD \`padding: 2rem\` ignored \`env(safe-area-inset-*)\` | per-edge \`calc()\` insets on \`#hud-overlay\`; joystick/pause use the same |
| F9 | Touch devices started at HIGH (iPhones report 6 cores) @ pixelRatio min(2, dpr 3), then the governor yanked it down 3 s in | \`isTouchLikeDevice()\` (coarse pointer / ontouchstart) starts at MEDIUM; \`?quality=\` override and adaptive governor unchanged |
| F10–F12 | No wake lock; missing apple PWA metas; AudioContext never gesture-resumed | feature-detected wake lock (acquire on journey start/visible, release on hidden/menu); apple-mobile-web-app-* metas; pointerdown-keyed resume |
| **F13 P0** | **Found BY gate G4** (probe: \`elementFromPoint(300,400)\` = \`INPUT#range-volume\`): \`.hidden\` overlays were opacity:0-only while \`#ui-root button/input { pointer-events: auto }\` re-enabled their children — an **invisible pause-menu volume slider swallowed every right-half camera-look drag** | \`visibility: hidden\` on \`.hidden\` overlays removes the subtree from hit testing |

## Verification (§P5.3, all measured; headless WebGL2 SwiftShader, 390×844 touch, \`hasTouch\`, dpr 1 functional / dpr 3 visual)

Runner mechanics: \`&turbo=1\` (verification-only) pumps 60 fixed 1/60 s sim sub-steps per rendered frame so time-based gates survive SwiftShader's ~1 fps; all event assertions are **frame-synchronous** (rAF-resolved evaluates) — dispatch → one frame → read is ordering-exact at any frame rate.

**9/9 functional gates PASS** (\`scripts/p5_mobile_play.cjs\` → \`docs/verification/phase-5/p5_results.json\`):

| Gate | Result | Measured |
|---|---|---|
| G1 title-touch | PASS | menu reveals within **1 rendered frame** of the tap |
| G2 journey-start | PASS | title hidden, HUD flex, pause button visible |
| G3 analog-move | PASS | full deflection: **3.77 m** displaced, **5.0 m/s** (run band); half deflection: **2.19 m/s** (walk band); stick magnitude delivered = 1.0 |
| G4 camera-drag | PASS | right pointer claimed, **200 px drag → 2.0 rad** theta with stick idle (this gate found F13) |
| G5 pause-touch | PASS | menu opens/closes by touch; joystick released clean |
| G6 render health | PASS | 0 errors (dev-only sw.js MIME artifact exempt), ktx2=true, webgl2 |
| G7 tier-governor | PASS | touch device **starts MEDIUM** (F9); series MEDIUM→LOW recorded as evidence — at ~1 fps headless the designed degradation is correct, a 30 fps iPhone never approaches it |
| G8 safe-area/hit-targets | PASS | pause 76.8×44 px; joystick inset 26 px left/bottom |
| EXTRA visibility-release | PASS | joystick returns to dock on visibilitychange→hidden |

- World regression (dpr 3, \`p5_world_regr.cjs\` + \`p5_gate_audit.py\`): \`foliage_check cf_floor day\` — **clip >254.5 = 0.000%, crush <10 = 0.000%** — matches Phase 4's PASS row; controls work touched no world rendering.
- \`tsc --noEmit\` clean; \`npm run build\` clean.
- Evidence: \`docs/verification/phase-5/\` — p5_title_touch.png (TAP TO BEGIN), p5_joystick_engaged.png (knob deflected mid-run), p5_pause_open.png, p5_world_regr_cf_day_390.png, p5_results.json. New verification tooling: \`p5_mobile_play.cjs\`, \`p5_world_regr.cjs\`, \`p5_gate_audit.py\`, \`p5_probe.cjs\` (F13 diagnostic), \`__playerDebug\`/\`__touchDebug\`/\`&turbo=1\` hooks.

## Observations for other phase owners

1. **On-device iPhone pass is deferred** (needs hardware): WebGPU-on-iOS-26 path, real FPS, safe-area with real insets, audio unlock E2E — same bucket as the Phase 1/2 WebGPU on-device item. Everything above is by-construction parity + headless-measured.
2. **Pause now pauses the sim** (desktop Escape included) — previously the loop kept running with the menu open. Flag if any phase relied on the old behavior.
3. **Touch devices start at MEDIUM** — flag if the V-REG regions want a different mobile baseline; the adaptive governor still moves both ways.
4. Menu quality/volume controls are still stubs (pre-existing) — the volume slider is now inert-when-hidden but unchanged otherwise; real settings belong to a UI phase.
5. Haptics not added: iOS Safari has no Vibration API.

## Files

\`src/touch/controls.ts\` (rewrite), \`src/input.ts\`, \`src/character.ts\`, \`src/renderer.ts\`, \`src/main.ts\`, \`src/ui/touchui.ts\` (new), \`src/ui/title.ts\`, \`src/ui/menu.ts\`, \`src/ui/index.ts\`, \`src/ui/styles.css\`, \`index.html\`, \`docs/plans/phase-5-mobile-controls.md\` (new, plan + gates + results), \`docs/verification/phase-5/*\`, \`scripts/p5_*\` (new).
`;

const pr = {
  title: 'Phase 5: iPhone playability & touch controls (P-MOBILE)',
  head: 'phase-5-mobile-controls',
  base: 'phase-4-foliage',
  body,
};

const res = execSync(
  `curl -s -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" ` +
  `-d '${JSON.stringify(pr).replace(/'/g, "'\\''")}' https://api.github.com/repos/${slug}/pulls`
).toString();
const out = JSON.parse(res);
if (out.html_url) console.log(out.html_url);
else { console.error('PR creation failed:', res.slice(0, 500)); process.exit(1); }
