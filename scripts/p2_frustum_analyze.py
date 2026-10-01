#!/usr/bin/env python3
"""Diff with_char vs nochar captures — locate Naira's footprint (p2-5)."""
import numpy as np
from PIL import Image

a = np.asarray(Image.open("shots/p2_frustum_with_char.png").convert("RGB"), dtype=np.int16)
b = np.asarray(Image.open("shots/p2_frustum_nochar.png").convert("RGB"), dtype=np.int16)
if a.shape != b.shape:
    raise SystemExit(f"shape mismatch {a.shape} vs {b.shape}")

d = np.abs(a - b).max(axis=2)
diff = d > 8  # ignore codec-ish noise
h, w = diff.shape
n = diff.sum()
print(f"differing pixels (>8): {n} = {n/(h*w)*100:.3f}% of frame")
if n == 0:
    print("=> Naira is NOT in frustum")
else:
    ys, xs = np.where(diff)
    print(f"bbox: x {xs.min()}..{xs.max()}  y {ys.min()}..{ys.max()}")
    print(f"max abs channel delta: {d.max()}")
    # grid: where is the cluster?
    print(">10% cells (4x4):")
    for gy in range(4):
        print("  " + " ".join(
            f"{diff[gy*h//4:(gy+1)*h//4, gx*w//4:(gx+1)*w//4].sum()/ (h*w//16)*100:5.1f}%"
            for gx in range(4)))
    # save a visualization
    vis = np.asarray(Image.open("shots/p2_frustum_with_char.png").convert("RGB")).copy()
    vis[diff] = [255, 0, 0]
    Image.fromarray(vis).save("shots/_frustum_diff_vis.png")
    crop = Image.fromarray(vis[max(0, ys.min()-40):ys.max()+40, max(0, xs.min()-40):xs.max()+40])
    crop.save("shots/_frustum_diff_crop.png")
    print("saved shots/_frustum_diff_vis.png and _frustum_diff_crop.png")
