# Phase 10 (V-REG1) — attribution & evidence notes

Scope: cloud forest + high sierra dressing pass (bible §2.2/§2.3) + the
p10-audit defect fixes. Files: `src/regions/cloudForest.ts`,
`src/regions/highSierra.ts`, `src/materials.ts` (six §2.2/§2.3 dressing
factories: humusEarth, mossPatch, lichenPatch, broadleafCard, orchidAccent,
terracotta).

## Defects found by the audit (all fixed)

| # | Defect | Evidence |
|---|--------|----------|
| ① | `Math.random()` in every region build — J7 violation; §8 captures were not reproducible run-to-run (p6 fixed volumetrics, regions were missed) | det A/B pairs in gate_audit.txt: `0.000% diff, mean\|d|=0.00` (was re-rolled every load pre-p10) |
| ② | highSierra added its own `DirectionalLight(0xffffff, 1.5)` on region enter — a second sun double-grading the region (light rig is §7/V-LIGHT-owned; p8 territory) | probe row: force-added light at build moves 20.96% of the frame, meanL 191.1 vs 185.6 (`p10_probe_doublesun.png` vs `p10_hs_overview_day.png`) |
| ③ | `as any` casts on userData assignments (repo rule: no `any` casts) | code diff |
| ④ | outpost patrol lights `0xff0000` red / resolve `0x00ff00` green — arcade signals, contradict the muted Sol Negro palette (§2.2) | code diff; warm 0xffaa00 + ember dim now |
| ⑤ | excavation pit materialized with `ashlarWeathered()` — raw earth read as dressed stone | `p10_cf_excavated_ruin_day.png` (humusEarth now) |

## Shot-mode blindspot discovered (documented, pre-existing)

`regionManager.update()` tracks the CHARACTER position (main.ts:1101); in
shot mode the character is hidden at spawn, so **region enter/exit callbacks
never fire in shot mode**. Consequences, all verified:

- The pre-p10 rogue light never fired in captures — the `p10pre_*` captures
  are frame-identical to post. The defect was a LIVE-PLAY defect only; the
  audit evidence is the force-added probe row, not a pre/post pair.
- Enter-gated ambient animation is invisible in every §8 capture (same
  mechanism as p4's `decor.update()` finding). The p10 condor is therefore
  always-on (not enter-gated) so it exists in captures like the rest of the
  dressing.
- The cf mist tint keeps its build-time fog sample (added) instead of relying
  solely on the enter loop.

## §2.2/§2.3 vocabulary now present

- Cloud forest: rope bridge (fiber), broadleaf cards, hanging moss strands,
  moss step caps, orchid clusters on trunks, fallen logs, cliff flanks on the
  staircase, half-sunk moss-capped blocks on the pit rim.
- High sierra: cairns (qenko, paqarina), lichen patches (outcrop, cliff
  faces, cave mouth), terraced retaining walls, stone-lined water channel
  (reveals water on sluice solve — §2.3 "routes water"), terracotta pottery
  shards, animated condor silhouette (90 s orbit, fixed-dt).

## Gate summary (full output in gate_audit.txt)

- 12/12 §8.3 rows PASS (cf/hs × day/dawn × overview/POI × 1280/390).
- Determinism pairs: 0.000% (J7 fix proven — pre-p10 these re-rolled).
- tsc + build clean; 0/1 real render errors (the 1 = documented sw.js MIME).
- The condor does not enter the hs_overview framing (0.0000% in probe A/B);
  det pairs unaffected.
