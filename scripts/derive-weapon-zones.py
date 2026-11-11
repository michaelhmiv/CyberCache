#!/usr/bin/env python3
"""Zone-authoring pass for the weapon painting renderer slice
(INT-1 follow-on, 2026-11-11): classify each weapon-base painting's
palette entries into glow / not-glow following Wave 2's zone-proof
method (HSV clustering on palette entries, per base), so the runtime
element overlay can re-light the painting's element seat by palette
swap alone (body and trim stay byte-identical by construction).

The classification parameters are AUTHORED PER BASE below — tuned
against mask-overlay sheets (output of --masks) until each mask hugs
the base's chamber window / element channel and nothing else. The
glow clauses in the Wave 2 NOTES name each type's zone (chamber
window; beam adds the exposed spine channel to the emitter).

Emits:
  src/lib/pixel/weaponPaintingZones.ts  (per stem: zone palette
    indices + per-element swap tables, relative-luminance ramp
    core->accent, the zone proof's own operation)
  a JSON report (stdout with --report) with per-base glow shares.

Elements (src/constants/visualAssets.ts ELEMENT_VISUALS, verified
against the Wave 2 NOTES table): core / accent per element.
"""
import colorsys
import json
import os
import sys
from collections import Counter

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
SPRITES = os.path.join(ROOT, "src", "assets", "pixel", "sprites")

ELEMENTS = {
    "Kinetic": ((0xB8, 0xB0, 0xA8), (0xF5, 0xF5, 0xF5)),
    "Fire": ((0xFF, 0x4B, 0x1F), (0xFF, 0xEA, 0x3A)),
    "Shock": ((0x3B, 0x82, 0xF6), (0xA5, 0xF3, 0xFC)),
    "Corrosive": ((0x22, 0xC5, 0x5E), (0xC4, 0xFF, 0x2F)),
    "Cryo": ((0x06, 0xB6, 0xD4), (0xE0, 0xF2, 0xFE)),
    "Void": ((0x8B, 0x5C, 0xF6), (0xFF, 0x9D, 0xF5)),
}

# Per-maker rule templates: dict of HSV gates (hue in degrees,
# sat/val 0..1, alpha 0..255). A rule may carry a `rect`
# (x0, y0, x1, y1 as fractions of the sprite) restricting the zone
# spatially — the documented hard cases (Wave 2 NOTES caveat 6):
# chambers whose hue equals a body/trim family are separated by
# value INSIDE the authored window rect, and the runtime gates the
# swap to the rect so shared entries elsewhere never re-light.
MAKER_RULES = {
    # cyan chamber window on a red body — hue alone separates.
    "redline": {"hue": (172, 208), "sat": (0.45, None), "val": (0.42, None), "alpha": 8},
    # bright green chamber window on a wood body (wood hues 20-35).
    "ironwood": {"hue": (105, 172), "sat": (0.38, None), "val": (0.38, None), "alpha": 8},
    # yellow glow window on an orange body (body hues 18-38);
    # value separation per NOTES caveat 6.
    "blast-forge": {"hue": (40, 64), "sat": (0.42, None), "val": (0.74, None), "alpha": 8},
    # pink crystal glow on a violet body (body hues 255-285): the
    # saturated band catches the chamber core, the pale band the
    # grown-crystal material (unioned in classify).
    "prismatek": {"hue": (292, 342), "sat": (0.22, None), "val": (0.42, None), "alpha": 8},
    # pale luminous window on a saturated cyan body; opaque entries
    # only — the silhouette's anti-aliased edge entries are
    # semi-transparent and stay out.
    "throw-tech": {"hue": (168, 208), "sat": (0.0, 0.38), "val": (0.86, None), "alpha": 200},
    # cyan channel/window on a blue body — the zone proof's own split
    # (glow 172-207 sat>0.45 val>0.55; body blues sit at 210-235).
    "helix-works": {"hue": (172, 207), "sat": (0.45, None), "val": (0.55, None), "alpha": 8},
}

# Extra bands unioned into the maker's rule for a whole maker.
MAKER_EXTRA_BANDS = {
    # Prismatek's pale crystal: near-white pinks crowning the
    # receiver and tipping the muzzle — the same grown-crystal
    # material as the chamber core, so it re-lights with the zone.
    # The crystals read pale LILAC (the body hue family at very low
    # saturation / very high value), so the band keys on those two.
    "prismatek": [{"hue": (255, 345), "sat": (0.0, 0.32), "val": (0.90, None), "alpha": 200}],
}

# Per-base overrides (stem -> rule) where the maker template misses.
BASE_OVERRIDES = {
    # NOTES caveat 6: smg-redline's chamber is trim yellow — value
    # separation inside the authored window rect.
    "smg-redline": {
        "hue": (42, 64), "sat": (0.50, None), "val": (0.72, None), "alpha": 8,
        "rect": (0.470, 0.290, 0.575, 0.480),
    },
    # NOTES caveat 6: shotgun-redline's chamber hue = body red —
    # the window's plasma core is far brighter than any body red;
    # value separation inside the authored window rect.
    "shotgun-redline": {
        "hue": (0, 32), "sat": (0.55, None), "val": (0.74, None), "alpha": 8,
        "rect": (0.385, 0.375, 0.490, 0.575),
    },
}

STEMS = [
    f"{t}-{m}"
    for t in ("pistol", "smg", "shotgun", "sniper", "launcher", "beam")
    for m in ("redline", "ironwood", "blast-forge", "prismatek", "throw-tech", "helix-works")
]


def maker_of(stem: str) -> str:
    return stem.split("-", 1)[1]


def _band_match(rule, hd, s, v, a):
    if a <= rule.get("alpha", 8):
        return False
    lo, hi = rule["hue"]
    # hue bands may wrap past 360 for reds
    hue_ok = (lo <= hd <= hi) if lo <= hi else (hd >= lo or hd <= hi)
    if not hue_ok:
        return False
    slo, shi = rule["sat"]
    if s < slo or (shi is not None and s > shi):
        return False
    vlo, vhi = rule["val"]
    if v < vlo or (vhi is not None and v > vhi):
        return False
    return True


def classify(stem: str):
    """Return (glow_indices set, palette list, counts Counter, size, rect).

    An entry is in the zone when it matches the maker's band (plus
    the maker's extra bands, unioned). For rect-gated bases the
    entry must ALSO light at least one pixel inside the rect.
    """
    path = os.path.join(SPRITES, f"weapon-base-{stem}.png")
    im = Image.open(path)
    assert im.mode == "P", f"{stem}: expected palette PNG, got {im.mode}"
    pal = im.getpalette()
    trans = im.info.get("transparency")
    counts = Counter(im.getdata())
    maker = maker_of(stem)
    rule = BASE_OVERRIDES.get(stem, MAKER_RULES[maker])
    bands = [rule] + MAKER_EXTRA_BANDS.get(maker, [])
    rect = rule.get("rect")
    w, h = im.size
    in_rect = None
    if rect:
        in_rect = set()
        px = im.load()
        x0, y0, x1, y1 = (int(rect[0] * w), int(rect[1] * h), int(rect[2] * w), int(rect[3] * h))
        for y in range(y0, y1):
            for x in range(x0, x1):
                in_rect.add(px[x, y])
    glow = set()
    for idx, _c in counts.items():
        r, g, b = pal[idx * 3 : idx * 3 + 3]
        a = trans[idx] if isinstance(trans, bytes) and idx < len(trans) else 255
        hh, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        if not any(_band_match(band, hh * 360, s, v, a) for band in bands):
            continue
        if in_rect is not None and idx not in in_rect:
            continue
        glow.add(idx)
    return glow, pal, counts, im.size, rect


def luminance(rgb):
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def swap_table(glow, pal, core, accent):
    entries = []
    for idx in glow:
        rgb = tuple(pal[idx * 3 : idx * 3 + 3])
        entries.append((idx, luminance(rgb)))
    if not entries:
        return {}
    lo = min(l for _i, l in entries)
    hi = max(l for _i, l in entries)
    table = {}
    for idx, lum in entries:
        t = 0.0 if hi <= lo else (lum - lo) / (hi - lo)
        table[idx] = tuple(
            round(core[ch] + (accent[ch] - core[ch]) * t) for ch in range(3)
        )
    return table


def masks(outdir: str):
    os.makedirs(outdir, exist_ok=True)
    W, H = 460, 150
    sheet = Image.new("RGB", (W * 6, H * 6), (16, 16, 20))
    from PIL import ImageDraw

    dr = ImageDraw.Draw(sheet)
    for n, stem in enumerate(STEMS):
        r, c = divmod(n, 6)
        glow, _pal, _counts, _size, rect = classify(stem)
        im = Image.open(os.path.join(SPRITES, f"weapon-base-{stem}.png")).convert("RGBA")
        px = Image.open(os.path.join(SPRITES, f"weapon-base-{stem}.png"))
        idx = px.load()
        w, h = px.size
        rx = None
        if rect:
            rx = (int(rect[0] * w), int(rect[1] * h), int(rect[2] * w), int(rect[3] * h))
        mask = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        mp = mask.load()
        src = im.load()
        for y in range(h):
            for x in range(w):
                in_zone = idx[x, y] in glow and src[x, y][3] > 8
                if in_zone and rx and not (rx[0] <= x < rx[2] and rx[1] <= y < rx[3]):
                    in_zone = False
                if in_zone:
                    mp[x, y] = (255, 40, 40, 255)
                elif src[x, y][3] > 8:
                    mp[x, y] = (40, 40, 48, 255)
        mask.thumbnail((W - 8, H - 22))
        sheet.paste(mask, (c * W + 4, r * H + 18), mask)
        dr.text((c * W + 6, r * H + 4), stem, fill=(255, 255, 120))
    path = os.path.join(outdir, "zone-masks.png")
    sheet.save(path)
    print(path)


def report():
    out = {}
    for stem in STEMS:
        glow, pal, counts, _size, _rect = classify(stem)
        total = sum(counts.values())
        glow_px = sum(counts[i] for i in glow)
        out[stem] = {
            "glowEntries": len(glow),
            "glowShareAll": round(glow_px / total, 4),
        }
    print(json.dumps(out, indent=1))


def emit_ts(path: str):
    lines = []
    lines.append("/**")
    lines.append(" * Weapon painting element zones (Top-Choice renderer slice,")
    lines.append(" * 2026-11-11) — GENERATED by scripts/derive-weapon-zones.py;")
    lines.append(" * do not edit by hand. Re-run the script instead.")
    lines.append(" *")
    lines.append(" * Per weapon base (type x manufacturer stem): the source")
    lines.append(" * RGBs of the painting's element GLOW ZONE — the chamber")
    lines.append(" * window (beam: window + exposed spine channel to the")
    lines.append(" * emitter) — classified per base by Wave 2's zone-proof")
    lines.append(" * method (HSV clustering on palette entries; the per-base")
    lines.append(" * parameters are authored in the script), plus, per")
    lines.append(" * element, the palette swap table that re-lights the zone:")
    lines.append(" * each glow entry remapped core->accent by its relative")
    lines.append(" * luminance (the zone proof's operation). Body and trim")
    lines.append(" * entries never appear in a table, so a swap leaves them")
    lines.append(" * byte-identical by construction.")
    lines.append(" */")
    lines.append('import type { Element } from "@/types/game";')
    lines.append('import { Element as ElementEnum } from "@/types/game";')
    lines.append("")
    lines.append("export interface WeaponPaintingZone {")
    lines.append("  /** Source RGBs (palette entries) forming the glow zone. */")
    lines.append("  glow: readonly [number, number, number][];")
    lines.append("  /** Per-element re-lighting: source RGB -> replacement RGB,")
    lines.append("   *  keyed \"r,g,b\". Only glow colors ever appear as keys. */")
    lines.append("  swaps: Partial<Record<Element, Record<string, [number, number, number]>>>;")
    lines.append("  /** Authored window rect (fractions of the sprite) for the")
    lines.append("   *  bases whose chamber hue equals a body/trim family: the")
    lines.append("   *  swap applies only inside the rect (Wave 2 NOTES caveat 6). */")
    lines.append("  rect?: readonly [number, number, number, number];")
    lines.append("}")
    lines.append("")
    lines.append("export const WEAPON_PAINTING_ZONES: Record<string, WeaponPaintingZone> = {")
    element_keys = list(ELEMENTS.keys())
    for stem in STEMS:
        glow, pal, _counts, _size, rect = classify(stem)
        glow_rgbs = sorted(tuple(pal[i * 3 : i * 3 + 3]) for i in glow)
        lines.append(f"  '{stem}': {{")
        lines.append(
            "    glow: ["
            + ", ".join(f"[{r}, {g}, {b}]" for r, g, b in glow_rgbs)
            + "],"
        )
        if rect:
            lines.append(f"    rect: [{rect[0]}, {rect[1]}, {rect[2]}, {rect[3]}],")
        lines.append("    swaps: {")
        for el in element_keys:
            core, accent = ELEMENTS[el]
            table = swap_table(glow, pal, core, accent)
            body = ", ".join(
                f'"{pal[i * 3]},{pal[i * 3 + 1]},{pal[i * 3 + 2]}": [{rgb[0]}, {rgb[1]}, {rgb[2]}]'
                for i, rgb in sorted(table.items())
            )
            lines.append(f"      [ElementEnum.{el}]: {{ {body} }},")
        lines.append("    },")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    with open(path, "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {path}")


if __name__ == "__main__":
    if "--masks" in sys.argv:
        masks(sys.argv[sys.argv.index("--masks") + 1])
    elif "--report" in sys.argv:
        report()
    else:
        emit_ts(os.path.join(ROOT, "src", "lib", "pixel", "weaponPaintingZones.ts"))
