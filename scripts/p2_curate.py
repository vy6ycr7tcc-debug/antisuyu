#!/usr/bin/env python3
"""Curate Phase 2 verification evidence into docs/verification/phase-2/:
- 6 final material_check captures (WebGL2 matrix)
- trim-sheet map contact sheet (albedo | normal | ORMH) from /tmp PPMs
"""
import os
import numpy as np
from PIL import Image

OUT = "docs/verification/phase-2"
os.makedirs(OUT, exist_ok=True)

# 1) final captures
COPIES = {
    "shots/p2_material_day_1280_webgl2.png": "material_day_1280_webgl2.png",
    "shots/p2_material_dawn_1280_webgl2.png": "material_dawn_1280_webgl2.png",
    "shots/p2_material_dusk_1280_webgl2.png": "material_dusk_1280_webgl2.png",
    "shots/p2_material_night_1280_webgl2.png": "material_night_1280_webgl2.png",
    "shots/p2_material_day_390_webgl2.png": "material_day_390_webgl2.png",
    "shots/p2_material_dawn_390_webgl2.png": "material_dawn_390_webgl2.png",
}
for src, dst in COPIES.items():
    Image.open(src).save(os.path.join(OUT, dst))
    print("curated", dst)

# 2) trim-sheet contact sheet: stack albedo/normal/ORMH vertically at 768 px
tiles = []
for name, label in [("trim_albedo", "albedo (sRGB)"),
                    ("trim_normal", "normal (tangent)"),
                    ("trim_ormh", "ORMH packed (O/R/M/H)")]:
    ppm = f"/tmp/{name}.ppm"
    with open(ppm, "rb") as f:
        magic = f.readline().strip()
        w, h = map(int, f.readline().split())
        f.readline()
        data = np.frombuffer(f.read(), dtype=np.uint8).reshape(h, w, 3)
    im = Image.fromarray(data).resize((768, 768), Image.LANCZOS)
    tiles.append(np.asarray(im))

gap = 6
sheet = np.full((768 * 3 + gap * 2, 768, 3), 24, dtype=np.uint8)
for i, t in enumerate(tiles):
    y = i * (768 + gap)
    sheet[y:y + 768] = t
Image.fromarray(sheet).save(os.path.join(OUT, "trimsheet_maps_contact.png"))
print("curated trimsheet_maps_contact.png", sheet.shape)
