#!/usr/bin/env python3
"""Curate Phase 4 verification evidence into docs/verification/phase-4/."""
import shutil, os

SRC = "shots"
DST = "docs/verification/phase-4"
os.makedirs(DST, exist_ok=True)

FILES = [
    # primary palette matrix (day + dawn per §8.1 rhythm)
    "p4_cf_floor_day_1280.png",
    "p4_cf_floor_dawn_1280.png",
    "p4_sierra_ichu_day_1280.png",
    "p4_sierra_dawnlit_dawn.png",
    "p4_jungle_fern_day_1280.png",
    "p4_jungle_dawnlit_dawn.png",
    "p4_paititi_edge_day_1280.png",
    "p4_paititi_edge_dawn.png",
    "p4_valley_mix_day_1280.png",
    "p4_valley_dawnlit_dawn.png",
    # wind motion A/B pair (§8.3 motion-ready)
    "p4_windA_cf_day_t0.png",
    "p4_windA_cf_day_t2.png",
    # tiers + mobile
    "p4_cf_floor_day_LOW.png",
    "p4_sierra_ichu_day_LOW.png",
    "p4_cf_floor_day_390.png",
    # regressions on existing shot ids (foliage now visible in shot mode)
    "p4_valley_day_regr.png",
    "p4_valley_dawn_regr.png",
    "p4_terrain_cf_day_regr.png",
    # texture evidence
    "p4_foliage_cards_contact.png",
]

for f in FILES:
    src = os.path.join(SRC, f)
    if os.path.exists(src):
        shutil.copy2(src, DST)
        print(f"  {f}")
    else:
        print(f"  MISSING {f}")
print(f"\n{len(FILES)} files -> {DST}")
