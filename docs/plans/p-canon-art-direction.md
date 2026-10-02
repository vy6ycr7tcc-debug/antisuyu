# P-CANON — Art-direction canon: measured foundation & roadmap (P-CANON-1)

Status: PLAN + MEASUREMENT (no runtime code changed in this phase)
Branch: `p-canon-art-direction` (cut from `main` @ be71863 — doctrine: every PR targets main, every branch cut from current main, no stack branches)
Trigger: owner directive — "Graphics are awful, please follow these as canon" (9 reference files).

## 0. Authority chain

`docs/visual-bible.md` remains normative law EXCEPT where the owner's uploaded
references (`docs/art-canon/*.jpeg`) conflict with it: **the owner's images win**.
This document records that amendment with measured values; the P-CANON phases
apply it to the bible's hex rules (§2 palette anchors, §4/§5 material and
biome values, §6 atmosphere). Adjectives still never override numbers — the
numbers below are measured from the owner's files.

## 1. Canon inventory

Versioned in `docs/art-canon/`:

| File | Role |
|---|---|
| concept-valley.jpeg | Hero vista: cloud-forest valley, rope bridge, god rays, layered mist, river |
| concept-ruins.jpeg | Ruins mood: granite ashlar, cool fog, torch ember accent, moss joints |
| concept-character.jpeg | Naira: grounded Andean explorer — olive jacket, leather harness, climbing kit |
| environment-planks.jpeg | Tileable: silvered plank deck + rope lashing + rusted iron straps |
| environment-stonework.jpeg | Tileable: dark granite fieldstone/ashlar, moss joints, leaf litter |
| environment-foliage.jpeg | Tileable: cloud-forest undergrowth (ferns, bromeliads, broadleaf, moss) |
| environment-forest-floor.jpeg | Tileable: near-black humus, moss clumps, litter, pebbles |
| environment-bark.jpeg | Tileable: deeply fissured dark bark, moss in crevices |
| IMG_2493.jpeg | ⚠️ AMBIGUOUS: real photo of a party sparkler. Tentative reading = emissive spark/ember VFX reference (matches the torch in concept-ruins). **Owner to confirm** — excluded from albedo canon until then. |

## 2. Measured canon palette

All values **measured from the reference pixels** (`scripts/p_canon_palette.py` →
`docs/art-canon/canon-palette.json` + `canon-palette-sheet.png`; medians in sRGB,
L = median luminance 0–255):

Tileables approximate **albedo truth** (shot under even light):

| Material | Measured albedo | L |
|---|---|---|
| foliage leaf band | `#2e3e20` – `#32442f` | 55–62 |
| moss (understory) | `#2c3e15` | ≈55 |
| forest-floor humus | `#191e08` | ≈27 |
| floor litter (dry) | `#31261f` | ≈39 |
| stone (granite fieldstone) | `#3c3b37` – `#403c37` | ≈60 |
| bark (fissured) | `#2d2b26` | ≈42 |
| planks (silvered wood) | `#5c5046` – `#6b5f54` | 89–95 |
| iron strap (rust) | `#53453e` | ≈71 |
| rope | `#736659` | ≈101 |

Scene concepts fix the **lighting grammar** (not albedo): warm key `#dec6a7`
through mist, cool shadow foliage `#283133`, far-mountain aerial `#89836e`,
ruins fog `#6686a2`, ember accent (spark core measured `#baa796`).

## 3. Gap table — current implementation vs canon (measured)

| Domain | Current (source hex) | Current L | Canon L | Δ |
|---|---|---|---|---|
| cf/jl canopy tint | terrain `soilB 0x3E5E2A` + decor species tints | ≈88 | 55–62 | **-26..-33, too bright+sat** |
| understory moss | paititi `moss 0x5A7247` | ≈107 | ≈55 | **-52** |
| floor/soil | cf `soilA 0x3B2E22` | ≈49 | 27–39 | **-10..-22** |
| limestone/plaza stone | `0xB8B0A0`, `0x9A917E`, `0xA89E86` | 145–158 | ≈60 | **-85..-98** |
| trim-sheet stone anchor | textures.ts §2 `#B5A98F` | ≈169 | ≈60 | **-109** |
| bark / aged wood | `woodAged 0x5C4033` | ≈70 | ≈42 | **-28 (+desaturate)** |
| planks (bridge deck) | no dedicated material | — | 89–95 | **missing material** (planks+rope+strap) |
| character | phase-7 materials | — | olive/harness band | audit needed |
| lighting | V-ATMOS rigs | — | god rays + layered mist + ember accents | gap audit needed |
| ember VFX | lamp/torch emissives | — | spark-core `#baa796` particles | not implemented |

## 4. Roadmap

- **P-CANON-1 (this PR)** — canon assets into repo, measured palette
  (`canon-palette.json`, contact sheet), this plan + gap table. Zero runtime risk.
- **P-CANON-2 — albedo regrade**: terrain biome script + decor species tints +
  wood/bark + stone material anchors toward the measured bands. Gates: §8.3
  subset matrix (day/dawn × cf/sierra/paititi/valley, 1280 + 390) + NEW
  canon-swatch gate (rendered material median within tolerance of the
  `canon-palette.json` band). Known risk: darker shadow albedo raises dawn
  crush (`lt10`) — compensate in the ToD rigs with measured hemisphere lift
  where needed; XFAIL-document what cannot pass (valley/paititi dawn rows are
  already XFAIL from phase 4).
- **P-CANON-3 — trim-sheet re-bake**: stonework band redesign (dark granite +
  moss joints + litter) through the phase-2 map-audit pipeline
  (albedo/normal/ORMH dump proof); plank deck + rope/strap band added (bridge
  deck material); bark fissure rework.
- **P-CANON-4 — atmosphere & light**: god-ray density/angle per
  concept-valley, cool fog per concept-ruins, ember/spark particle VFX for
  torches (pending IMG_2493 confirmation), night ember accents.
- **P-CANON-5 — character pass**: Naira palette toward concept-character
  (olive/harness/leather band); material audit only (mesh/geometry out of
  scope without new art direction).
- Each phase: separate PR targeting main, cut from current main, gates
  measured, **no merges by the author — Samuel merges**.

## 5. Evidence

- `docs/art-canon/canon-palette.json` — full measurement (median RGB/hex,
  p10/p90 luminance per named region).
- `docs/art-canon/canon-palette-sheet.png` — swatch contact sheet (hex + L
  per region).

## 6. P-CANON-2 results (branch p-canon-2-albedo)

All regraded anchors verified against the measured bands by
`scripts/p_canon2_gate_audit.py` (albedo-source audit, ±4 luma):
**12/12 IN BAND**. §8.3 subset matrix (day/dawn × cf/jungle/paititi/sierra/
valley @1280 + cf @390, built bundle, WebGL2): **10/10 gated rows PASS**
(clip 0.000% on all rows; crush worst row 3.94%).

Dawn compensation (plan-predicted risk, measured and applied): cf_dawn
crush 9.96% → 25.55% after the regrade; fixed with the authorized ToD
hemisphere lift (dawn hemiIntensity 0.25 → 0.65, hemiGround 0x4A4038 →
0x5A5048, exposure 1.0 → 1.08, envIntensity 0.35 → 0.50; sun key/elevation
untouched). Post-compensation sweep measured: 25.55 → 3.94% (1280),
24.74 → 1.68% (390). Side effect: valley_dawn (phase-4 XFAIL, 15.42%)
now measures 0.04% — the lift retired that XFAIL. paititi_dawn remains
XFAIL (54.20% → 23.30%, dome self-shadow physics — separate deferred fix).
Dusk row untouched (west-sun clip headroom constraint, Phase 2).

Deferred (unchanged scope): sierra granite row 0x6E6A63 + plaster band
audit; trim-band redesign + plank/rope material (P-CANON-3); god rays /
ember VFX (P-CANON-4); character palette (P-CANON-5).
