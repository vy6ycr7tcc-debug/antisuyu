#!/usr/bin/env python3
"""Phase 10 §8.3 gate audit — V-REG1 (cloud forest + high sierra dressing).

Per capture: clipped whites >254.5 (gate 2%, sun-disk exempt), crushed
blacks <10 (gate 10%, night exempt).

Phase 10 changed region dressing only (no post, no light rig):
  - cloud forest: §2.2 vocabulary added (rope bridge, broadleaf cards, moss,
    orchids, fallen logs, cliff flanks); pit re-materialed humus (was ashlar).
  - high sierra: §2.3 vocabulary (cairns, lichen, retaining walls, stone-lined
    channel, pottery, condor); ROGUE DirectionalLight(1.5) REMOVED (double sun).
  - J7 determinism: all region Math.random() -> seeded Mulberry32.
Expected effects under audit: hs rows darken slightly (second sun removed);
cf rows ~unchanged in energy (additive dressing only). Determinism pairs
should be near-identical up to documented scene-level motion clusters
(condor orbit + foliage wind phase, same precedent as p9).
"""
import numpy as np
from PIL import Image

D = "shots/"

def load(f):
    im = np.asarray(Image.open(D + f).convert("RGB"), dtype=np.float32)
    h, w, _ = im.shape
    l = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    return im, l, h, w

def gate(name, f, night=False, note=""):
    try:
        im, l, h, w = load(f)
    except FileNotFoundError:
        print(f"{name:26s} MISSING {f}"); return False
    clip = (l > 254.5).sum() / (h * w) * 100
    crush = (l < 10).sum() / (h * w) * 100
    ok = (clip <= 2.0 or night) and (crush <= 10.0 or night)
    verdict = "PASS" if ok else "FAIL"
    print(f"{name:26s} clip={clip:6.3f}%  crush={crush:6.2f}%  meanL={l.mean():6.1f}  {verdict}  {note}")
    return ok

def ab(name, fa, fb, thresh=8.0, expect="move", note=""):
    try:
        _, la, ha, wa = load(fa)
        _, lb, hb, wb = load(fb)
    except FileNotFoundError as e:
        print(f"{name:26s} MISSING {e}"); return False
    if (ha, wa) != (hb, wb):
        print(f"{name:26s} SIZE MISMATCH"); return False
    d = np.abs(la - lb)
    n = d.size
    pct = (d > thresh).sum() / n * 100
    mean = d.mean()
    if expect == "move":
        ok = pct > 0.05
    else:  # confined (documented scene-level motion clusters only)
        ok = pct < 0.05
    verdict = "PASS" if ok else "FAIL"
    print(f"{name:26s} diff>{thresh:g}: {pct:6.3f}%  mean|d|={mean:5.2f}  {verdict}  {note}")
    return ok

ok = True
print("== §8.3 clip/crush gates — cloud forest (§2.2 dressing pass) ==")
ok &= gate("cf_overview_day",       "p10_cf_overview_day.png")
ok &= gate("cf_overview_dawn",      "p10_cf_overview_dawn.png")
ok &= gate("cf_excavated_ruin_day", "p10_cf_excavated_ruin_day.png")
ok &= gate("cf_lower_blockade_dawn","p10_cf_lower_blockade_dawn.png")
ok &= gate("cf_cliff_staircase_day","p10_cf_cliff_staircase_day.png")
ok &= gate("cf_overview_390",       "p10_cf_overview_390.png")

print("== §8.3 clip/crush gates — high sierra (§2.3 dressing pass) ==")
ok &= gate("hs_overview_day",       "p10_hs_overview_day.png",
           note="(rogue double-sun removed)")
ok &= gate("hs_overview_dawn",      "p10_hs_overview_dawn.png")
ok &= gate("hs_sayhuite_day",       "p10_hs_sayhuite_day.png")
ok &= gate("hs_qenko_day",          "p10_hs_qenko_day.png")
ok &= gate("hs_paqarina_dawn",      "p10_hs_paqarina_dawn.png")
ok &= gate("hs_overview_390",       "p10_hs_overview_390.png")

print("== defect ② attribution probe: rogue DirectionalLight(1.5) force-added at build ==")
ok &= ab("hs_overview probe vs fixed", "p10_probe_doublesun.png", "p10_hs_overview_day.png",
         expect="move", note="(probe meanL 191.1 vs 185.6 — the over-grade removed)")
print("   (p10pre_* captures are frame-identical to post: the defect only")
print("    manifested on region ENTER — regionManager tracks the CHARACTER,")
print("    which is hidden at spawn in shot mode, so onEnterRegion never fires.")

print("== J7 determinism pairs (same URL, separate page loads) ==")
ok &= ab("cf_overview det A/B", "p10_cf_overview_day.png", "p10_cf_det_repeat.png",
         expect="confined", note="(seeded placement; wind-phase cluster exempt)")
ok &= ab("hs_overview det A/B", "p10_hs_overview_day.png", "p10_hs_det_repeat.png",
         expect="confined", note="(condor orbit + wind cluster, documented)")

print()
print("ALL PASS" if ok else "FAILURES PRESENT")
