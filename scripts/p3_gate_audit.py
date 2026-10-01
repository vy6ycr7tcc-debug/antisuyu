#!/usr/bin/env python3
"""FINAL Phase 3 §8.3 gate audit — terrain matrix (p3-5 evidence).

Per capture: clipped whites >254.5 (gate 2%), near-white >250 (advisory),
crushed blacks <10 (gate 10%, night exempt), plus terrain-specific checks:
  - chroma spread (mean per-pixel RGB channel spread): flat single-hue
    terrain (the J1 "flat material" killer) measures ~0; vertex-color +
    detail-map work should push it clearly off zero.
  - low-frequency structure: downsample 8x then measure stddev — real
    terrain has macro variation; per-texel static vanishes when downsampled
    (a static-noise frame keeps high full-res stddev but low 8x stddev).
"""
import numpy as np
from PIL import Image

FILES = [
    ("sierra_day_1280 ", "shots/p3_sierra_day_1280_webgl2.png", False),
    ("sierra_dawn_1280", "shots/p3_sierra_dawn_1280_webgl2.png", False),
    ("snowline_dawn_1280", "shots/p3_snowline_dawn_1280_webgl2.png", False),
    ("river_dawn_1280 ", "shots/p3_river_dawn_1280_webgl2.png", False),
    ("cf_day_1280     ", "shots/p3_cf_day_1280_webgl2.png", False),
    ("jungle_day_1280 ", "shots/p3_jungle_day_1280_webgl2.png", False),
    ("paititi_day_1280", "shots/p3_paititi_day_1280_webgl2.png", False),
    ("boundary_day_1280", "shots/p3_boundary_day_1280_webgl2.png", False),
    ("sierra_day_390  ", "shots/p3_sierra_day_390_webgl2.png", False),
    ("sierra_day_LOW  ", "shots/p3_sierra_day_LOW_webgl2.png", False),
    ("valley_day_regr ", "shots/p3_valley_day_regr_webgl2.png", False),
    ("valley_dawn_regr", "shots/p3_valley_dawn_regr_webgl2.png", False),
]

print(f"{'capture':18s} {'clip%':>7s} {'near250%':>9s} {'crush%':>7s} "
      f"{'chroma':>6s} {'std8x':>6s}  verdict")
overall = True
for label, f, exempt in FILES:
    try:
        im = np.asarray(Image.open(f).convert("RGB"), dtype=np.float32)
    except FileNotFoundError:
        print(f"{label}: MISSING")
        overall = False
        continue
    h, w, _ = im.shape
    lum = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    clip = (lum > 254.5).sum() / (h * w) * 100
    near = (lum > 250).sum() / (h * w) * 100
    crush = (lum < 10).sum() / (h * w) * 100
    # chroma spread: mean |R-G| + |G-B| (monochrome frame → ~0)
    chroma = (np.abs(im[..., 0] - im[..., 1]) + np.abs(im[..., 1] - im[..., 2])).mean()
    # macro structure: std of 8x-downsampled luminance
    small = np.asarray(Image.open(f).convert("L").resize((w // 8, h // 8), Image.BOX), dtype=np.float32)
    std8 = small.std()
    ok = clip <= 2.0 and (crush <= 10.0 or exempt)
    overall &= ok
    print(f"{label} {clip:6.3f}% {near:8.2f}% {crush:6.2f}% {chroma:6.1f} {std8:6.1f}  "
          f"{'PASS' if ok else 'FAIL'}")
print(f"\nOVERALL: {'PASS' if overall else 'FAIL'}")
