#!/usr/bin/env python3
"""Phase 9 V-POST measure: clip% (>254.5) / crush% (<10) / meanL for shots/p9_*.png.
Usage: p9_measure.py [name-substring]
Optionally compares against a baseline name given via --vs to attribute deltas.
"""
import sys, glob, os
import numpy as np
from PIL import Image

D = os.path.join(os.path.dirname(__file__), "..", "shots")
sub = ""
for a in sys.argv[1:]:
    if not a.startswith("--"):
        sub = a

rows = sorted(glob.glob(os.path.join(D, f"p9_{sub}*.png")))
if not rows:
    print("no captures match"); sys.exit(1)

print(f"{'name':34s} {'clip>254.5':>10s} {'crush<10':>9s} {'meanL':>7s}")
for f in rows:
    name = os.path.basename(f)[3:-4]
    im = np.asarray(Image.open(f).convert("RGB"), dtype=np.float32)
    h, w, _ = im.shape
    l = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    clip = (l > 254.5).sum() / (h * w) * 100
    crush = (l < 10).sum() / (h * w) * 100
    print(f"{name:34s} {clip:9.3f}% {crush:8.2f}% {l.mean():7.1f}  ({w}x{h})")
