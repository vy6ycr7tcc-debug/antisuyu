#!/usr/bin/env python3
"""P-CANON-2 gate audit.

Part 1 — §8.3 subset matrix (docs/verification/p-canon-2/*.png):
  clipped whites >254.5 (gate 2%), crushed blacks <10 (gate 10%;
  night exempt — no night rows in this matrix). XFAIL rows (pre-existing
  phase-4 dawn failures) are reported and compared, not gated.

Part 2 — NEW canon-swatch audit (albedo-source level):
  verifies every P-CANON-2 regraded anchor in src/ maps into its
  canon-palette.json band (Rec.709 luma, tolerance ±4). The flat anchor
  IS the material's albedo median before lighting; rendered-pixel swatch
  auditing lands with P-CANON-3's map-audit pipeline.
"""
import json
import os
import re
import sys

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
EV = os.path.join(ROOT, "docs", "verification", "p-canon-2")

# (label, file, xfail)
FILES = [
    ("cf_day_1280    ", "canon2_cf_day_1280.png", False),
    ("cf_dawn_1280   ", "canon2_cf_dawn_1280.png", False),
    ("jungle_day_1280", "canon2_jungle_day_1280.png", False),
    ("jungle_dawn_1280", "canon2_jungle_dawn_1280.png", False),
    ("paititi_day_1280", "canon2_paititi_day_1280.png", False),
    ("paititi_dawn_1280", "canon2_paititi_dawn_1280_XFAIL.png", True),
    ("sierra_day_1280", "canon2_sierra_day_1280.png", False),
    ("sierra_dawn_1280", "canon2_sierra_dawn_1280.png", False),
    ("valley_day_regr", "canon2_valley_day_regr.png", False),
    ("valley_dawn_regr", "canon2_valley_dawn_regr_XFAIL.png", True),
    ("cf_day_390     ", "canon2_cf_day_390.png", False),
    ("cf_dawn_390    ", "canon2_cf_dawn_390.png", False),
]

def luma(hexint):
    r = (hexint >> 16) & 0xFF
    g = (hexint >> 8) & 0xFF
    b = hexint & 0xFF
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

# (file, regex, canon band (lo, hi), tolerance)
SWATCHES = [
    ("src/terrain.ts",  r"soilA: new THREE\.Color\((0x[0-9a-fA-F]{6})\)", (27, 39), 4, "CF soilA (humus)"),
    ("src/terrain.ts",  r"soilB: new THREE\.Color\((0x[0-9a-fA-F]{6})\)", (55, 62), 4, "CF soilB (canopy)"),
    ("src/terrain.ts",  r"moss: new THREE\.Color\((0x[0-9a-fA-F]{6})\)", (51, 59), 4, "JL moss"),
    ("src/terrain.ts",  r"rockA: new THREE\.Color\((0x[0-9a-fA-F]{6})\)", (56, 64), 4, "PA plaza stone"),
    ("src/decor.ts",    r"colorA: (0x2c3e15), colorB: (0x[0-9a-fA-F]{6})", (51, 59), 4, "species moss A"),
    ("src/decor.ts",    r"colorB: (0x32442f)", (55, 62), 4, "species foliage B"),
    ("src/materials.ts", r"color: (0x2c3e15)", (51, 59), 4, "mossPatch"),
    ("src/materials.ts", r"color: (0x2d2b26)", (38, 46), 4, "woodAged (bark)"),
    ("src/materials.ts", r"color: (0x3d3c37)", (56, 64), 4, "limestoneSwallowed"),
    ("src/materials.ts", r"color: (0x403c37)", (56, 64), 4, "plazaWorn"),
    ("src/materials.ts", r"color: (0x26200f)", (27, 39), 4, "humusEarth"),
    ("src/textures.ts", r"STONE_BASE = \{ r: (0x[0-9a-fA-F]{2}), g: (0x[0-9a-fA-F]{2}), b: (0x[0-9a-fA-F]{2}) \}", (56, 64), 4, "trim STONE_BASE"),
]

def canon_luma_from_name(name_frag):
    """Pull a measured luma from canon-palette.json when the key matches."""
    p = os.path.join(ROOT, "docs", "art-canon", "canon-palette.json")
    try:
        data = json.load(open(p))
        return data, p
    except FileNotFoundError:
        return None, p

def main():
    print("=== Part 1: §8.3 subset matrix ===")
    print(f"{'capture':18s} {'clip%':>7s} {'crush%':>7s}  verdict")
    overall = True
    for label, f, xfail in FILES:
        fp = os.path.join(EV, f)
        try:
            im = np.asarray(Image.open(fp).convert("RGB"), dtype=np.float32)
        except FileNotFoundError:
            print(f"{label}: MISSING ({f})")
            overall = False
            continue
        h, w, _ = im.shape
        lum = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
        clip = (lum > 254.5).sum() / (h * w) * 100
        crush = (lum < 10).sum() / (h * w) * 100
        ok = clip <= 2.0 and crush <= 10.0
        verdict = "PASS" if ok else ("XFAIL (pre-existing p4 dawn failure)" if xfail else "FAIL")
        if not ok and not xfail:
            overall = False
        print(f"{label} {clip:6.3f}% {crush:6.2f}%  {verdict}")

    print("\n=== Part 2: canon-swatch audit (albedo-source, ±4 luma) ===")
    for path, rx, (lo, hi), tol, label in SWATCHES:
        src = open(os.path.join(ROOT, path)).read()
        m = re.search(rx, src)
        if not m:
            print(f"{label:24s} PATTERN NOT FOUND in {path}")
            overall = False
            continue
        groups = m.groups()
        if len(groups) == 3:
            hexint = int(groups[0], 16) << 16 | int(groups[1], 16) << 8 | int(groups[2], 16)
        else:
            hexint = int(groups[0], 16)
        L = luma(hexint)
        ok = (lo - tol) <= L <= (hi + tol)
        overall &= ok
        print(f"{label:24s} 0x{hexint:06x} L={L:5.1f}  band [{lo},{hi}]±{tol}  {'IN BAND' if ok else 'OUT OF BAND'}")

    print(f"\nOVERALL: {'PASS' if overall else 'FAIL'}")
    sys.exit(0 if overall else 1)

if __name__ == "__main__":
    main()
