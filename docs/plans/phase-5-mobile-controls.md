# Phase 5 — iPhone Playability & Touch Controls (P-MOBILE)

Status: IMPLEMENTING · Branch: `phase-5-mobile-controls` (stacked on `phase-4-foliage` / PR #44)
Scope: make the full loop — title → explore → pause — playable one-handed/thumb-driven on iPhone Safari, with console-grade touch controls. No visual-bible world changes; all world captures must remain within existing §8.3 gates.

## P5.1 Audit findings (measured against the code, not assumed)

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| F1 | **Title gate is unreachable by touch.** `press-to-begin` listens for `keydown`/`click`; TouchControls `preventDefault()`s every non-BUTTON `touchstart`, which suppresses the iOS synthetic click. The game cannot be started on an iPhone at all. | P0 | `src/ui/title.ts` (click/keydown only) × `src/touch/controls.ts:44-48` |
| F2 | **No pause affordance on touch.** Pause is `Escape`-only (`src/ui/menu.ts:66-80`); iPhone has no Esc key. | P0 | menu.ts |
| F3 | **Analog magnitude is discarded; sprint impossible.** `character.ts` normalizes `inputDir` and gates run speed on `ShiftLeft`. Touch always walks at 2 m/s; full stick deflection ≈ 3 px deflection. | P0 (controls quality) | `src/character.ts:208-261` |
| F4 | **Joystick is invisible.** Dynamic-origin, zero visuals: the player has no idea where the stick zone is or how far they're deflecting. | P1 | controls.ts (no base/knob elements) |
| F5 | **Camera drag only fires while the left thumb is on the stick** (`if (this.leftPointerId !== null)`). Look-drag is the most-used touch gesture in the genre; here it dies as soon as you stop walking. | P1 | controls.ts:141 |
| F6 | **TouchControls hijacks UI touches.** Any touch on HUD/menu elements claims a joystick slot and can emit a game `tap` (the pause button tap also pokes the interact recognizer). | P1 | controls.ts handlers (no `#ui-root` guard) |
| F7 | **Stuck input on app switch.** No key/joystick release on `visibilitychange`; returning to the tab keeps walking / dragging. | P1 | main.ts visibility block, controls.ts |
| F8 | **Safe-area blind.** HUD `padding: 2rem` ignores `env(safe-area-inset-*)`; content sits under the notch / home indicator in `viewport-fit=cover`. | P1 | styles.css `#hud-overlay`, index.html |
| F9 | **Initial tier too hot for mobile.** Tier = `hardwareConcurrency > 4 ? HIGH : MEDIUM`; iPhones report 6 → HIGH @ pixelRatio min(2, dpr 3) = 2 → 780×1688 render + PBR + foliage + bloom from frame one, then the adaptive governor yanks it down 3 s in (visible stutter). | P1 | renderer.ts:90, QUALITY_TIERS |
| F10 | **No wake lock.** Screen sleep mid-explore (Safari 17+ supports Screen Wake Lock). | P2 | — |
| F11 | **Missing iOS PWA metas.** No `apple-mobile-web-app-capable` / status-bar-style / title: Add-to-Home-Screen opens in a browser tab with chrome instead of standalone full-bleed. | P2 | index.html, manifest (`display: standalone` already correct) |
| F12 | **THREE.AudioContext never resumed on gesture.** AudioDirector isn't wired into main yet, but the shared AudioContext (visibility handler) still needs a gesture-keyed resume for when audio lands (iOS autoplay policy). | P2 | main.ts:162-175 |
| F13 | **Hidden overlays stayed hit-testable (found BY gate G4, measured).** `.hidden` overlays were opacity:0-only, and the global `#ui-root button` / `input[type=range] { pointer-events: auto }` rules re-enabled their children — so the invisible pause-menu volume slider sat at (300, 400) mid-right screen and swallowed EVERY right-half camera-look drag (probe: `elementFromPoint` = `INPUT#range-volume`). On a real iPhone, camera look would randomly die against invisible UI. | P0 | probe `scripts/p5_probe.cjs`; fix: `visibility: hidden` on `.hidden` overlays (styles.css) |

Non-goals (owned elsewhere): jump/action verbs (no jump exists in the traversal state machine — adding one is a gameplay phase, not controls), on-device WebGPU FPS certification (headless container can't; same deferred item as Phase 1/2 — gates below run WebGL2 SwiftShader and mark device pass as deferred), water/regions/character look.

## P5.2 Design

**Controls layout (thumb-driven, no keyboard):**
- Left third = dynamic-origin virtual joystick, **visible**: 112 px base ring + 48 px knob, resting position bottom-left inset by `max(24px, safe-area-inset-left/bottom)`. Re-origin = wherever the thumb lands inside the zone (clamped to keep ≥60 px from screen edges); knob follows clamped radius 50 px. 12 px deadzone, 50 px max radius (existing constants kept).
- Right two-thirds = camera look, **active any time a finger drags there** (F5 fix), including while walking.
- Analog speed (F3): joystick magnitude passes through InputManager; character maps magnitude 0→0, ≥0.95 sustained → run 5 m/s, linear between → walk band. Keyboard path unchanged (Shift still sprints; WASD magnitude = 1).
- Tap (<250 ms, <10 px) = interact verb, hold (≥500 ms → 800 ms ring) = existing hold verb — recognizers kept exactly as shipped.
- Pause button (F2): 44×44 px hit target, top-right, safe-area inset, shown on touch devices during play; toggles the existing MenuManager. While the menu is open, gameplay input is released.

**Input hygiene:**
- All TouchControls handlers ignore events originating inside `#ui-root` / `#touch-root` (F6) — buttons own their touches.
- `releaseAll()` on `visibilitychange → hidden` (F7) + menu open: zeroes joystick/camera delta, clears held pointer ids, releases wake lock.
- Title screen: listen to `pointerdown` (fires on iOS, not suppressed — we no longer preventDefault touches that land inside `#ui-root`) (F1). Label reads TAP TO BEGIN on coarse pointers.

**iOS Safari hardening:**
- `touch=1` URL param forces touch UI on desktop for verification captures (AGENTS.md §verification rule) — zero effect without the param.
- Renderer: `matchMedia('(pointer: coarse)')` → default MEDIUM (F9) unless `?quality=` locked; adaptive governor still free to move both ways.
- Wake lock request on play start, re-acquire on visible, release on hidden/menu (F10).
- index.html: apple-mobile-web-app-capable / status-bar-style black-translucent / apple-mobile-web-app-title (F11); `-webkit-tap-highlight-color: transparent`, `-webkit-touch-callout: none` (styles.css).
- HUD safe-area: `#hud-overlay` padding switches to per-edge `calc()` with insets (F8); joystick/pause use the same insets.
- First `pointerdown` anywhere resumes THREE.AudioContext (F12).

## P5.3 Verification gates (all measured; headless WebGL2 SwiftShader, iPhone 14 geometry 390×844, `has-touch`)

Runner mechanics (established during p5-4, all measured): the functional session runs at **dpr 1** — gates measure CSS-px geometry, input routing and sim behavior (dpr-agnostic), while SwiftShader's fill rate starves the sim clock at higher dpr; the **dpr-3 visual reference** is `p5_world_regr.cjs` (single-frame capture). `&turbo=1` (verification-only param, zero cost in normal play/§8 captures) pumps **60 fixed 1/60 s sim sub-steps per rendered frame** (~1 s sim per ~2-4 s frame headless). All event assertions are **frame-synchronous** (rAF-resolved evaluates) — dispatch → wait one frame → read is ordering-exact at any frame rate. Evidence: `docs/verification/phase-5/p5_results.json`.

Functional gates — `scripts/p5_mobile_play.cjs`, one JSON verdict per gate:

| Gate | Definition (pass criterion) |
|------|------------------------------|
| G1 title-touch | Fresh load (touch profile): synthetic touch on `press-to-begin` → menu list reveals within 8 rendered frames (frame-synced). **Blocks F1.** |
| G2 journey-start | Tap `New Journey` → title hidden, HUD `display: flex`, pause button visible. |
| G3 joystick-move | 1.5 s full-deflection synthetic stick hold → character displacement ≥ 3 m AND `__playerDebug.speed` reaches ≥ 4.5 m/s (run band). Half deflection → speed ≤ 2.3 m/s. **Blocks F3.** |
| G4 camera-drag | Right-half 200 px drag → `__playerDebug.theta` changes ≥ 0.3 rad **with the stick idle**; `__touchDebug.right` claims the pointer (delivery proof). **Blocks F5; found F13.** |
| G5 pause-touch | Tap pause button → menu visible; tap Resume → closed, joystick state clean. |
| G6 render health | Zero console/page errors across the session (pre-existing dev-only `sw.js` MIME artifact exempt — its text mentions no file path, hence a MIME clause), `ktx2=true`, `__rendererType=webgl2`. |
| G7 tier-governor | Gates the **F9 fix**: touch device starts at MEDIUM. The governor's series is recorded as evidence only — at ~1 fps headless the designed MEDIUM→LOW degradation is correct behavior; a real iPhone at 30 fps never approaches the 75-slow-frames threshold. **Blocks F9 regression.** |
| G8 safe-area / hit-targets | Pause button and joystick geometry via `getBoundingClientRect`: hit targets ≥ 44 px, joystick inset ≥ 24 px from edges, joystick visible. |

Visual evidence (review, not numeric gates): `docs/verification/phase-5/` — title-touch capture, gameplay capture with engaged joystick visuals, pause-open capture, plus a 390-width `?shot=foliage_check&v=cf_floor&tod=day` world regression captured on this branch (must match Phase 4's PASS rows — controls work must not touch world rendering).

Deferred (flagged in PR): on-device iPhone pass (real Safari, real GPU — needs hardware; same bucket as WebGPU POM on-device), haptics (iOS Safari has no Vibration API), real audio unlock E2E (audio not yet wired into main).

## P5.4 Files touched

`src/touch/controls.ts` (rewrite), `src/input.ts`, `src/character.ts`, `src/renderer.ts`, `src/main.ts`, `src/ui/touchui.ts` (new), `src/ui/title.ts`, `src/ui/menu.ts`, `src/ui/index.ts`, `src/ui/styles.css`, `index.html`, `scripts/p5_mobile_play.cjs` (new), `scripts/p5_world_regr.cjs` (new), `scripts/p5_gate_audit.py` (new), `scripts/p5_probe.cjs` (new, F13 diagnostic), `docs/verification/phase-5/*`.

## P5.5 Results (final run)

9/9 functional gates PASS + EXTRA visibility-release probe PASS; world regression at dpr 3: clip >254.5 = 0.000%, crush <10 = 0.000% (matches Phase 4 cf_floor day PASS row). Captures: `p5_title_touch.png`, `p5_joystick_engaged.png` (knob deflected mid-run), `p5_pause_open.png`, `p5_world_regr_cf_day_390.png`. Measured highlights: full-deflection speed 5.0 m/s (run band), half-deflection 2.19 m/s (walk band), 200 px drag → exactly 2.0 rad theta change, joystick dock inset 26 px, pause hit target 76.8×44 px.
