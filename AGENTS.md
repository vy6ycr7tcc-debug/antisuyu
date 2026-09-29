# AGENTS.md — ANTISUYU

Realistic WebGPU open-world action-adventure set in the Andes (search for Paititi).
Third-person, Tomb Raider / Uncharted lineage. Photorealism is the bar: every frame
should be defensible as a photograph.

## Build / test
- `npm ci` to install. `npm run typecheck` must pass. `npm run build` must succeed.
- Never ship a phase on typecheck/build alone.

## Verification rule (mandatory)
- Every visual or gameplay claim must be verified with the still-frame hook:
  `?shot=<sceneId>&t=<seconds>`, gated on `window.__shotReady`.
- Boot the game in a real (or headless Chromium) browser and capture frames before
  calling anything done. A green build is not a working game.

## Push discipline (mandatory)
- Commit and push to the session branch after EACH milestone/phase.
  Never accumulate unpushed work. Unpushed work does not exist.

## Renderer rules
- WebGPU (`three/webgpu`) is the primary renderer; WebGL2 is the required fallback
  (iOS Safari has no WebGPU). Both paths must boot and be playable; the fallback
  gets reduced settings, not a black screen.
- Import TSL helpers from `'three/webgpu'` — `build/three.tsl.js` does NOT exist on CDN.
- `WebGPURenderer` requires `await renderer.init()` before the first render.

## Paths
- Game code: `src/`. Static assets: `public/`. Docs: `docs/`.
- Keep PRs scoped: one feature per session, one branch per session.

## Definition of ready (project-level)
- Boots on desktop Chrome/Edge (WebGPU) AND iPhone Safari (WebGL2 fallback).
- Sustained 60 fps desktop / 30 fps fallback on target hardware, adaptive quality.
- 10-minute play session with no crashes or blocking bugs.
- Core loop completable: explore, traverse, solve, progress the Paititi quest.
- Screenshot review passes the photorealism bar.
