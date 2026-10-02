# Phase 11 (V-REG2 + backlog) — attribution & evidence notes

Scope: jungle lowlands + Paititi dressing pass (bible §2.4/§2.5) plus the
flagged-owners backlog: LOD T-junction chunk skirts (p3/p4/p5/p8-deferred)
and the materials.ts RenderCaps duplicate (p2-flagged). Files:
`src/regions/jungleLowlands.ts`, `src/regions/paititi.ts`, `src/terrain.ts`,
`src/materials.ts`.

## Defects found by the audit (all fixed)

| # | Defect | Evidence |
|---|--------|----------|
| ① | `Math.random()` in jungle build AND inside the encounter loop (rockfall trigger/landing) — J7 violation, same family as p10 ① | det A/B: 0.000% (was re-rolled every load) |
| ② | `foamAtEdges: false` on both jungle black-water surfaces — contradicts §2.4 "black-water pools **with foam edges**" | code diff; `p11_jl_serpents_path_day.png` |
| ③ | Paititi plaza was a bare slab with a floating gold disk — the p3-flagged "plaza flats"; §2.5 dais/colonnade vocabulary missing | `p11_pa_plaza_day.png` (dais courses, colonnade ring, green rim, plazaWorn paving) |
| ④ | `(c.material as any)` cast in the charge blink (repo rule: no `any` casts) | typed `instanceof MeshStandardMaterial` guard |
| ⑤ | Paititi imported `ashlarWeathered` without using it | import cleaned |
| ⑥ | **Every `pa_*` region shot rendered underground** — the shot table heights (y 10–150) were authored against a y≈0–100 plateau, but the measured terrain samples 253–688 m (probe: `p11_height_probe.cjs`). All pa_ captures since authoring were pure fog frames — including p3's pa rows | pre/post pairs: pa_plaza **82.8%** moved, pa_overview **90.6%** moved (pre = fog frame, post = the city) |

## Paititi shot re-anchoring (defect ⑥)

Shot heights re-derived from `getGlobalTerrainHeight` at the shot coords
(camera = local terrain + 25–45 m; lookAt at structure level):

| shot | terrain at cam | new cam y | lookAt |
|---|---|---|---|
| pa_overview | 396.9 | 440 | (1100, 490, −50) plaza |
| pa_outer_terraces | 252.9 | 278 | (900, 345, −100) terrace mid |
| pa_plaza_of_sun | 436.7 | 492 | (1100, 485, −50) plaza surface |
| pa_sanctuary | 638.4 | 700 | (1300, 695, 50) rotunda mid |
| pa_aqueduct_line | 519.9 | 578 | (1200, 572, 0) channel water |

## Backlog items closed

- **LOD T-junction chunk skirts** (terrain.ts): each chunk edge gets a
  vertical strip of duplicated vertices lowered 14 m, carrying edge
  color/normal/uv, outward-oriented indices; the trimesh collider picks the
  skirt up as vertical walls. Closes the crack/sun-bleed family flagged by
  p3 (skirt follow-up note), p4 (far chunk-edge sun-bleed), p5 (river-bank
  adjacency) and p8 (deferred list).
- **RenderCaps hygiene** (materials.ts): the p2-flagged duplicate interface
  is gone — `materials.ts` now imports the canonical §7.2 type from
  `renderer.ts` and re-exports it (type-only import, no runtime edge);
  jungle/paititi keep importing from `materials.js`.

## §2.4/§2.5 vocabulary now present

- **Jungle:** buttress roots bracing each serpent-arch foot, liana strands
  from the arch crowns, half-buried carved blocks (spiral accent #C9A86A) in
  the tunnels, foam-edged black water. Fungus was already §2.4-compliant
  (#7FB069, intensity 0.35, no light) — kept.
- **Paititi:** three-course plaza dais, 8-pillar colonnade ring (7 m civic
  scale), encroaching-green rim mounds (edges only, §2.5), `plazaWorn()`
  paving. Gold never emissive (§2.5 law) — unchanged.

## Gate summary (full output in gate_audit.txt)

- 13/13 §8.3 rows PASS (jl/pa × day/dawn × overview/POI × 1280/390);
  worst clip 0.071% (pa_overview_390), worst crush 0.83% (jl_vanguard_dawn).
- Pre/post: pa_plaza 82.77%, pa_overview 90.60% (defect ⑥ fix + dressing),
  jl_serpents 0.499% (dressing only).
- J7 det pairs 0.000% ×2.
- tsc + build clean; 0/1 real render errors (1 = documented sw.js MIME).
- WebGPU parity by construction (Standard materials only); on-device pass
  remains the container-owed item.
