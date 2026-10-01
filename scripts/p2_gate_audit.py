#!/usr/bin/env python3
"""FINAL Phase 2 §8.3 gate audit — material_check matrix (p2-5 evidence).

Per capture:
  - clipped whites: >254.5 (gate: >2% of frame FAILS, sun disk exempt)
  - near-white: >250 (advisory proximity metric)
  - crushed blacks: <10 (gate: >10% FAILS, night exempt)
  - wall ROI (masonry-only band) percentiles
Outputs the gate table used in the PR description and worklog.
"""
import numpy as np
from PIL import Image

# (label, file, night_exempt)
FILES = [
    ("day  1280", "shots/p2_material_day_1280_webgl2.png", False),
    ("dawn 1280", "shots/p2_material_dawn_1280_webgl2.png", False),
    ("dusk 1280", "shots/p2_material_dusk_1280_webgl2.png", False),
    ("night 1280", "shots/p2_material_night_1280_webgl2.png", True),
    ("day  390 ", "shots/p2_material_day_390_webgl2.png", False),
    ("dawn 390 ", "shots/p2_material_dawn_390_webgl2.png", False),
]

print(f"{'capture':10s} {'clip>254.5':>10s} {'near>250':>9s} {'crush<10':>9s} "
      f"{'wallP99':>8s} {'verdict':>s}")
overall = True
for label, f, exempt in FILES:
    im = np.asarray(Image.open(f).convert("RGB"), dtype=np.float32)
    h, w, _ = im.shape
    lum = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    clip = (lum > 254.5).sum() / (h * w) * 100
    near = (lum > 250).sum() / (h * w) * 100
    crush = (lum < 10).sum() / (h * w) * 100
    roi = lum[int(h * 0.30): int(h * 0.70), int(w * 0.03): int(w * 0.97)]
    rp99 = np.percentile(roi, 99)
    ok_clip = clip <= 2.0
    ok_crush = crush <= 10.0 or exempt
    ok = ok_clip and ok_crush
    overall &= ok
    v = "PASS" if ok else "FAIL"
    notes = []
    if not ok_clip:
        notes.append("clipped>2%")
    if not ok_crush:
        notes.append("crush>10%")
    if exempt:
        notes.append("night-exempt crush")
    print(f"{label:10s} {clip:9.3f}% {near:8.2f}% {crush:8.2f}% {rp99:8.1f}  "
          f"{v}{' (' + ', '.join(notes) + ')' if notes else ''}")
print(f"\nOVERALL: {'PASS' if overall else 'FAIL'}")
