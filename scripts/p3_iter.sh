#!/usr/bin/env bash
# Capture + measure one terrain_check framing (p3-5 iteration).
# Usage: p3_iter.sh <name> <query>
set -e
cd /home/z/my-project/juzu
node scripts/p3_shot_one.cjs terrain_check "p3_iter_$1" "$2" >/dev/null
python3 - "$1" <<'EOF'
import numpy as np, sys
from PIL import Image
name = sys.argv[1]
im = np.asarray(Image.open(f'shots/p3_iter_{name}.png').convert('RGB'), dtype=np.float32)
h, w, _ = im.shape
lum = 0.2126*im[...,0] + 0.7152*im[...,1] + 0.0722*im[...,2]
clip = (lum > 254.5).sum()/(h*w)*100
crush = (lum < 10).sum()/(h*w)*100
p50 = np.percentile(lum, 50)
verdict = 'PASS' if clip <= 2 and crush <= 10 else 'FAIL'
print(f'{name:22s} clip={clip:6.3f}%  crush={crush:6.2f}%  p50={p50:6.1f}  {verdict}')
EOF
