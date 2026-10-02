#!/usr/bin/env python3
"""Phase 11 §8.3 gate audit — V-REG2 (jungle + Paititi dressing) + backlog.

Per capture: clipped whites >254.5 (gate 2%, sun-disk exempt), crushed
blacks <10 (gate 10%, night exempt).

Phase 11 changes under audit:
  - jungle: §2.4 vocabulary (buttress roots, lianas, half-buried carved
    blocks, foam edges on both black-water pools — was foamAtEdges:false),
    J7 seeded placement (build AND encounter loop);
  - Paititi: §2.5 plaza dais + colonnade ring + encroaching green rim,
    plazaWorn() paving, `as any` cast removed;
  - terrain: LOD T-junction chunk skirts (p3/p4/p5/p8-flagged);
  - materials.ts: RenderCaps duplicate declaration -> canonical re-export.
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
    else:  # confined (determinism)
        ok = pct < 0.05
    verdict = "PASS" if ok else "FAIL"
    print(f"{name:26s} diff>{thresh:g}: {pct:6.3f}%  mean|d|={mean:5.2f}  {verdict}  {note}")
    return ok

ok = True
print("== §8.3 clip/crush gates — jungle lowlands (§2.4 dressing pass) ==")
ok &= gate("jl_overview_day",       "p11_jl_overview_day.png")
ok &= gate("jl_overview_dawn",      "p11_jl_overview_dawn.png")
ok &= gate("jl_serpents_path_day",  "p11_jl_serpents_path_day.png")
ok &= gate("jl_trembling_day",      "p11_jl_trembling_day.png")
ok &= gate("jl_vanguard_dawn",      "p11_jl_vanguard_dawn.png")
ok &= gate("jl_overview_390",       "p11_jl_overview_390.png")

print("== §8.3 clip/crush gates — Paititi (§2.5 dressing pass) ==")
ok &= gate("pa_overview_day",       "p11_pa_overview_day.png")
ok &= gate("pa_overview_dawn",      "p11_pa_overview_dawn.png")
ok &= gate("pa_plaza_day",          "p11_pa_plaza_day.png",  note="(dais + colonnade added; heights re-anchored)")
ok &= gate("pa_terraces_day",       "p11_pa_terraces_day.png")
ok &= gate("pa_sanctuary_day",     "p11_pa_sanctuary_day.png", note="(shot re-anchored — was underground)")
ok &= gate("pa_aqueduct_day",       "p11_pa_aqueduct_day.png")
ok &= gate("pa_overview_390",       "p11_pa_overview_390.png")

print("== pre/post pairs (base vs p11) ==")
ok &= ab("pa_plaza pre->post",   "p11_pa_plaza_pre.png",    "p11_pa_plaza_day.png",
         expect="move", note="(pre = underground fog frame, defect F6 (underground shot table); post = re-anchored + dressing)")
ok &= ab("jl_serpents pre->post","p11_jl_serpents_pre.png", "p11_jl_serpents_path_day.png",
         expect="move", note="(roots + lianas + foam edges)")
ok &= ab("pa_overview pre->post","p11_pa_overview_pre.png", "p11_pa_overview_day.png",
         expect="move", note="(pre = underground fog frame; post = the city from the ridge)")

print("== J7 determinism pairs (same URL, separate page loads) ==")
ok &= ab("jl_overview det A/B",  "p11_jl_overview_day.png", "p11_jl_det_repeat.png",
         expect="confined", note="(seeded placement + seeded rockfall)")
ok &= ab("pa_overview det A/B",  "p11_pa_overview_day.png", "p11_pa_det_repeat.png",
         expect="confined", note="(paititi was already deterministic pre-p11)")

print()
print("ALL PASS" if ok else "FAILURES PRESENT")
