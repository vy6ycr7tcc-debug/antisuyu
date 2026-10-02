#!/usr/bin/env python3
"""P-CANON: measure the canon palette from the uploaded reference images.

Doctrine: every regrade value in the plan must cite a measurement from these
files, not an eyeball impression. Outputs docs/art-canon/canon-palette.json
(median/cluster colors per reference, in sRGB 0-255 + hex) and a contact
sheet PNG for PR review.
"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

SRC = "/home/z/my-project/upload"
OUT_DIR = "/home/z/my-project/juzu/docs/art-canon"

IMAGES = {
    "concept-valley": "concept-valley.jpeg",
    "concept-ruins": "concept-ruins.jpeg",
    "concept-character": "concept-character.jpeg",
    "environment-planks": "environment-planks.jpeg",
    "environment-stonework": "environment-stonework.jpeg",
    "environment-foliage": "environment-foliage.jpeg",
    "environment-forest-floor": "environment-forest-floor.jpeg",
    "environment-bark": "environment-bark.jpeg",
    "IMG_2493-ember-vfx": "IMG_2493.jpeg",
}

# Targeted crop boxes as (x0, y0, x1, y1) fractions — where each material reads
# most purely in its reference. Chosen by looking at each image, refined below.
CROPS = {
    "concept-valley": {
        "sky_fog_warm": (0.62, 0.02, 0.78, 0.12),
        "mountains_far": (0.40, 0.10, 0.55, 0.22),
        "foliage_lit": (0.80, 0.30, 0.92, 0.45),
        "foliage_shadow": (0.05, 0.35, 0.20, 0.50),
        "mist_mid": (0.55, 0.42, 0.70, 0.55),
        "river": (0.60, 0.80, 0.72, 0.92),
        "ruins_moss": (0.30, 0.32, 0.42, 0.42),
    },
    "concept-ruins": {
        "fog_cool": (0.35, 0.15, 0.55, 0.30),
        "stone_lit": (0.72, 0.45, 0.90, 0.65),
        "stone_shadow": (0.15, 0.50, 0.30, 0.68),
        "moss_joint": (0.78, 0.28, 0.90, 0.38),
        "torch_ember": (0.60, 0.50, 0.66, 0.60),
        "character_kit": (0.63, 0.58, 0.70, 0.80),
    },
    "concept-character": {
        "jacket": (0.42, 0.30, 0.50, 0.42),
        "harness_leather": (0.47, 0.38, 0.55, 0.48),
        "pants": (0.45, 0.58, 0.55, 0.75),
        "boots": (0.44, 0.82, 0.56, 0.92),
        "backdrop_wood": (0.02, 0.05, 0.15, 0.30),
    },
    "environment-planks": {
        "wood_silvered": (0.30, 0.15, 0.70, 0.45),
        "wood_dark_grain": (0.30, 0.55, 0.70, 0.80),
        "iron_strap": (0.065, 0.10, 0.095, 0.60),
        "rope": (0.30, 0.075, 0.70, 0.105),
    },
    "environment-stonework": {
        "stone_face": (0.55, 0.30, 0.95, 0.60),
        "stone_dark": (0.05, 0.05, 0.35, 0.35),
        "joint_moss": (0.40, 0.36, 0.52, 0.44),
    },
    "environment-foliage": {
        "leaf_dark": (0.60, 0.55, 0.95, 0.85),
        "leaf_medium": (0.05, 0.35, 0.40, 0.65),
        "leaf_light": (0.38, 0.32, 0.52, 0.44),
        "moss_under": (0.15, 0.70, 0.35, 0.90),
    },
    "environment-forest-floor": {
        "humus": (0.35, 0.55, 0.65, 0.85),
        "moss_clump": (0.25, 0.28, 0.45, 0.48),
        "litter_dry": (0.03, 0.25, 0.20, 0.45),
        "pebbles": (0.55, 0.20, 0.75, 0.38),
    },
    "environment-bark": {
        "bark_face": (0.55, 0.05, 0.95, 0.30),
        "bark_deep": (0.05, 0.60, 0.35, 0.90),
        "fissure_moss": (0.55, 0.15, 0.70, 0.28),
    },
    "IMG_2493-ember-vfx": {
        "spark_core": (0.48, 0.44, 0.56, 0.54),
        "spark_trail": (0.30, 0.35, 0.70, 0.65),
        "night_ground": (0.10, 0.80, 0.40, 0.98),
    },
}


def hexc(rgb):
    return "#{:02x}{:02x}{:02x}".format(*[int(round(c)) for c in rgb])


def crop_stats(im, box):
    """Median + mean + p10/p90 luminance of a crop, downsampled for speed."""
    w, h = im.size
    px = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
    px = px.convert("RGB").resize((min(px.width, 128), min(px.height, 128)))
    data = list(px.getdata())
    data.sort(key=lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
    n = len(data)
    med = data[n // 2]
    lum = [0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] for c in data]
    return {
        "median_rgb": list(med),
        "median_hex": hexc(med),
        "lum_p10": round(lum[n // 10], 1),
        "lum_p90": round(lum[9 * n // 10], 1),
        "n": n,
    }


def main():
    out = {"_doctrine": "All values measured from the reference files, not authored by eye.",
           "references": {}}
    sheet_cols = []
    for key, fname in IMAGES.items():
        path = os.path.join(SRC, fname)
        im = Image.open(path)
        entry = {"file": fname, "size": list(im.size), "regions": {}}
        for rname, box in CROPS[key].items():
            entry["regions"][rname] = crop_stats(im, box)
        out["references"][key] = entry
        sheet_cols.append((key, entry["regions"]))

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "canon-palette.json"), "w") as f:
        json.dump(out, f, indent=2)

    # Contact sheet: one row per image, swatches per region with hex labels.
    rows = len(sheet_cols)
    max_sw = max(len(r[1]) for r in sheet_cols)
    SW, RW, RH, PAD = 110, 190, 128, 8
    W = RW + max_sw * SW + PAD
    H = rows * RH + (rows + 1) * PAD
    sheet = Image.new("RGB", (W, H), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
        font_b = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 12)
    except Exception:
        font = font_b = None
    for i, (key, regions) in enumerate(sheet_cols):
        y = PAD + i * (RH + PAD)
        d.text((PAD, y + RH // 2 - 6), key, fill=(230, 230, 230), font=font_b)
        for j, (rname, st) in enumerate(regions.items()):
            x = RW + j * SW
            d.rectangle([x, y, x + SW - 4, y + RH - 26], fill=tuple(st["median_rgb"]))
            d.text((x, y + RH - 24), rname[:15], fill=(220, 220, 220), font=font)
            d.text((x, y + RH - 12), st["median_hex"] + f" L{int((st['lum_p10']+st['lum_p90'])/2)}",
                   fill=(160, 160, 160), font=font)
    sheet.save(os.path.join(OUT_DIR, "canon-palette-sheet.png"))
    print(json.dumps({k: {r: v["median_hex"] for r, v in e["regions"].items()}
                      for k, e in out["references"].items()}, indent=1))


if __name__ == "__main__":
    main()
