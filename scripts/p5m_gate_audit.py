#!/usr/bin/env python3
# P-MOBILE gate audit (docs/plans/phase-5-mobile-controls.md §P5.3).
# Part 1: functional gates from scripts/p5_results.json (written by
#          p5_mobile_play.cjs).
# Part 2: §8.3-style luminance gates on the world regression capture
#          (clip = luminance > 254.5 — NOT the >250 proxy, which counted
#          sun-side sky energy; crush = luminance < 10).
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, 'p5_results.json')
REGR = os.path.join(HERE, '..', 'docs', 'verification', 'phase-5', 'p5_world_regr_cf_day_390.png')

CLIP_GATE_PCT = 2.0   # §8.3 clipped whites (day, outside sun-disk rows)
CRUSH_GATE_PCT = 10.0  # §8.3 crushed blacks (outside night-exempt rows)


def audit_world_png(path: str):
    if not os.path.exists(path):
        return {'present': False}
    img = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    lum = 0.2126 * img[..., 0] + 0.7152 * img[..., 1] + 0.0722 * img[..., 2]
    total = lum.size
    clip_pct = float((lum > 254.5).sum() / total * 100.0)
    crush_pct = float((lum < 10).sum() / total * 100.0)
    chroma = float(img[..., 0].std() + img[..., 1].std() + img[..., 2].std())
    return {
        'present': True,
        'pixels': int(total),
        'clip_gt2545_pct': round(clip_pct, 3),
        'crush_lt10_pct': round(crush_pct, 3),
        'chroma_spread': round(chroma, 1),
        'clip_pass': clip_pct <= CLIP_GATE_PCT,
        'crush_pass': crush_pct <= CRUSH_GATE_PCT,
    }


def main() -> int:
    ok = True

    print('=== P-MOBILE functional gates (p5_results.json) ===')
    if not os.path.exists(RESULTS):
        print('MISSING results file — run scripts/p5_mobile_play.cjs first')
        return 1
    with open(RESULTS) as f:
        results = json.load(f)
    print(f"session: {results.get('viewport')}")
    for g in results['gates']:
        mark = 'PASS' if g['pass'] else 'FAIL'
        ok = ok and g['pass']
        print(f"  [{mark}] {g['name']}: {json.dumps(g['detail'])[:220]}")

    print('\n=== world regression (mobile viewport, §8.3 thresholds) ===')
    w = audit_world_png(REGR)
    print(' ', json.dumps(w))
    if w.get('present'):
        ok = ok and w['clip_pass'] and w['crush_pass']

    print('\nVERDICT:', 'ALL GATES PASS' if ok else 'GATE FAILURES PRESENT')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
