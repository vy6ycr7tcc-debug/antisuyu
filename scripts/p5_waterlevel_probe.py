#!/usr/bin/env python3
"""Phase 5 pre-implementation measurement: water-level solve prototype.

Replicates getGlobalTerrainHeight (terrain.ts) and prototypes the W(z)
water-level table for the river channel:
  W_raw(z)  = max bed elevation over the wetted band |x| <= 26 + FILL
  W(z)      = box-smoothed W_raw (+/- 24 m), floored at local max bed + CLEARANCE
Reports: water depth at centerline, waterline half-width (terrain==W contour),
max along-channel drop per 4 m step (cascade threshold check), bank clearance
at the plane edge (straight-cut risk).
"""
import math

def h(x, z):
    size = 1000.0
    valley = (abs(x) / (size / 2)) ** 2 * 100
    noise = math.sin(x * 0.05) * math.cos(z * 0.05) * 5 + math.sin(x * 0.01 + z * 0.02) * 15
    bed = -math.exp(-((x / 30) ** 2)) * 10
    if z > 500:
        f = min(1.0, (z - 500) / 500)
        valley += f * 100
        noise += (math.sin(x * 0.1) * math.cos(z * 0.1) * 10 + math.sin(x * 0.05 + z * 0.05) * 20) * f
    return valley + noise + bed

Z0, SPAN, STEP = -500.0, 1000.0, 4.0
N = int(SPAN / STEP) + 1
FILL, CLEAR = 2.2, 0.6

raw = []
for i in range(N):
    z = Z0 + i * STEP
    raw.append(max(h(x, z) for x in range(-26, 27, 2)) + FILL)

W = []
for i in range(N):
    lo, hi = max(0, i - 6), min(N - 1, i + 6)
    avg = sum(raw[lo:hi + 1]) / (hi - lo + 1)
    z = Z0 + i * STEP
    local_max_bed = max(h(x, z) for x in range(-26, 27, 2))
    W.append(max(avg, local_max_bed + CLEAR))

def waterline_halfwidth(z, level):
    # outermost |x| in channel where terrain < level (sampled fine)
    wl = 0.0
    x = 0.0
    while x <= 60:
        if h(x, z) < level:
            wl = x
        x += 0.5
    return wl

print(f"{'z':>5} {'bed(0)':>8} {'W(z)':>8} {'depth@0':>8} {'wlHW':>6} {'bank@40-W':>10} {'dW/4m':>7}")
max_drop = 0.0
min_bank_clear = 1e9
max_wl = 0.0
for i in range(0, N, 5):  # every 20 m
    z = Z0 + i * STEP
    level = W[i]
    bed0 = h(0.0, z)
    wl = waterline_halfwidth(z, level)
    bank40 = h(40.0, z) - level
    if i + 1 < N:
        drop = W[i] - W[i + 1]
        max_drop = max(max_drop, drop)
    min_bank_clear = min(min_bank_clear, bank40)
    max_wl = max(max_wl, wl)
    if i % 25 == 0:
        print(f"{z:5.0f} {bed0:8.2f} {level:8.2f} {level - bed0:8.2f} {wl:6.1f} {bank40:10.2f} {W[i] - W[i+1] if i+1 < N else 0:7.2f}")

print(f"\nmax drop over 4 m step: {max_drop:.2f} m (cascade threshold candidate: 1.6 m)")
print(f"max waterline half-width: {max_wl:.1f} m (plane half-width must exceed)")
print(f"min bank clearance at x=40: {min_bank_clear:.2f} m (negative => water reaches plane edge => shore fade covers)")
