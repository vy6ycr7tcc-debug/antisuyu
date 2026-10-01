#!/bin/bash
# Phase 9 evidence curation: copy load-bearing captures from shots/ into
# docs/verification/phase-9/ with stable names, and freeze the audit output.
set -e
cd /home/z/my-project/juzu
D=docs/verification/phase-9
mkdir -p "$D"

# --- §8.3 gate rows (composed, shipped look) ---
cp shots/p9_gate_day.png           "$D/gate_day.png"
cp shots/p9_gate_dawn.png          "$D/gate_dawn.png"
cp shots/p9_gate_dusk.png          "$D/gate_dusk.png"
cp shots/p9_gate_night.png         "$D/gate_night.png"
cp shots/p9_gate_day_390.png       "$D/gate_day_390.png"
cp shots/p9_gate_dusk_390.png      "$D/gate_dusk_390.png"
cp shots/p9_gate_day_slope.png     "$D/gate_day_slope.png"
cp shots/p9_gate_dusk_slope.png    "$D/gate_dusk_slope.png"
cp shots/p9_gate_valley_day.png    "$D/gate_valley_day.png"
cp shots/p9_gate_valley_dawn.png   "$D/gate_valley_dawn.png"
cp shots/p9_gate_mc_day.png        "$D/gate_mc_day.png"
cp shots/p9_gate_mc_dawn_lt3.png   "$D/gate_mc_dawn_lt3.png"
cp shots/p9_gate_shadow_day.png    "$D/gate_shadow_day.png"

# --- A/B evidence ---
cp shots/p9_gate_dusk_rep.png      "$D/ab_determinism_rep.png"
cp shots/p9_lamp_on.png            "$D/ab_lamp_bloom_on.png"
cp shots/p9_lamp_off.png           "$D/ab_lamp_bloom_off.png"
cp shots/p9_grain_off_dusk.png     "$D/ab_grain_off_dusk.png"

# --- raw (tv=1) attribution rows ---
cp shots/p9_raw_day.png            "$D/raw_day.png"
cp shots/p9_raw_dawn.png           "$D/raw_dawn.png"
cp shots/p9_raw_dusk.png           "$D/raw_dusk.png"
cp shots/p9_raw_night.png          "$D/raw_night.png"

# --- pre-fix (old linear-referred grade) vs post-fix composed ---
cp shots/p9_base_day.png           "$D/prefix_day.png"
cp shots/p9_base_dusk.png          "$D/prefix_dusk.png"
cp shots/p9_base_dawn.png          "$D/prefix_dawn.png"
cp shots/p9_base_night.png         "$D/prefix_night.png"

# --- stage-attribution A/Bs (day wash, dusk crush) ---
cp shots/p9_day_bt99.png           "$D/attr_day_bloom_off.png"
cp shots/p9_day_vs0.png            "$D/attr_day_vignette_off.png"
cp shots/p9_day_gs0.png            "$D/attr_day_grain_off.png"
cp shots/p9_day_raw.png            "$D/attr_day_post_off.png"
cp shots/p9_dusk_bt99.png          "$D/attr_dusk_bloom_off.png"
cp shots/p9_dusk_vs0.png           "$D/attr_dusk_vignette_off.png"
cp shots/p9_dusk_gs0.png           "$D/attr_dusk_grain_off.png"
cp shots/p9_dusk_raw.png           "$D/attr_dusk_post_off.png"

# --- vignette retune sweep (display-referred) ---
cp shots/p9_vs45_day.png           "$D/sweep_vs045_day.png"
cp shots/p9_vs35_day.png           "$D/sweep_vs035_day.png"
cp shots/p9_vs25_day.png           "$D/sweep_vs025_day.png"
cp shots/p9_vs25_dawn.png          "$D/sweep_vs025_dawn.png"
cp shots/p9_vs25_dusk.png          "$D/sweep_vs025_dusk.png"
cp shots/p9_vs25_night.png         "$D/sweep_vs025_night.png"

# --- bloom threshold sweep evidence (sky vs lamp separation analysis) ---
cp shots/p9_bt150_bs035_day.png    "$D/sweep_bt150_day.png"
cp shots/p9_bt200_bs035_day.png    "$D/sweep_bt200_day.png"
cp shots/p9_bt099_bs035_day.png    "$D/sweep_bt_off_day.png"

# --- mc_dawn config lesson (lt-less vs recorded lt=3.0) ---
cp shots/p9_gate_mc_dawn.png       "$D/lesson_mc_dawn_lt_missing.png"

# --- neutral-post pipeline verification (new chain ≈ raw) ---
cp shots/p9_neu_day.png            "$D/verify_neutral_post_day.png"

# --- audit outputs ---
python3 scripts/p9_gate_audit.py > "$D/gate_audit.txt" 2>&1 || true
echo "curated: $(ls "$D" | wc -l) files in $D"
