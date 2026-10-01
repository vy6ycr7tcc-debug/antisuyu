#!/usr/bin/env python3
"""Phase 8 A/B diff: two captures compared pixel-wise.

Prints mean|d|, p99|d|, and % pixels with |d|>8 (the repo's established
motion/displacement threshold), plus an optional ROI subset (x0 y0 x1 y1
in pixel coords, origin top-left). Exit code 0 if frames are effectively
identical (<0.01% pixels >8), 1 otherwise — lets shell gates branch.
"""
import sys
import numpy as np
from PIL import Image


def load(p):
    return np.asarray(Image.open(p).convert('RGB'), dtype=np.int16)


def main():
    a_path, b_path = sys.argv[1], sys.argv[2]
    a, b = load(a_path), load(b_path)
    if a.shape != b.shape:
        print(f"SHAPE MISMATCH {a.shape} vs {b.shape}")
        sys.exit(2)
    d = np.abs(a - b).max(axis=2)
    roi = None
    if len(sys.argv) > 3:
        x0, y0, x1, y1 = (int(v) for v in sys.argv[3].split(','))
        roi = (y0, y1, x0, x1)
        d = d[roi]
    moved = float((d > 8).mean() * 100)
    print(f"{a_path.split('/')[-1]} vs {b_path.split('/')[-1]}"
          f"{' ROI' + sys.argv[3] if roi else ' full'}: "
          f"mean|d|={d.mean():.2f} p99={np.percentile(d, 99):.0f} "
          f"moved>8={moved:.3f}%")
    sys.exit(0 if moved < 0.01 else 1)


if __name__ == '__main__':
    main()
