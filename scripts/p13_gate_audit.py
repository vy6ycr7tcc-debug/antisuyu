#!/usr/bin/env python3
"""P-FRESH (p13) gate audit.

Part 1 — P-CANON-5 character albedo-source audit (same discipline as
  p_canon2_gate_audit.py Part 2): every regraded character material in
  src/ must map into its concept-character canon band (canon-palette.json,
  Rec.709 luma, tolerance ±4).

Part 2 — spawn-site algebra audit: the shipped SPAWN_X/Z/THETA constants
  must land on measured-dry, flat ground outside the river mask, above the
  channel fill, and the old spawn must be (provably) wet for the record.

Part 3 — service-worker freshness audit on dist/sw.js: build-stamped cache
  version present; the permanent 'juzu-cache-v1' trap absent; navigation
  network-first; activate purges foreign juzu-* caches; no unsubstituted
  placeholders.
"""
import json
import math
import os
import re

ROOT = os.path.join(os.path.dirname(__file__), "..")

def luma_hex(h):
    h = h.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

# ---------------------------------------------------------------- Part 1
pal = json.load(open(os.path.join(ROOT, "docs", "art-canon", "canon-palette.json")))
cc = pal["references"]["concept-character"]["regions"]

SWATCHES = [
    ("jacket (clothField)    ", "clothField"),
    ("pants (clothFieldDark) ", "clothFieldDark"),
    ("harness (leatherDark)  ", "leatherDark"),
    ("boots (leatherBoot)    ", "leatherBoot"),
]

def factory_color(src: str, fn: str):
    """First `color: 0x…` inside the named exported factory's body (comments
    between the signature and the color literal are allowed)."""
    m = re.search(rf"export function {fn}\(\)[^{{]*\{{", src)
    if not m:
        return None
    body = src[m.end():]
    depth, end = 1, 0
    for i, ch in enumerate(body):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    c = re.search(r"color:\s*(0x[0-9a-fA-F]{6})", body[:end])
    return c.group(1) if c else None

results = []
ok_all = True
for label, fn in SWATCHES:
    src = open(os.path.join(ROOT, "src/materials.ts")).read()
    got_raw = factory_color(src, fn)
    if not got_raw:
        results.append(f"FAIL  {label} color literal not found in {fn}()")
        ok_all = False
        continue
    got = int(got_raw, 16)
    canon_hex = {
        "clothField": cc["jacket"],
        "clothFieldDark": cc["pants"],
        "leatherDark": cc["harness_leather"],
        "leatherBoot": cc["boots"],
    }[fn]["median_hex"]
    lg, lc = luma_hex(f"{got:06x}"), luma_hex(canon_hex)
    in_band = abs(lg - lc) <= 4
    ok_all &= in_band
    results.append(f"{'PASS' if in_band else 'FAIL'}  {label} albedo #{got:06x} luma {lg:6.1f} vs canon {canon_hex} {lc:6.1f} (±4)")

# ---------------------------------------------------------------- Part 2
def h(x, z):
    size = 1000
    valley = (abs(x / (size / 2)) ** 2) * 100
    noise = math.sin(x * 0.05) * math.cos(z * 0.05) * 5 + math.sin(x * 0.01 + z * 0.02) * 15
    bed = -math.exp(-((x / 30) ** 2)) * 10
    if z > 500:
        f = min(1.0, (z - 500) / 500)
        valley += f * 100
        noise += (math.sin(x * 0.1) * math.cos(z * 0.1) * 10 + math.sin(x * 0.05 + z * 0.05) * 20) * f
    return valley + noise + bed

main_src = open(os.path.join(ROOT, "src", "main.ts")).read()
msx = re.search(r"const SPAWN_X = (-?\d+);", main_src)
msz = re.search(r"const SPAWN_Z = (-?\d+);", main_src)
mst = re.search(r"const SPAWN_THETA = (Math\.PI|-?[\d.]+);", main_src)
if not (msx and msz and mst):
    results.append("FAIL  spawn constants not found in src/main.ts")
    ok_all = False
else:
    sx, sz = int(msx.group(1)), int(msz.group(1))
    theta_ok = mst.group(1) == "Math.PI"
    sy = h(sx, sz)
    wc = h(0, sz) + 6.0
    eps = 0.5
    slope = math.sqrt(((h(sx + eps, sz) - h(sx - eps, sz)) / (2 * eps)) ** 2 +
                      ((h(sx, sz + eps) - h(sx, sz - eps)) / (2 * eps)) ** 2)
    is_river = sy < -3.0 and abs(sx) < 15
    dry = (not is_river) and sy > -2
    bank = sy - wc
    checks = [
        ("spawn not river/SWIM", dry and bank >= 2.0),
        (f"bank above channel fill ({bank:.2f} m >= 2.0)", bank >= 2.0),
        (f"flat enough (slope {slope:.3f} <= 0.35)", slope <= 0.35),
        ("facing -z (theta=PI)", theta_ok),
        ("old spawn (0,0) is river bed for the record", h(0, 0) < -3 and abs(0) < 15),
    ]
    for name, ok in checks:
        ok_all &= ok
        results.append(f"{'PASS' if ok else 'FAIL'}  spawn ({sx},{sz}) {name}")

# ---------------------------------------------------------------- Part 3
sw = open(os.path.join(ROOT, "dist", "sw.js")).read()
sw_checks = [
    ("build-stamped version present", re.search(r"v-\d{10,}", sw) is not None),
    ("no unsubstituted __SW_VERSION__", "__SW_VERSION__" not in sw),
    ("precache ARRAY placeholder substituted (asset list injected)",
     re.search(r"\[\s*[`'\"]__PRECACHE_ASSETS__[`'\"]\s*\]", sw) is None and '"/juzu/assets/' in sw),
    ("old trap cache name 'juzu-cache-v1' ABSENT", "juzu-cache-v1" not in sw),
    ("activate purges foreign juzu-* caches", "startsWith(`juzu-`)" in sw or 'startsWith("juzu-")' in sw),
    ("navigation requests handled (network-first)", "`navigate`" in sw or '"navigate"' in sw),
    ("hashed-asset cache-first branch present", "/juzu/assets/" in sw),
]
for name, ok in sw_checks:
    ok_all &= ok
    results.append(f"{'PASS' if ok else 'FAIL'}  sw.js {name}")

print("\n".join(results))
print("OVERALL", "PASS" if ok_all else "FAIL")
raise SystemExit(0 if ok_all else 1)
