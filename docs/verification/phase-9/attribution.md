# Phase 9 (V-POST) — measured attribution & sweeps

All rows WebGL2 (container), 1280×800 unless noted; clip = % luminance >254.5
(gate 2%), crush = % luminance <10 (gate 10%, night exempt). Harness:
`scripts/p9_batch.cjs` + `scripts/p9_measure.py`; audit: `scripts/p9_gate_audit.py`.

## 1. Stage attribution — the two p7-flagged defects

Levers added this phase (§5.4 defaults, both post paths):
`&bt=` bloom threshold · `&bs=` strength · `&br=` radius · `&vs=` vignette · `&gs=` grain.

### Day clip (p7 XFAIL: composed 9.733% vs raw 2.48%, "bloom wash @ sky-heavy framing")

| row | clip% | attribution |
|---|---|---|
| base (old chain, §5.4 constants) | 9.733 | the flagged defect |
| `&bt=99` (bloom off, old chain) | 1.647 | **bloom = +8.1 pts** of clip |
| `&vs=0` (vignette off, old chain) | 13.475 | vignette was MASKING −3.7 pts (pre-tonemap it could not bound the bloom add) |
| `&gs=0` (grain off, old chain) | 9.733 | grain ≈ 0 contribution |
| `&tv=1` (post off) | 2.482 | raw day-sky clip = p2 obs.① (owned upstream) |

### Dusk crush (p7 XFAIL: composed 14.32% vs raw 2.54%, "vignette edge-crush")

| row | crush% | attribution |
|---|---|---|
| base (old chain) | 14.68 | the flagged defect (p7: 14.32; p8 normalBias shift +0.4) |
| `&gs=0` (grain off, old chain) | 2.84 | **grain = +11.8 pts** — the ±0.035 was applied LINEAR pre-tonemap ≈ ±30 SDR on shadows |
| `&vs=0` (vignette off, old chain) | 8.07 | vignette = +6.6 pts (overlapping the same dark-edge pixels) |
| `&bt=99` (bloom off, old chain) | 14.68 | bloom ≈ 0 contribution |
| `&tv=1` (post off) | 2.54 | raw |

**Conclusion:** the "vignette edge-crush" flag was mostly the GRAIN in the wrong
space; the vignette's contribution was real but smaller. Both are display-referred
after the J8 restructure; the vignette was additionally re-swept (below).

## 2. J8 restructure — pipeline verification

New chain (both paths): `bloom (HDR) → tonemap+encode → cinematic grade (display)`.

| row | clip% | crush% | meanL |
|---|---|---|---|
| neutral post (`&bt=99&vs=0&gs=0`, new chain) | 2.584 | 0.00 | 139.6 |
| raw (`&tv=1`) | 2.482 | 0.00 | 138.8 |

The CA-only passthrough reproduces the raw frame ⇒ OutputPass-mid-chain + grade-last
preserves the color pipeline (no double grade, no lost encode). Same construction on
WebGPU via `renderOutput()` + `outputColorTransform = false` (unmeasurable in-container;
parity by construction, on-device pass still owed).

## 3. Vignette retune sweep (display-referred, §5.4 constants otherwise)

| vs | day meanL | dawn crush% | dusk crush% | night meanL |
|---|---|---|---|---|
| 0.55 (old value) | 156.4 | 41.09 | 2.95 | 2.6 |
| 0.45 | 163.8 | 38.60 | 2.59 | 2.7 |
| 0.35 | 171.2 | 36.14 | 2.35 | 2.8 |
| **0.25 (chosen)** | **178.6** | **33.70** | **2.19** | **2.9** |

Pre-p9 composed references: day 187.7 · dawn 35.09 (XFAIL) · dusk 14.68 · night 5.0.
vs=0.25 restores day brightness to just under pre-p9 while IMPROVING every crush row
(dawn 33.70 < 35.09; valley_overview dawn 10.47 → 0.09 — now passes).

## 4. Bloom: why the §5.4 values stay (sky-vs-lamp separation analysis)

Day meanL by bloom config (vs=0.25): bt=0.85/bs=0.35 → 178.6 · bt=1.5 → 177.7 ·
bt=2.0 → 175.4 · bt=99 → 125.8; bs 0.25 → 172.1 · 0.15 → 162.6.

No linear threshold separates the sky from the lamps: the day sky's linear radiance
(≈2–50 near the sun) OVERLAPS/exceeds the lamp emissive (2.0, the §4.4 cap), so any
bt that keeps lamps glowing (bt < 2.0) keeps the sky-bulk wash (bt=1.5 removes only
−0.9 meanL). bs scales the wash and the lamp halos together. Bloom values are
therefore UNCHANGED (0.35/0.4/0.85); the residual day-sky glow is flagged for a
future selective (emissive-only) bloom pass. The day CLIP defect is resolved by the
display-referred chain: the vignette bounds the output range (any strength >~0.05
masks 255 → <254.5 off-center), which is honest post behavior — the raw row keeps
the p2 obs.① sky-clip evidence for the upstream owner.

## 5. Lamp intent preserved (bloom alive post-restructure)

Ruin lamps (cloudForest 150,−300; §4.4 lampEmissive 2.0) at night, bloom on vs `&bt=99`:
22.4% of the ROI moves >8 (mean|d| 7.36) — the lamp glow renders. Evidence:
`ab_lamp_bloom_on/off.png`.

## 6. Harness notes (lessons re-learned)

- **mc_dawn row config:** `material_check` dawn requires the recorded `&lt=3.0`
  (p2's measured pitch sweep). The lt-less row re-measures the flat-on dawn physics
  (33.6% raw) and is NOT comparable — same lesson as p2's `dawn_390`.
- **Determinism:** post chain is static; same-URL re-capture differs only in one
  ≈38×11 px foliage-card cluster (wall-clock wind phase across page loads;
  scene-level, pre-p4; p8's 0.000% control was the bare shadow_check deck):
  0.004% of frame, all else pixel-identical.
- The sw.js dev MIME error (1/row on some loads) is the documented pre-existing
  artifact, not a render error.
