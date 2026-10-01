#!/usr/bin/env python3
"""Curate Phase 3 verification evidence into docs/verification/phase-3/."""
import os
from PIL import Image

OUT = "docs/verification/phase-3"
os.makedirs(OUT, exist_ok=True)

COPIES = {
    "shots/p3_sierra_day_1280_webgl2.png": "terrain_sierra_day_1280_webgl2.png",
    "shots/p3_sierra_dawn_1280_webgl2.png": "terrain_sierra_dawn_1280_webgl2.png",
    "shots/p3_snowline_dawn_1280_webgl2.png": "terrain_snowline_dawn_1280_webgl2.png",
    "shots/p3_river_dawn_1280_webgl2.png": "terrain_river_dawn_1280_webgl2.png",
    "shots/p3_cf_day_1280_webgl2.png": "terrain_cf_day_1280_webgl2.png",
    "shots/p3_jungle_day_1280_webgl2.png": "terrain_jungle_day_1280_webgl2.png",
    "shots/p3_paititi_day_1280_webgl2.png": "terrain_paititi_day_1280_webgl2.png",
    "shots/p3_boundary_day_1280_webgl2.png": "terrain_boundary_day_1280_webgl2.png",
    "shots/p3_sierra_day_390_webgl2.png": "terrain_sierra_day_390_webgl2.png",
    "shots/p3_sierra_day_LOW_webgl2.png": "terrain_sierra_day_LOW_1280_webgl2.png",
    "shots/p3_valley_day_regr_webgl2.png": "valley_day_regression_webgl2.png",
    "shots/p3_valley_dawn_regr_webgl2.png": "valley_dawn_regression_webgl2.png",
    # A/B evidence: Phase 1 curated still shows the pre-existing water-quad
    # poke-through + chunk-cull bloom ring + old fbm-static terrain.
    "docs/verification/phase-1/fixed_valley_day_webgl2.png": "ab_reference_phase1_valley_day.png",
}
for src, dst in COPIES.items():
    Image.open(src).save(os.path.join(OUT, dst))
    print("curated", dst)
