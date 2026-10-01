#!/usr/bin/env python3
"""Phase 8 §8.3 gate audit + shadow adjudication table (p8 evidence).

Gate metrics per §8.3 (same conventions as p2/p7 audits):
  - clipped whites: luma >254.5 (gate >2% FAILS, sun-disk exempt rows noted)
  - crushed blacks: luma <10 (gate >10% FAILS, night exempt)

Rows:
  1. Regression rows: material_check day/dawn + character_closeup day +
     valley_overview day on the phase-8 branch (post lighting.ts change).
     The lighting.ts change is SHADOW-PATH-ONLY and the container cannot
     render shadow contributions (minimal-repro proof), so these rows must
     stay within each shot's previously-passing gate envelope.
  2. shadow_check adjudication rows: baseline vs &sx=upm (identical ->
     projection was never stale) vs &sx=off (identical -> shadows contribute
     ~zero in-container) vs &sx=nb0.
Outputs docs/verification/phase-8/gate_audit.txt content to stdout.
"""
import numpy as np
from PIL import Image

FILES = [
    ("mc_day 1280 ", "shots/p8_post_mc_day.png", False),
    ("mc_dawn 1280", "shots/p8_post_mc_dawn.png", False),
    ("cc_day 1280 ", "shots/p8_post_cc_day.png", False),
    ("vo_day 1280 ", "shots/p8_post_vo_day.png", False),
    ("sc_base day ", "shots/p8_sc_base.png", False),
    ("sc_upm day  ", "shots/p8_sc_upm.png", False),
    ("sc_nb0 day  ", "shots/p8_sc_nb0.png", False),
    ("sc_off day  ", "shots/p8_sc_off.png", False),
]

print(f"{'capture':13s} {'clip>254.5':>10s} {'crush<10':>9s} {'verdict':>8s}")
overall = True
for label, f, exempt in FILES:
    im = np.asarray(Image.open(f).convert("RGB"), dtype=np.float32)
    h, w, _ = im.shape
    lum = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    clip = (lum > 254.5).sum() / (h * w) * 100
    crush = (lum < 10).sum() / (h * w) * 100
    ok = clip <= 2.0 and (crush <= 10.0 or exempt)
    overall &= ok
    v = "PASS" if ok else "FAIL"
    notes = []
    if clip > 2.0:
        notes.append("clipped>2%")
    if crush > 10.0 and not exempt:
        notes.append("crush>10%")
    if notes:
        v += " (" + ",".join(notes) + ")"
    print(f"{label:13s} {clip:9.3f}% {crush:8.2f}% {v:>8s}")

print()
print("shadow adjudication (from p8_diff.py, full-frame):")
print("  base vs upm : identical (0.001% >8)  -> projection matrix was never stale in r186")
print("  base vs off : ~identical (0.002% >8) -> shadow contribution ~zero in-container")
print("  base vs nb0 : 0.469% >8              -> in-game lookup partially live, normalBias modulates it")
print("  minimal on/off: pixel-identical       -> canonical example also casts nothing (SwiftShader)")
print("  minimal on/nosun: mean|d|=85.96       -> direct lighting works; ONLY shadow sampling is dead")
print()
print("OVERALL:", "PASS" if overall else "FAIL")
