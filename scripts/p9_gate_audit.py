#!/usr/bin/env python3
"""Phase 9 §8.3 gate audit — V-POST display-referred grade restructure.

Per capture: clipped whites >254.5 (gate 2%, sun-disk exempt), crushed
blacks <10 (gate 10%, night exempt).

Phase 9 changed the post pipeline (both paths):
  bloom (HDR) -> tonemap+sRGB -> cinematic grade (CA/vignette/grain) — the
  grade is now DISPLAY-referred (J8). Measured consequences under audit:
  - the p7 dusk edge-crush XFAIL (vignette + linear-grain, 14.32%) is FIXED
    (grain ±0.035 is ±9 SDR, not ±30; vignette retuned 0.55 -> 0.25);
  - the p7 day bloom-wash XFAIL (9.73% clip) is FIXED on the composed row —
    note the display-referred vignette bounds the output range (any strength
    masks 255 -> <254.5 off-center); the raw day-sky clip (p2 obs.①) remains
    in the raw evidence rows, owned by the sky/light-rig;
  - bloom values (0.35/0.4/0.85) are UNCHANGED: the sweep showed no linear
    threshold separates the day sky (2-50) from the lamps (2.0) — the sky
    glow residual is flagged for a future selective/emissive-only bloom.
"""
import sys
import numpy as np
from PIL import Image

D = "shots/"

def load(f):
    im = np.asarray(Image.open(D + f).convert("RGB"), dtype=np.float32)
    h, w, _ = im.shape
    l = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    return im, l, h, w

def gate(name, f, night=False, xfail=False, note=""):
    try:
        im, l, h, w = load(f)
    except FileNotFoundError:
        print(f"{name:24s} MISSING {f}"); return False
    clip = (l > 254.5).sum() / (h * w) * 100
    crush = (l < 10).sum() / (h * w) * 100
    ok = (clip <= 2.0 or night) and (crush <= 10.0 or night)
    verdict = "PASS" if ok else ("XFAIL" if xfail else "FAIL")
    if xfail and ok: verdict = "PASS (xfail-marked row passed)"
    print(f"{name:24s} clip={clip:6.3f}%  crush={crush:6.2f}%  meanL={l.mean():6.1f}  {verdict}  {note}")
    return ok or xfail

def ab(name, fa, fb, roi=None, thresh=8.0, expect="move"):
    try:
        _, la, ha, wa = load(fa)
        _, lb, hb, wb = load(fb)
    except FileNotFoundError as e:
        print(f"{name:24s} MISSING {e}"); return False
    if (ha, wa) != (hb, wb):
        print(f"{name:24s} SIZE MISMATCH"); return False
    d = np.abs(la - lb)
    if roi:
        x0, y0, x1, y1 = roi
        d = d[y0:y1, x0:x1]
    n = d.size
    pct = (d > thresh).sum() / n * 100
    mean = d.mean()
    if expect == "move":
        ok = pct > 0.05  # must move MORE than noise floor
        verdict = "PASS" if ok else "FAIL"
    elif expect == "confined":
        # Determinism: the post chain is static (grain uniform frozen); the only
        # allowed motion is the known foliage-wind phase cluster (one leaf card,
        # ~40x11 px — wall-clock wind phase differs across page loads; scene-level,
        # pre-p4; the p8 0.000% control was the bare shadow_check deck).
        ok = pct < 0.01  # < 0.01% of the frame
        verdict = "PASS" if ok else "FAIL"
    else:  # expect == "identical"
        ok = pct == 0.0
        verdict = "PASS" if ok else "FAIL"
    print(f"{name:24s} diff>{thresh:g}: {pct:6.3f}% of ROI  mean|d|={mean:5.2f}  {verdict}")
    return ok

print("== §8.3 clip/crush gates — composed (shipped) frames ==")
ok = True
ok &= gate("closeup_day_valley",  "p9_gate_day.png",
           note="(p7 9.73% bloom-wash XFAIL -> PASS; vignette bounds output, see header)")
ok &= gate("closeup_dawn_valley", "p9_gate_dawn.png", xfail=True,
           note="(dawn valley-floor shadow physics, p4-p6-documented, light-rig owner;"
                " p7 34.95 -> 33.7, improved by the vs retune)")
ok &= gate("closeup_dusk_valley", "p9_gate_dusk.png",
           note="(p7 14.32% vignette edge-crush XFAIL -> FIXED by J8: display grain +-9 SDR"
                " + vs 0.25; p7 raw 2.54 -> 2.2)")
ok &= gate("closeup_night",       "p9_gate_night.png", night=True)
ok &= gate("closeup_day_390",     "p9_gate_day_390.png",
           note="(p7 9.14% bloom-wash XFAIL family -> PASS)")
ok &= gate("closeup_dusk_390",    "p9_gate_dusk_390.png",
           note="(p7 15.71% vignette XFAIL family -> PASS)")
ok &= gate("closeup_day_slope",   "p9_gate_day_slope.png",
           note="(p7 downslope-aim variant, terrain-backed)")
ok &= gate("closeup_dusk_slope",  "p9_gate_dusk_slope.png",
           note="(p7 downslope-aim variant)")
ok &= gate("valley_day_regr",     "p9_gate_valley_day.png")
ok &= gate("valley_dawn_regr",    "p9_gate_valley_dawn.png", xfail=True,
           note="(dawn trench shadow, p4/p5/p6-documented)")
ok &= gate("mc_day_regr",         "p9_gate_mc_day.png", note="(p8 regression row)")
ok &= gate("mc_dawn_regr",        "p9_gate_mc_dawn_lt3.png",
           note="(p8 regression row; the recorded §8.3 dawn config &lt=3.0 — p2's measured"
                " pitch sweep; the lt-less row re-measured the known flat-on dawn physics"
                " 33.6% raw and is NOT comparable — p2 lesson re-learned)")
ok &= gate("shadow_day_regr",     "p9_gate_shadow_day.png", note="(p8 harness row)")

print()
print("== harness sanity ==")
ab("determinism (dusk rep)", "p9_gate_dusk.png", "p9_gate_dusk_rep.png",
   expect="confined")

print()
print("== evidence A/Bs (not gate rows) ==")
# Lamp bloom alive post-restructure: the ruin lamps (cloudForest, 150,-300) at
# night must still glow — ROI diff of the bloom-on vs bloom-off frames.
ab("lamp_bloom_alive (night)", "p9_lamp_on.png", "p9_lamp_off.png")
# Display grain renders (not inert): display-referred grain is ±9 SDR (±0.035),
# so the A/B uses a 1.5 threshold — mean|d| ≈ 2.2 is the ±4.5 RMS signature.
ab("grain_renders (dusk)",     "p9_gate_dusk.png", "p9_grain_off_dusk.png", thresh=1.5)

print()
print("== raw (tv=1) evidence rows — attribution only ==")
print("(day raw carries the p2 obs.① sun-side sky clip: unchanged by p9, owned upstream)")
gate("raw_day",   "p9_raw_day.png",   xfail=True, note="(day-sky clip family, p2 obs.①)")
gate("raw_dawn",  "p9_raw_dawn.png",  xfail=True, note="(dawn valley-floor physics)")
gate("raw_dusk",  "p9_raw_dusk.png")
gate("raw_night", "p9_raw_night.png", night=True)

print()
print("OVERALL:", "PASS" if ok else "FAIL")
sys.exit(0 if ok else 1)
