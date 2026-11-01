#!/usr/bin/env python3
"""CyberCache overhaul asset production (roaming-variance + visual overhaul).

Produces the derived pixel assets the overhaul needs from the shipped
art library — no new painting for anything the library already holds:

  1. Segmented rigs: the hunter sprite and the five roaming enemy
     sprites are cut into jointed segments (with overlap collars) that
     src/lib/pixel/rig.ts assembles and animates by transform.
  2. Hunter head variants (Q6 ruling): visor recolors + hood/optic
     repaints of the head segment.
  3. Death key poses: two toppled stills per archetype (the rig blends
     between them by transform — they are poses, not a frame sequence).
  4. Background layer re-cuts: each zone background split into
     far / mid / near bands for the parallax PixelStage.
  5. Procedural glyph sprites: event props, animated area props, arena
     props, on-character gear overlays, element status overlays,
     vehicle side profiles + affix/condition overlays, and the
     action-scene set pieces (bench, refinery, repair bay, dispatch,
     vendor stall, resurrection, war-room) — drawn as chunky pixel
     glyphs in each area's palette at 4x texel discipline.

Outputs land in src/assets/pixel/sprites/ and every produced sprite is
registered into src/assets/pixel/manifest.json with anchors computed
from its alpha mask (same convention as scripts/pixel-key.py) plus a
`pivot` anchor for rig segments.

Usage: python3 scripts/pixel-segments.py [--only section[,section...]]
Sections: rigs, heads, death, layers, glyphs, vehicles, sets, manifest
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SPRITES = ROOT / "src" / "assets" / "pixel" / "sprites"
MANIFEST = ROOT / "src" / "assets" / "pixel" / "manifest.json"

manifest_additions: dict[str, dict] = {}


def anchors_for(img: Image.Image, extra: dict | None = None) -> dict:
    """pixel-key.py anchor convention, computed from the alpha mask."""
    alpha = img.split()[3]
    w, h = img.size
    total = 0
    mx = my = 0.0
    # feet: centroid of the lowest opaque band
    rows = [y for y in range(h) if alpha.crop((0, y, w, y + 1)).getextrema()[1] > 12]
    feet_y = 1.0
    feet_x = 0.5
    if rows:
        band_top = max(rows) - max(2, h // 16)
        pts = [(x, y) for y in range(band_top, h) for x in range(w) if alpha.getpixel((x, y)) > 12]
        if pts:
            feet_x = sum(p[0] for p in pts) / len(pts) / max(1, w - 1)
            feet_y = 1.0
    top_pts = []
    for y in range(h):
        row_pts = [x for x in range(w) if alpha.getpixel((x, y)) > 12]
        if row_pts:
            top_pts = row_pts
            break
    for y in range(h):
        for x in range(w):
            if alpha.getpixel((x, y)) > 12:
                total += 1
                mx += x
                my += y
    anchors = {
        "feet": {"x": round(feet_x, 4), "y": feet_y},
        "centerMass": {
            "x": round((mx / total) / max(1, w - 1), 4) if total else 0.5,
            "y": round((my / total) / max(1, h - 1), 4) if total else 0.5,
        },
        "lootPoint": {
            "x": round((sum(top_pts) / len(top_pts)) / max(1, w - 1), 4) if top_pts else 0.5,
            "y": 0.0,
        },
        "grip": {"x": 0.27, "y": 0.66},
        "muzzle": {"x": 1.0, "y": 0.45},
    }
    if extra:
        anchors.update(extra)
    return anchors


def register(sprite_id: str, img: Image.Image, kind: str, extra_anchors: dict | None = None) -> None:
    manifest_additions[sprite_id] = {
        "src": f"sprites/{sprite_id}.png",
        "width": img.size[0],
        "height": img.size[1],
        "kind": kind,
        "anchors": anchors_for(img, extra_anchors),
    }


def save_sprite(sprite_id: str, img: Image.Image, kind: str, extra_anchors: dict | None = None) -> None:
    out = img
    # Pixel art survives a 192-color palette intact; photographic-detail
    # crops shrink 3-5x. Only quantize when the raw PNG would be heavy.
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    if buf.tell() > 60_000:
        out = img.quantize(colors=192, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    out.save(SPRITES / f"{sprite_id}.png", optimize=True)
    register(sprite_id, img, kind, extra_anchors)


def crop_masked(img: Image.Image, box: tuple[int, int, int, int], keep: Image.Image | None = None) -> Image.Image:
    """Crop a region; optionally zero alpha outside a keep-mask image."""
    seg = img.crop(box)
    if keep is not None:
        seg.putalpha(Image.composite(seg.split()[3], Image.new("L", seg.size, 0), keep))
    return seg


# ----------------------------------------------------------------------
# 1. Segmented rigs
# ----------------------------------------------------------------------

# Hunter frame is 260x320. Segment boxes carry deliberate overlap
# (collars) so joints never gap at the ±25° rotation envelope.
HUNTER_SEGMENTS = {
    # id: (box, pivot-in-segment-normalized) — boxes measured from the
    # shipped sprite's alpha profile (head x41-112, rifle band y96-143,
    # leg split at the x~68 alpha valley, knee line y~245).
    "rig-hunter-back": ((0, 44, 62, 152), (0.8, 0.4)),
    "rig-hunter-head": ((34, 0, 120, 88), (0.55, 0.9)),
    "rig-hunter-torso": ((24, 76, 148, 198), (0.45, 0.1)),
    "rig-hunter-arm-upper": ((84, 88, 152, 140), (0.16, 0.25)),
    "rig-hunter-arm-fore": ((130, 92, 222, 148), (0.08, 0.35)),
    "rig-hunter-arm-off": ((142, 112, 214, 156), (0.1, 0.3)),
    "rig-hunter-thigh-b": ((20, 178, 74, 252), (0.5, 0.06)),
    "rig-hunter-shin-b": ((16, 240, 74, 320), (0.5, 0.05)),
    "rig-hunter-thigh-f": ((62, 178, 120, 252), (0.5, 0.06)),
    "rig-hunter-shin-f": ((62, 240, 132, 320), (0.5, 0.05)),
}

# Enemy kits: band splits in normalized frame coords (x0, y0, x1, y1)
# per segment; the sprites vary too much for pixel boxes.
ENEMY_KITS = {
    "fodder": "enemy-fodder",
    "runner": "enemy-runner",
    "brute": "brute",
    "sniper": "enemy-sniper",
    "elite": "enemy-elite",
}
ENEMY_BANDS = {
    "head": (0.0, 0.0, 1.0, 0.26),
    "body": (0.0, 0.2, 1.0, 0.66),
    "arm": (0.34, 0.3, 1.0, 0.62),
    "base": (0.0, 0.6, 1.0, 1.0),
}
ENEMY_PIVOTS = {
    "head": (0.5, 0.88),
    "body": (0.5, 0.12),
    "arm": (0.1, 0.3),
    "base": (0.5, 0.06),
}


def build_rigs() -> None:
    hunter = Image.open(SPRITES / "hunter.png").convert("RGBA")
    for seg_id, (box, pivot) in HUNTER_SEGMENTS.items():
        seg = hunter.crop(box)
        save_sprite(seg_id, seg, "character", {"pivot": {"x": pivot[0], "y": pivot[1]}})
    for arch, src_id in ENEMY_KITS.items():
        src = Image.open(SPRITES / f"{src_id}.png").convert("RGBA")
        w, h = src.size
        for seg_name, (x0, y0, x1, y1) in ENEMY_BANDS.items():
            box = (int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))
            seg = src.crop(box)
            pivot = ENEMY_PIVOTS[seg_name]
            save_sprite(
                f"rig-{arch}-{seg_name}",
                seg,
                "enemy",
                {"pivot": {"x": pivot[0], "y": pivot[1]}},
            )


# ----------------------------------------------------------------------
# 2. Head variants (Q6): repaints of the head segment
# ----------------------------------------------------------------------

def shift_hue_region(img: Image.Image, box: tuple[int, int, int, int], fn) -> Image.Image:
    out = img.copy()
    region = out.crop(box)
    px = region.load()
    for y in range(region.size[1]):
        for x in range(region.size[0]):
            r, g, b, a = px[x, y]
            if a > 12:
                px[x, y] = fn(r, g, b) + (a,)
    out.paste(region, box[:2])
    return out


def build_heads() -> None:
    base = Image.open(SPRITES / "rig-hunter-head.png").convert("RGBA")
    # 'visor' is the shipped head itself (registered with the rig).
    # optic: cyan visor -> amber optic + a sensor nub on the crown.
    optic = shift_hue_region(base, (0, 0, base.size[0], base.size[1]),
                             lambda r, g, b: (255, 176, 32) if (g > 150 and b > 150) else (r, g, b))
    d = ImageDraw.Draw(optic)
    cx = int(base.size[0] * 0.52)
    d.rectangle([cx - 2, 0, cx + 2, 10], fill=(40, 44, 52, 255))
    d.rectangle([cx - 1, 0, cx + 1, 4], fill=(255, 209, 102, 255))
    save_sprite("hunter-head-optic", optic, "character", {"pivot": {"x": 0.5, "y": 0.9}})
    # hood: desert hood drape over the helm — sand tones + a cloth fall.
    hood = base.copy()
    d = ImageDraw.Draw(hood)
    w, h = hood.size
    sand = (176, 152, 106, 255)
    sand_d = (128, 106, 70, 255)
    d.polygon([(int(w * 0.18), int(h * 0.30)), (int(w * 0.30), int(h * 0.02)), (int(w * 0.74), int(h * 0.02)), (int(w * 0.86), int(h * 0.34)), (int(w * 0.78), int(h * 0.30)), (int(w * 0.70), int(h * 0.10)), (int(w * 0.36), int(h * 0.10)), (int(w * 0.28), int(h * 0.32))], fill=sand)
    d.polygon([(int(w * 0.14), int(h * 0.30)), (int(w * 0.30), int(h * 0.30)), (int(w * 0.26), int(h * 0.86)), (int(w * 0.12), int(h * 0.80))], fill=sand_d)
    d.polygon([(int(w * 0.74), int(h * 0.30)), (int(w * 0.88), int(h * 0.32)), (int(w * 0.90), int(h * 0.78)), (int(w * 0.78), int(h * 0.84))], fill=sand_d)
    # keep the visor visible through the hood opening
    visor = base.crop((int(w * 0.34), int(h * 0.30), int(w * 0.72), int(h * 0.52)))
    hood.paste(visor, (int(w * 0.34), int(h * 0.30)), visor)
    save_sprite("hunter-head-hood", hood, "character", {"pivot": {"x": 0.5, "y": 0.9}})
    # mohawk: scrap fin crest along the crown.
    fin = base.copy()
    d = ImageDraw.Draw(fin)
    rust = (178, 84, 40, 255)
    rust_d = (120, 52, 26, 255)
    cx = int(w * 0.5)
    for i in range(9):
        t = i / 8
        x = int(w * (0.30 + 0.40 * t))
        spike_h = int(h * (0.16 * math.sin(math.pi * (0.15 + 0.7 * t))))
        d.polygon([(x - 5, int(h * 0.10)), (x + 5, int(h * 0.10)), (x, int(h * 0.10) - spike_h)], fill=rust if i % 2 else rust_d)
    d.rectangle([cx - 3, int(h * 0.06), cx + 3, int(h * 0.12)], fill=rust_d)
    save_sprite("hunter-head-fin", fin, "character", {"pivot": {"x": 0.5, "y": 0.9}})
    # Manufacturer Standing (0043): the six rank-3 cosmetic heads —
    # the visor glass repainted in the maker's color plus a maker
    # stripe across the crown. Same repaint discipline as 'optic':
    # only the bright visor pixels (g > 150 and b > 150) take the new
    # color, so the helm's shading survives untouched.
    maker_colors = {
        "redline": (239, 68, 68),
        "ironwood": (34, 197, 94),
        "blastforge": (245, 158, 11),
        "prismatek": (168, 85, 247),
        "throwtech": (6, 182, 212),
        "helixworks": (59, 130, 246),
    }
    for slug, (mr, mg, mb) in maker_colors.items():
        mfr = shift_hue_region(base, (0, 0, base.size[0], base.size[1]),
                               lambda r, g, b, c=(mr, mg, mb): c if (g > 150 and b > 150) else (r, g, b))
        d = ImageDraw.Draw(mfr)
        w2, h2 = mfr.size
        d.rectangle([int(w2 * 0.30), int(h2 * 0.04), int(w2 * 0.70), int(h2 * 0.09)], fill=(mr, mg, mb, 255))
        d.rectangle([int(w2 * 0.30), int(h2 * 0.10), int(w2 * 0.70), int(h2 * 0.12)], fill=(24, 26, 32, 255))
        save_sprite(f"hunter-head-{slug}", mfr, "character", {"pivot": {"x": 0.5, "y": 0.9}})


# ----------------------------------------------------------------------
# 3. Death key poses
# ----------------------------------------------------------------------

def build_death() -> None:
    for arch, src_id in ENEMY_KITS.items():
        src = Image.open(SPRITES / f"{src_id}.png").convert("RGBA")
        for suffix, angle in (("a", -64), ("b", -86)):
            pose = src.rotate(angle, resample=Image.NEAREST, expand=True)
            bbox = pose.split()[3].getbbox()
            if bbox:
                pose = pose.crop(bbox)
            save_sprite(f"death-{arch}-{suffix}", pose, "enemy")


# ----------------------------------------------------------------------
# 4. Background layer re-cuts
# ----------------------------------------------------------------------

ZONES = {
    "dustwaste": "zone-dustwaste-bg",
    "redline": "zone-redline-bg",
    "ironwood": "zone-ironwood-bg",
    "blastforge": "zone-blastforge-bg",
    "prismatek": "zone-prismatek-bg",
    "throwtech": "zone-throwtech-bg",
    "helixworks": "zone-helixworks-bg",
}


def build_layers() -> None:
    for zone, src_id in ZONES.items():
        src = Image.open(SPRITES / f"{src_id}.jpg").convert("RGB")
        w, h = src.size
        far = src.crop((0, 0, w, int(h * 0.60)))
        far = ImageEnhance.Brightness(far).enhance(0.94)
        far = far.resize((720, int(far.size[1] * 720 / far.size[0])), Image.LANCZOS)
        far.save(SPRITES / f"zone-{zone}-far.jpg", quality=74)
        manifest_additions[f"zone-{zone}-far"] = {
            "src": f"sprites/zone-{zone}-far.jpg", "width": far.size[0], "height": far.size[1],
            "kind": "background", "anchors": {"centerMass": {"x": 0.5, "y": 0.5}, "groundLine": {"x": 0.5, "y": 1.0}},
        }
        mid = src.crop((0, int(h * 0.40), w, int(h * 0.84)))
        mid.save(SPRITES / f"zone-{zone}-mid.jpg", quality=78)
        manifest_additions[f"zone-{zone}-mid"] = {
            "src": f"sprites/zone-{zone}-mid.jpg", "width": mid.size[0], "height": mid.size[1],
            "kind": "background", "anchors": {"centerMass": {"x": 0.5, "y": 0.5}, "groundLine": {"x": 0.5, "y": 1.0}},
        }
        # Near band ships as JPG; the stage feathers its top edge with a
        # CSS mask / renderer gradient, keeping the art payload lean.
        near = src.crop((0, int(h * 0.72), w, h))
        near.save(SPRITES / f"zone-{zone}-near.jpg", quality=78)
        manifest_additions[f"zone-{zone}-near"] = {
            "src": f"sprites/zone-{zone}-near.jpg", "width": near.size[0], "height": near.size[1],
            "kind": "background", "anchors": {"centerMass": {"x": 0.5, "y": 0.5}, "groundLine": {"x": 0.5, "y": 1.0}},
        }


# ----------------------------------------------------------------------
# 5. Procedural glyph sprites (props, overlays, sets)
# ----------------------------------------------------------------------

AREA_COLORS = {
    "dustwaste": ((138, 107, 74), (217, 164, 65), (92, 70, 48)),
    "redline": ((110, 74, 58), (226, 72, 61), (62, 50, 48)),
    "ironwood": ((90, 70, 50), (127, 176, 105), (51, 64, 42)),
    "blastforge": ((74, 58, 52), (255, 122, 26), (42, 35, 32)),
    "prismatek": ((62, 74, 94), (57, 208, 216), (35, 44, 58)),
    "throwtech": ((78, 90, 82), (155, 225, 93), (46, 56, 51)),
    "helixworks": ((74, 68, 88), (177, 140, 255), (44, 40, 56)),
}


def glyph(w: int, h: int, scale: int = 4) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def finish_glyph(sprite_id: str, img: Image.Image, scale: int = 4, kind: str = "prop") -> None:
    big = img.resize((img.size[0] * scale, img.size[1] * scale), Image.NEAREST)
    save_sprite(sprite_id, big, kind)


def crate_glyph(d: ImageDraw.ImageDraw, box, base, accent, trim):
    x0, y0, x1, y1 = box
    d.rectangle([x0, y0, x1, y1], fill=base + (255,), outline=trim + (255,))
    d.line([x0, y0, x1, y1], fill=trim + (255,))
    d.line([x0, y1, x1, y0], fill=trim + (255,))
    d.rectangle([x0 + 2, y0 + 2, x0 + 5, y0 + 5], fill=accent + (255,))


def build_glyphs() -> None:
    # ---- event props (ids mirror src/content/roamingEvents.ts) ----
    def simple(sprite_id: str, zone: str, painter) -> None:
        base, accent, trim = AREA_COLORS[zone]
        img, d = glyph(16, 16)
        painter(d, base, accent, trim)
        finish_glyph(sprite_id, img)

    simple("prop-buried-cache", "dustwaste", lambda d, b, a, t: (crate_glyph(d, (3, 8, 13, 14), b, a, t), d.polygon([(1, 15), (5, 11), (11, 11), (15, 15)], fill=b + (255,))))
    simple("prop-convoy-wreck", "dustwaste", lambda d, b, a, t: (d.rectangle([2, 8, 10, 12], fill=b + (255,)), d.rectangle([10, 6, 14, 12], fill=t + (255,)), d.ellipse([3, 11, 6, 14], fill=t + (255,)), d.ellipse([10, 11, 13, 14], fill=t + (255,)), d.line([10, 6, 13, 3], fill=a + (255,))))
    simple("prop-storm-front", "dustwaste", lambda d, b, a, t: (d.arc([1, 2, 15, 14], 200, 340, fill=a + (255,)), d.arc([3, 5, 13, 15], 180, 360, fill=b + (255,)), d.line([2, 13, 14, 13], fill=t + (255,))))
    simple("prop-aid-marker", "dustwaste", lambda d, b, a, t: (d.rectangle([7, 2, 8, 14], fill=t + (255,)), d.rectangle([9, 3, 14, 7], fill=(232, 228, 216, 255)), d.rectangle([11, 4, 12, 6], fill=(200, 48, 48, 255)), d.rectangle([10, 5, 13, 5], fill=(200, 48, 48, 255))))
    simple("prop-pack-marker", "redline", lambda d, b, a, t: (d.polygon([(8, 1), (13, 8), (8, 15), (3, 8)], outline=a + (255,)), d.rectangle([7, 6, 9, 9], fill=a + (255,))))
    simple("prop-vent-stack", "redline", lambda d, b, a, t: (d.rectangle([5, 6, 11, 14], fill=b + (255,), outline=t + (255,)), d.rectangle([4, 4, 12, 6], fill=t + (255,)), d.arc([5, 0, 11, 5], 0, 180, fill=a + (160,))))
    simple("prop-streak-marker", "redline", lambda d, b, a, t: (d.line([1, 12, 9, 4], fill=a + (255,)), d.line([4, 13, 12, 5], fill=a + (200,)), d.line([7, 14, 15, 6], fill=a + (120,))))
    simple("prop-patrol-marker", "ironwood", lambda d, b, a, t: (d.rectangle([7, 2, 8, 14], fill=t + (255,)), d.polygon([(8, 2), (14, 4), (8, 6)], fill=a + (255,))))
    simple("prop-sentry-nest", "ironwood", lambda d, b, a, t: (d.polygon([(2, 14), (8, 5), (14, 14)], outline=b + (255,)), d.rectangle([6, 7, 10, 10], fill=t + (255,)), d.rectangle([7, 8, 8, 9], fill=a + (255,))))
    simple("prop-contract-marker", "ironwood", lambda d, b, a, t: (d.rectangle([4, 2, 12, 14], fill=(226, 218, 196, 255), outline=t + (255,)), d.line([6, 5, 10, 5], fill=t + (255,)), d.line([6, 8, 10, 8], fill=t + (255,)), d.rectangle([6, 11, 8, 12], fill=a + (255,))))
    simple("prop-break-marker", "blastforge", lambda d, b, a, t: (d.polygon([(8, 2), (12, 9), (9, 9), (11, 14), (4, 7), (7, 7)], fill=a + (255,))))
    simple("prop-slag-pocket", "blastforge", lambda d, b, a, t: (d.ellipse([2, 9, 14, 14], fill=t + (255,)), d.ellipse([4, 10, 12, 13], fill=a + (255,)), d.ellipse([6, 10, 9, 12], fill=(255, 209, 102, 255))))
    simple("prop-munitions-stack", "blastforge", lambda d, b, a, t: (d.rectangle([3, 9, 7, 14], fill=b + (255,)), d.rectangle([6, 7, 10, 14], fill=b + (255,)), d.rectangle([9, 9, 13, 14], fill=b + (255,)), d.rectangle([6, 5, 10, 7], fill=a + (255,))))
    simple("prop-coolant-rig", "blastforge", lambda d, b, a, t: (d.rectangle([5, 3, 11, 13], fill=b + (255,), outline=t + (255,)), d.rectangle([7, 5, 9, 10], fill=(140, 220, 255, 255)), d.line([8, 1, 8, 3], fill=a + (255,))))
    simple("prop-reactor-leak", "prismatek", lambda d, b, a, t: (d.rectangle([6, 2, 10, 9], fill=b + (255,), outline=t + (255,)), d.polygon([(7, 9), (9, 9), (10, 14), (6, 14)], fill=a + (200,)), d.ellipse([6, 12, 10, 15], fill=a + (120,))))
    simple("prop-anomaly-bloom", "prismatek", lambda d, b, a, t: (d.ellipse([5, 5, 11, 11], fill=a + (255,)), d.polygon([(8, 0), (9, 5), (7, 5)], fill=a + (200,)), d.polygon([(8, 16), (9, 11), (7, 11)], fill=a + (200,)), d.polygon([(0, 8), (5, 9), (5, 7)], fill=a + (200,)), d.polygon([(16, 8), (11, 9), (11, 7)], fill=a + (200,))))
    simple("prop-rift", "prismatek", lambda d, b, a, t: (d.polygon([(8, 0), (10, 6), (8, 9), (10, 16), (7, 10), (8, 6), (6, 2)], fill=a + (220,)), d.polygon([(8, 3), (9, 7), (8, 12)], fill=(240, 250, 255, 220))))
    simple("prop-resonance-pylon", "prismatek", lambda d, b, a, t: (d.rectangle([7, 5, 9, 15], fill=b + (255,), outline=t + (255,)), d.ellipse([5, 1, 11, 6], outline=a + (255,)), d.ellipse([3, 0, 13, 7], outline=a + (140,))))
    simple("prop-turret", "throwtech", lambda d, b, a, t: (d.rectangle([4, 10, 12, 14], fill=b + (255,)), d.rectangle([6, 6, 10, 10], fill=t + (255,)), d.rectangle([8, 4, 15, 6], fill=t + (255,)), d.rectangle([13, 4, 15, 5], fill=a + (255,))))
    simple("prop-drone-wreck", "throwtech", lambda d, b, a, t: (d.rectangle([5, 7, 11, 11], fill=b + (255,)), d.ellipse([2, 4, 6, 7], outline=t + (255,)), d.ellipse([10, 4, 14, 7], outline=t + (255,)), d.rectangle([7, 8, 9, 10], fill=a + (160,))))
    simple("prop-signal-spike", "throwtech", lambda d, b, a, t: (d.polygon([(7, 14), (9, 14), (8, 4)], fill=b + (255,)), d.arc([4, 0, 12, 7], 300, 60, fill=a + (255,)), d.arc([2, -1, 14, 9], 300, 60, fill=a + (140,))))
    simple("prop-minefield", "throwtech", lambda d, b, a, t: (d.ellipse([2, 10, 6, 14], fill=t + (255,)), d.ellipse([9, 10, 13, 14], fill=t + (255,)), d.rectangle([3, 10, 4, 11], fill=a + (255,)), d.rectangle([10, 10, 11, 11], fill=a + (255,)), d.line([0, 15, 15, 15], fill=b + (255,))))
    simple("prop-prototype-pod", "helixworks", lambda d, b, a, t: (d.rectangle([5, 2, 11, 14], fill=b + (160,), outline=a + (255,)), d.ellipse([7, 6, 9, 10], fill=a + (220,))))
    simple("prop-fusion-leak", "helixworks", lambda d, b, a, t: (d.rectangle([3, 6, 13, 9], fill=b + (255,)), d.ellipse([6, 4, 10, 11], fill=a + (200,)), d.ellipse([7, 11, 9, 15], fill=a + (120,))))
    simple("prop-wall-panel", "helixworks", lambda d, b, a, t: (d.rectangle([2, 2, 8, 14], fill=b + (255,), outline=t + (255,)), d.rectangle([9, 2, 14, 14], fill=t + (255,)), d.line([9, 8, 14, 8], fill=a + (255,))))
    simple("prop-specimen-tank", "helixworks", lambda d, b, a, t: (d.rectangle([5, 1, 11, 15], fill=b + (150,), outline=a + (255,)), d.ellipse([6, 5, 10, 9], fill=a + (180,)), d.ellipse([7, 11, 8, 12], fill=(240, 240, 255, 160))))
    # shared stage props
    simple("prop-cache-crate", "dustwaste", lambda d, b, a, t: crate_glyph(d, (3, 5, 13, 13), b, a, t))
    simple("prop-elite-banner", "redline", lambda d, b, a, t: (d.rectangle([7, 1, 8, 15], fill=t + (255,)), d.polygon([(8, 2), (15, 4), (8, 7)], fill=(200, 48, 48, 255)), d.rectangle([2, 13, 13, 14], fill=b + (255,))))
    simple("prop-hot-pennant", "blastforge", lambda d, b, a, t: (d.rectangle([3, 1, 4, 15], fill=t + (255,)), d.polygon([(4, 2), (14, 5), (4, 9)], fill=a + (255,))))

    # ---- animated area props (2 per area + 2 shared) ----
    def aprop(sprite_id: str, zone: str, painter) -> None:
        base, accent, trim = AREA_COLORS[zone]
        img, d = glyph(16, 16)
        painter(d, base, accent, trim)
        finish_glyph(sprite_id, img)

    aprop("aprop-dust-sheet", "dustwaste", lambda d, b, a, t: (d.ellipse([1, 6, 15, 12], fill=b + (110,)), d.ellipse([3, 5, 12, 10], fill=b + (80,))))
    aprop("aprop-tumbleweed", "dustwaste", lambda d, b, a, t: (d.ellipse([3, 3, 13, 13], outline=b + (255,)), d.line([4, 8, 12, 8], fill=b + (255,)), d.line([8, 4, 8, 12], fill=b + (255,)), d.line([5, 5, 11, 11], fill=b + (200,))))
    aprop("aprop-light-trail", "redline", lambda d, b, a, t: (d.line([0, 6, 15, 6], fill=a + (220,)), d.line([2, 9, 15, 9], fill=a + (110,)), d.line([5, 3, 15, 3], fill=a + (70,))))
    aprop("aprop-exhaust-plume", "redline", lambda d, b, a, t: (d.ellipse([2, 8, 8, 13], fill=b + (140,)), d.ellipse([6, 5, 13, 11], fill=b + (100,)), d.ellipse([9, 3, 15, 8], fill=b + (60,))))
    aprop("aprop-spore-mote", "ironwood", lambda d, b, a, t: (d.ellipse([3, 4, 5, 6], fill=a + (220,)), d.ellipse([10, 2, 12, 4], fill=a + (160,)), d.ellipse([7, 9, 9, 11], fill=a + (200,)), d.ellipse([12, 11, 14, 13], fill=a + (120,)), d.ellipse([2, 12, 3, 13], fill=a + (140,))))
    aprop("aprop-searchlight", "ironwood", lambda d, b, a, t: (d.polygon([(8, 15), (3, 0), (13, 0)], fill=(255, 240, 190, 60)), d.rectangle([6, 13, 10, 15], fill=t + (255,))))
    aprop("aprop-forge-glow", "blastforge", lambda d, b, a, t: (d.ellipse([2, 6, 14, 14], fill=a + (90,)), d.ellipse([5, 8, 11, 13], fill=a + (140,)), d.ellipse([6, 10, 10, 13], fill=(255, 209, 102, 200))))
    aprop("aprop-spark-fountain", "blastforge", lambda d, b, a, t: (d.ellipse([6, 2, 7, 3], fill=a + (255,)), d.ellipse([9, 1, 10, 2], fill=a + (255,)), d.ellipse([3, 4, 4, 5], fill=a + (200,)), d.ellipse([12, 5, 13, 6], fill=a + (200,)), d.ellipse([7, 6, 8, 8], fill=(255, 209, 102, 255)), d.rectangle([6, 12, 10, 14], fill=t + (255,))))
    aprop("aprop-prism-shard", "prismatek", lambda d, b, a, t: (d.polygon([(8, 1), (11, 8), (8, 15), (5, 8)], fill=a + (200,)), d.line([8, 1, 8, 15], fill=(240, 250, 255, 200))))
    aprop("aprop-core-glow", "prismatek", lambda d, b, a, t: (d.ellipse([3, 3, 13, 13], outline=a + (200,)), d.ellipse([6, 6, 10, 10], fill=a + (220,))))
    aprop("aprop-drone", "throwtech", lambda d, b, a, t: (d.rectangle([6, 7, 10, 10], fill=b + (255,)), d.ellipse([1, 4, 5, 7], outline=t + (255,)), d.ellipse([11, 4, 15, 7], outline=t + (255,)), d.ellipse([2, 11, 5, 13], outline=t + (255,)), d.ellipse([11, 11, 14, 13], outline=t + (255,)), d.rectangle([7, 8, 8, 9], fill=a + (255,))))
    aprop("aprop-signal-blink", "throwtech", lambda d, b, a, t: (d.rectangle([7, 6, 8, 15], fill=t + (255,)), d.ellipse([6, 2, 10, 6], fill=a + (255,)), d.arc([3, 0, 13, 9], 300, 60, fill=a + (150,))))
    aprop("aprop-compactor-jaw", "throwtech", lambda d, b, a, t: (d.rectangle([2, 1, 14, 5], fill=b + (255,)), d.polygon([(3, 5), (5, 5), (4, 8)], fill=t + (255,)), d.polygon([(7, 5), (9, 5), (8, 8)], fill=t + (255,)), d.polygon([(11, 5), (13, 5), (12, 8)], fill=t + (255,))))
    aprop("aprop-wall-panel-slide", "helixworks", lambda d, b, a, t: (d.rectangle([1, 2, 9, 14], fill=b + (255,), outline=t + (255,)), d.rectangle([10, 2, 15, 14], fill=t + (255,)), d.line([10, 8, 15, 8], fill=a + (255,))))
    aprop("aprop-pod-bubbles", "helixworks", lambda d, b, a, t: (d.ellipse([4, 9, 6, 11], outline=a + (220,)), d.ellipse([8, 5, 11, 8], outline=a + (180,)), d.ellipse([10, 11, 12, 13], outline=a + (140,)), d.ellipse([5, 2, 7, 4], outline=a + (120,))))
    aprop("aprop-holo-diagram", "helixworks", lambda d, b, a, t: (d.rectangle([2, 2, 14, 12], outline=a + (200,)), d.line([2, 7, 14, 7], fill=a + (120,)), d.line([8, 2, 8, 12], fill=a + (120,)), d.ellipse([6, 5, 10, 9], outline=a + (220,))))

    # ---- arena signature props (one per unique boss arena) ----
    aprop("arena-prop-monolith", "dustwaste", lambda d, b, a, t: (d.polygon([(6, 0), (11, 1), (10, 15), (5, 15)], fill=(196, 178, 128, 255)), d.line([7, 2, 9, 7], fill=a + (255,)), d.line([9, 7, 7, 12], fill=a + (255,))))
    aprop("arena-prop-skimmer-wreck", "dustwaste", lambda d, b, a, t: (d.polygon([(1, 10), (15, 8), (13, 12), (3, 13)], fill=b + (255,)), d.rectangle([6, 6, 10, 9], fill=t + (255,)), d.rectangle([12, 9, 13, 10], fill=a + (255,))))
    aprop("arena-prop-compactor-jaw", "throwtech", lambda d, b, a, t: (d.rectangle([1, 0, 15, 4], fill=b + (255,)), d.polygon([(2, 4), (4, 4), (3, 7)], fill=t + (255,)), d.polygon([(6, 4), (8, 4), (7, 7)], fill=t + (255,)), d.polygon([(10, 4), (12, 4), (11, 7)], fill=t + (255,)), d.polygon([(13, 4), (15, 4), (14, 7)], fill=t + (255,))))
    aprop("arena-prop-furnace-gate", "blastforge", lambda d, b, a, t: (d.rectangle([3, 1, 13, 15], fill=t + (255,)), d.rectangle([5, 4, 11, 15], fill=a + (200,)), d.rectangle([7, 6, 9, 15], fill=(255, 209, 102, 220))))
    aprop("arena-prop-toll-gantry", "redline", lambda d, b, a, t: (d.rectangle([1, 2, 2, 15], fill=t + (255,)), d.rectangle([14, 2, 15, 15], fill=t + (255,)), d.rectangle([1, 2, 15, 4], fill=b + (255,)), d.rectangle([7, 2, 9, 6], fill=a + (255,))))
    aprop("arena-prop-heartwood-gate", "ironwood", lambda d, b, a, t: (d.rectangle([2, 1, 5, 15], fill=b + (255,)), d.rectangle([11, 1, 14, 15], fill=b + (255,)), d.rectangle([2, 1, 14, 4], fill=b + (255,)), d.ellipse([6, 5, 10, 9], fill=a + (160,))))
    aprop("arena-prop-holo-dais", "helixworks", lambda d, b, a, t: (d.polygon([(3, 13), (13, 13), (11, 15), (5, 15)], fill=b + (255,)), d.ellipse([5, 3, 11, 9], outline=a + (220,)), d.ellipse([6, 4, 10, 8], outline=a + (140,))))
    # Boss roster expansion arenas (tiers 8-13): one signature prop each.
    aprop("arena-prop-web-anchor", "throwtech", lambda d, b, a, t: (d.rectangle([7, 5, 9, 15], fill=t + (255,)), d.polygon([(8, 0), (15, 6), (12, 7), (8, 3)], outline=a + (255,)), d.polygon([(8, 0), (1, 6), (4, 7), (8, 3)], outline=a + (200,)), d.line([8, 3, 8, 5], fill=a + (255,)), d.ellipse([7, 5, 9, 7], fill=a + (255,))))
    aprop("arena-prop-prism-spire", "prismatek", lambda d, b, a, t: (d.polygon([(8, 0), (11, 10), (8, 15), (5, 10)], fill=a + (190,)), d.line([8, 0, 8, 15], fill=(240, 250, 255, 220)), d.polygon([(5, 10), (11, 10), (13, 15), (3, 15)], fill=b + (255,))))
    aprop("arena-prop-dish-array", "redline", lambda d, b, a, t: (d.rectangle([7, 7, 8, 15], fill=t + (255,)), d.arc([2, 0, 14, 10], 300, 120, fill=b + (255,)), d.arc([4, 2, 12, 9], 300, 120, fill=a + (200,)), d.ellipse([7, 4, 9, 6], fill=a + (255,))))
    aprop("arena-prop-ember-heart", "ironwood", lambda d, b, a, t: (d.polygon([(8, 15), (3, 8), (5, 3), (8, 6), (11, 3), (13, 8)], fill=b + (255,), outline=t + (255,)), d.ellipse([6, 7, 10, 11], fill=(255, 122, 26, 255)), d.ellipse([7, 8, 9, 10], fill=(255, 209, 102, 255))))
    aprop("arena-prop-rift-shard", "helixworks", lambda d, b, a, t: (d.polygon([(8, 0), (10, 6), (8, 9), (10, 16), (7, 10), (8, 6), (6, 2)], fill=a + (230,)), d.polygon([(8, 3), (9, 7), (8, 12)], fill=(20, 8, 32, 255)), d.line([2, 13, 6, 11], fill=a + (140,)), d.line([10, 12, 14, 14], fill=a + (140,))))
    aprop("arena-prop-vault-wheel", "dustwaste", lambda d, b, a, t: (d.ellipse([3, 2, 13, 12], outline=(196, 178, 128, 255)), d.ellipse([6, 5, 10, 9], outline=a + (255,)), d.line([8, 2, 8, 12], fill=(196, 178, 128, 255)), d.line([3, 7, 13, 7], fill=(196, 178, 128, 255)), d.rectangle([5, 13, 11, 15], fill=t + (255,))))

    # ---- gear overlays: belt consumables + shield/relic/class-mod ----
    def belt(sprite_id: str, painter) -> None:
        img, d = glyph(12, 12)
        painter(d)
        finish_glyph(sprite_id, img)

    belt("belt-vial", lambda d: (d.rectangle([5, 3, 7, 10], fill=(120, 220, 140, 255)), d.rectangle([4, 2, 8, 3], fill=(200, 200, 210, 255))))
    belt("belt-cell", lambda d: (d.rectangle([4, 2, 8, 10], fill=(255, 176, 32, 255)), d.rectangle([5, 1, 7, 2], fill=(200, 200, 210, 255))))
    belt("belt-swarm", lambda d: (d.rectangle([3, 4, 9, 9], fill=(90, 96, 110, 255)), d.ellipse([4, 2, 6, 4], outline=(200, 200, 210, 255)), d.ellipse([7, 2, 9, 4], outline=(200, 200, 210, 255))))
    belt("belt-syringe", lambda d: (d.polygon([(3, 9), (8, 4), (9, 5), (4, 10)], fill=(232, 228, 216, 255)), d.line([8, 4, 10, 2], fill=(200, 200, 210, 255)), d.rectangle([5, 6, 6, 7], fill=(200, 48, 48, 255))))
    belt("belt-magazine", lambda d: (d.polygon([(4, 2), (8, 2), (7, 10), (4, 10)], fill=(70, 74, 84, 255)), d.rectangle([4, 4, 7, 5], fill=(255, 176, 32, 255))))
    belt("belt-rounds", lambda d: (d.rectangle([3, 5, 4, 9], fill=(255, 176, 32, 255)), d.rectangle([5, 5, 6, 9], fill=(255, 176, 32, 255)), d.rectangle([7, 5, 8, 9], fill=(255, 176, 32, 255)), d.rectangle([2, 9, 9, 10], fill=(96, 60, 32, 255))))
    belt("belt-grenade", lambda d: (d.ellipse([4, 4, 8, 10], fill=(84, 110, 70, 255)), d.rectangle([5, 2, 7, 4], fill=(200, 200, 210, 255)), d.rectangle([5, 6, 7, 7], fill=(60, 76, 48, 255))))
    belt("belt-scanner", lambda d: (d.rectangle([3, 3, 9, 8], fill=(40, 48, 60, 255)), d.rectangle([4, 4, 8, 7], fill=(57, 208, 216, 255)), d.line([9, 3, 11, 1], fill=(200, 200, 210, 255))))
    belt("belt-beacon", lambda d: (d.rectangle([5, 5, 7, 10], fill=(70, 74, 84, 255)), d.ellipse([4, 2, 8, 5], fill=(255, 84, 84, 255)), d.arc([2, 0, 10, 6], 300, 60, fill=(255, 84, 84, 160))))
    belt("belt-contract", lambda d: (d.rectangle([3, 2, 9, 10], fill=(226, 218, 196, 255)), d.line([4, 4, 8, 4], fill=(90, 80, 60, 255)), d.line([4, 6, 8, 6], fill=(90, 80, 60, 255))))
    belt("belt-ticket", lambda d: (d.rectangle([2, 4, 10, 8], fill=(240, 200, 90, 255)), d.line([7, 4, 7, 8], fill=(160, 120, 40, 255))))
    img, d = glyph(16, 16)
    d.arc([2, 2, 14, 14], 300, 120, fill=(120, 200, 255, 200), width=2)
    d.arc([4, 4, 12, 12], 300, 120, fill=(190, 230, 255, 160), width=1)
    finish_glyph("gear-shield-emitter", img)
    img, d = glyph(16, 16)
    d.ellipse([4, 4, 12, 12], outline=(255, 209, 102, 220), width=2)
    d.ellipse([6, 6, 10, 10], fill=(255, 176, 32, 200))
    finish_glyph("gear-relic-sigil", img)
    for tree, col in (("gunslinger", (226, 72, 61)), ("demolition", (255, 122, 26)), ("scavenger", (127, 176, 105))):
        img, d = glyph(14, 12)
        d.polygon([(2, 3), (12, 3), (11, 11), (3, 11)], fill=(70, 74, 84, 255))
        d.rectangle([2, 3, 12, 5], fill=col + (255,))
        d.rectangle([6, 7, 8, 9], fill=col + (255,))
        finish_glyph(f"gear-pauldron-{tree}", img)

    # ---- element status overlays ----
    def status(sprite_id: str, painter) -> None:
        img, d = glyph(16, 16)
        painter(d)
        finish_glyph(sprite_id, img)

    status("status-fire", lambda d: (d.polygon([(8, 1), (11, 8), (8, 13), (5, 8)], fill=(255, 122, 26, 220)), d.polygon([(8, 6), (9, 9), (8, 12), (7, 9)], fill=(255, 209, 102, 240))))
    status("status-shock", lambda d: d.polygon([(9, 0), (5, 8), (8, 8), (6, 15), (12, 6), (9, 6)], fill=(120, 220, 255, 230)))
    status("status-corrosive", lambda d: (d.ellipse([5, 2, 8, 6], fill=(155, 225, 93, 200)), d.ellipse([9, 7, 11, 12], fill=(155, 225, 93, 160)), d.ellipse([4, 10, 6, 14], fill=(155, 225, 93, 180))))
    status("status-cryo", lambda d: (d.polygon([(8, 1), (10, 6), (15, 8), (10, 10), (8, 15), (6, 10), (1, 8), (6, 6)], outline=(190, 235, 255, 230)), d.ellipse([7, 7, 9, 9], fill=(220, 245, 255, 230))))
    status("status-void", lambda d: (d.ellipse([3, 3, 13, 13], outline=(177, 140, 255, 220), width=2), d.ellipse([6, 6, 10, 10], fill=(30, 16, 48, 230))))
    status("status-kinetic", lambda d: (d.line([2, 3, 9, 8], fill=(232, 228, 216, 220)), d.line([5, 1, 12, 7], fill=(232, 228, 216, 160)), d.line([1, 9, 7, 13], fill=(232, 228, 216, 140))))


# ----------------------------------------------------------------------
# 6. Vehicles: class side profiles + affix + condition overlays
# ----------------------------------------------------------------------

def build_vehicles() -> None:
    def vehicle(sprite_id: str, painter) -> None:
        img, d = glyph(32, 16)
        painter(d)
        finish_glyph(sprite_id, img)

    def wheel(d, cx, cy, r=3):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(28, 28, 32, 255))
        d.ellipse([cx - 1, cy - 1, cx + 1, cy + 1], fill=(150, 154, 164, 255))

    vehicle("vehicle-scrap-bike", lambda d: (wheel(d, 6, 12), wheel(d, 26, 12), d.line([6, 12, 14, 7], fill=(150, 90, 50, 255)), d.line([14, 7, 24, 6], fill=(150, 90, 50, 255)), d.line([24, 6, 26, 12], fill=(110, 70, 40, 255)), d.rectangle([12, 5, 17, 7], fill=(60, 50, 44, 255))))
    vehicle("vehicle-dune-buggy", lambda d: (wheel(d, 7, 11, 4), wheel(d, 25, 11, 4), d.rectangle([4, 8, 28, 11], fill=(196, 120, 44, 255)), d.rectangle([10, 3, 22, 8], outline=(90, 84, 80, 255)), d.rectangle([13, 5, 19, 8], fill=(52, 60, 70, 255))))
    vehicle("vehicle-utility-rover", lambda d: (wheel(d, 8, 12), wheel(d, 24, 12), d.rectangle([3, 4, 29, 12], fill=(96, 110, 92, 255)), d.rectangle([20, 6, 27, 9], fill=(140, 200, 220, 255)), d.rectangle([5, 6, 12, 9], fill=(140, 200, 220, 200)), d.rectangle([4, 2, 16, 4], fill=(60, 64, 58, 255))))
    vehicle("vehicle-cargo-hauler", lambda d: (wheel(d, 6, 12), wheel(d, 16, 12), wheel(d, 27, 12), d.rectangle([2, 7, 30, 11], fill=(110, 84, 58, 255)), d.rectangle([22, 3, 30, 7], fill=(70, 74, 70, 255)), crate_glyph(d, (4, 2, 10, 7), (138, 107, 74), (217, 164, 65), (92, 70, 48)), crate_glyph(d, (11, 3, 17, 7), (120, 92, 62), (217, 164, 65), (80, 60, 40))))
    vehicle("vehicle-armored-crawler", lambda d: (d.rectangle([2, 9, 30, 13], fill=(40, 42, 46, 255)), d.ellipse([5, 10, 8, 12], fill=(120, 124, 132, 255)), d.ellipse([14, 10, 17, 12], fill=(120, 124, 132, 255)), d.ellipse([23, 10, 26, 12], fill=(120, 124, 132, 255)), d.polygon([(6, 9), (10, 4), (24, 4), (28, 9)], fill=(84, 92, 88, 255)), d.rectangle([14, 6, 20, 8], fill=(52, 58, 56, 255))))
    vehicle("vehicle-relay-skimmer", lambda d: (d.polygon([(3, 9), (29, 9), (25, 12), (7, 12)], fill=(88, 96, 120, 255)), d.polygon([(9, 9), (14, 5), (22, 5), (25, 9)], fill=(120, 140, 180, 255)), d.rectangle([15, 6, 21, 8], fill=(160, 230, 255, 255)), d.line([4, 14, 28, 14], fill=(57, 208, 216, 140))))
    img, d = glyph(32, 16)
    crate_glyph(d, (2, 1, 8, 6), (138, 107, 74), (217, 164, 65), (92, 70, 48))
    crate_glyph(d, (9, 2, 14, 6), (120, 92, 62), (217, 164, 65), (80, 60, 40))
    finish_glyph("vehicle-affix-cargo-rack", img)
    img, d = glyph(32, 16)
    d.rectangle([3, 6, 12, 10], fill=(105, 112, 118, 255), outline=(60, 64, 70, 255))
    d.rectangle([19, 6, 28, 10], fill=(105, 112, 118, 255), outline=(60, 64, 70, 255))
    finish_glyph("vehicle-affix-armor-plate", img)
    img, d = glyph(32, 16)
    d.rectangle([24, 2, 25, 9], fill=(90, 96, 104, 255))
    d.ellipse([21, 0, 28, 4], outline=(160, 230, 255, 255))
    d.rectangle([24, 1, 25, 2], fill=(255, 84, 84, 255))
    finish_glyph("vehicle-affix-scanner-array", img)
    img, d = glyph(32, 16)
    d.rectangle([2, 10, 30, 11], fill=(150, 154, 164, 255))
    d.rectangle([6, 8, 8, 12], fill=(120, 124, 132, 255))
    d.rectangle([24, 8, 26, 12], fill=(120, 124, 132, 255))
    finish_glyph("vehicle-affix-reinforced-frame", img)
    img, d = glyph(32, 16)
    for (x, y) in ((4, 8), (9, 10), (15, 7), (21, 10), (27, 8), (12, 12), (24, 12)):
        d.rectangle([x, y, x + 1, y + 1], fill=(30, 26, 24, 200))
    finish_glyph("vehicle-condition-scuff", img)
    img, d = glyph(32, 16)
    d.ellipse([12, 0, 20, 5], fill=(120, 120, 128, 120))
    d.ellipse([16, 2, 26, 7], fill=(120, 120, 128, 90))
    d.ellipse([20, 4, 30, 9], fill=(120, 120, 128, 60))
    finish_glyph("vehicle-condition-smoke", img)


# ----------------------------------------------------------------------
# 7. Action-scene set pieces (grammar G-5 sets for every system)
# ----------------------------------------------------------------------

def build_sets() -> None:
    def setpiece(sprite_id: str, w: int, h: int, painter) -> None:
        img, d = glyph(w, h)
        painter(d)
        finish_glyph(sprite_id, img, scale=3)

    wood = (120, 92, 62, 255)
    steel = (96, 102, 110, 255)
    dark = (44, 46, 52, 255)
    setpiece("set-bench-basic", 32, 20, lambda d: (d.rectangle([2, 12, 30, 14], fill=wood), d.rectangle([4, 14, 6, 19], fill=dark), d.rectangle([26, 14, 28, 19], fill=dark), d.rectangle([8, 8, 14, 12], fill=steel), d.rectangle([18, 10, 24, 12], fill=(70, 74, 84, 255))))
    setpiece("set-bench-forge", 32, 20, lambda d: (d.rectangle([2, 12, 30, 14], fill=(74, 58, 52, 255)), d.rectangle([12, 4, 20, 12], fill=dark), d.ellipse([14, 7, 18, 11], fill=(255, 122, 26, 255)), d.rectangle([4, 14, 6, 19], fill=dark), d.rectangle([26, 14, 28, 19], fill=dark)))
    setpiece("set-bench-lab", 32, 20, lambda d: (d.rectangle([2, 12, 30, 14], fill=(200, 204, 212, 255)), d.rectangle([8, 6, 11, 12], fill=(57, 208, 216, 200)), d.rectangle([20, 8, 23, 12], fill=(177, 140, 255, 200)), d.rectangle([4, 14, 6, 19], fill=steel), d.rectangle([26, 14, 28, 19], fill=steel)))
    setpiece("set-refinery-crusher", 32, 20, lambda d: (d.rectangle([10, 2, 22, 10], fill=steel), d.polygon([(12, 10), (15, 10), (13, 14)], fill=dark), d.polygon([(17, 10), (20, 10), (19, 14)], fill=dark), d.rectangle([6, 16, 26, 18], fill=wood)))
    setpiece("set-refinery-furnace", 32, 20, lambda d: (d.rectangle([10, 3, 22, 17], fill=(74, 58, 52, 255)), d.rectangle([13, 9, 19, 17], fill=(255, 122, 26, 220)), d.rectangle([14, 0, 18, 3], fill=dark)))
    setpiece("set-bay-lift", 32, 20, lambda d: (d.rectangle([3, 2, 5, 19], fill=steel), d.rectangle([27, 2, 29, 19], fill=steel), d.rectangle([3, 12, 29, 14], fill=(226, 72, 61, 255)), d.rectangle([10, 9, 22, 12], fill=dark)))
    setpiece("set-bay-tray", 32, 20, lambda d: (d.rectangle([6, 13, 26, 16], fill=steel), d.rectangle([9, 10, 12, 13], fill=(200, 200, 210, 255)), d.rectangle([15, 11, 19, 13], fill=(255, 176, 32, 255)), d.rectangle([21, 10, 24, 13], fill=(150, 90, 50, 255))))
    setpiece("set-bay-wall-listing", 32, 20, lambda d: (d.rectangle([4, 2, 28, 15], fill=(52, 56, 64, 255)), d.rectangle([6, 4, 14, 7], fill=(226, 218, 196, 255)), d.rectangle([17, 4, 26, 7], fill=(226, 218, 196, 255)), d.rectangle([6, 9, 14, 12], fill=(190, 196, 206, 255)), d.rectangle([17, 9, 26, 12], fill=(190, 196, 206, 255))))
    setpiece("set-dispatch-pad", 32, 20, lambda d: (d.ellipse([4, 10, 28, 18], outline=(57, 208, 216, 255)), d.ellipse([9, 12, 23, 17], outline=(57, 208, 216, 140)), d.rectangle([15, 4, 17, 10], fill=steel)))
    setpiece("set-dispatch-board", 32, 20, lambda d: (d.rectangle([5, 2, 27, 14], fill=(52, 56, 64, 255)), d.rectangle([7, 4, 15, 6], fill=(255, 176, 32, 255)), d.rectangle([7, 8, 20, 10], fill=(226, 218, 196, 255)), d.rectangle([17, 4, 25, 6], fill=(127, 176, 105, 255)), d.rectangle([13, 14, 19, 19], fill=wood)))
    setpiece("set-dispatch-route", 32, 20, lambda d: (d.line([3, 16, 12, 8], fill=(57, 208, 216, 200)), d.line([12, 8, 22, 12], fill=(57, 208, 216, 200)), d.line([22, 12, 29, 4], fill=(57, 208, 216, 200)), d.ellipse([2, 15, 4, 17], fill=(255, 209, 102, 255)), d.ellipse([28, 3, 30, 5], fill=(226, 72, 61, 255))))
    setpiece("set-vendor-stall", 32, 20, lambda d: (d.polygon([(2, 6), (30, 6), (26, 2), (6, 2)], fill=(178, 84, 40, 255)), d.rectangle([4, 6, 6, 19], fill=wood), d.rectangle([26, 6, 28, 19], fill=wood), d.rectangle([4, 13, 28, 15], fill=wood), d.rectangle([8, 10, 12, 13], fill=(127, 176, 105, 255)), d.rectangle([18, 10, 23, 13], fill=(255, 176, 32, 255))))
    setpiece("set-vendor-sign", 32, 20, lambda d: (d.rectangle([8, 3, 24, 10], fill=wood), d.rectangle([10, 5, 22, 6], fill=(255, 209, 102, 255)), d.rectangle([15, 10, 17, 19], fill=wood)))
    setpiece("set-resurrection-pod", 32, 20, lambda d: (d.rectangle([12, 1, 20, 19], fill=(52, 60, 70, 255)), d.rectangle([14, 4, 18, 14], fill=(57, 208, 216, 160)), d.ellipse([15, 6, 17, 9], fill=(240, 250, 255, 200))))
    setpiece("set-war-room-table", 32, 20, lambda d: (d.rectangle([3, 9, 29, 15], fill=(52, 56, 64, 255)), d.rectangle([5, 10, 27, 13], fill=(24, 40, 34, 255)), d.line([6, 12, 14, 10], fill=(127, 176, 105, 255)), d.line([14, 10, 24, 12], fill=(226, 72, 61, 255)), d.rectangle([6, 15, 8, 19], fill=dark), d.rectangle([24, 15, 26, 19], fill=dark)))
    # Extraction (0033): the claim line, the sift rig, the sorted crates.
    setpiece("set-extract-stakes", 32, 20, lambda d: (d.rectangle([3, 8, 5, 19], fill=wood), d.rectangle([27, 8, 29, 19], fill=wood), d.line([4, 9, 28, 9], fill=(255, 209, 102, 220)), d.polygon([(4, 9), (11, 11), (4, 13)], fill=(226, 72, 61, 255)), d.polygon([(28, 9), (21, 11), (28, 13)], fill=(226, 72, 61, 255)), d.rectangle([14, 10, 18, 12], fill=(255, 176, 32, 255))))
    setpiece("set-extract-rig", 32, 20, lambda d: (d.line([6, 19, 12, 6], fill=steel), d.line([26, 19, 20, 6], fill=steel), d.rectangle([8, 5, 24, 8], fill=dark), d.rectangle([10, 3, 22, 5], fill=(120, 84, 50, 255)), d.line([11, 6, 21, 6], fill=(190, 196, 206, 200)), d.line([13, 5, 13, 8], fill=(190, 196, 206, 160)), d.line([19, 5, 19, 8], fill=(190, 196, 206, 160)), d.rectangle([14, 12, 18, 15], fill=(255, 176, 32, 255)), d.ellipse([24, 1, 27, 4], fill=(255, 240, 180, 255)), d.rectangle([25, 4, 26, 6], fill=dark)))
    setpiece("set-extract-crates", 32, 20, lambda d: (d.rectangle([3, 12, 15, 19], fill=wood), d.rectangle([5, 14, 8, 17], fill=(127, 176, 105, 255)), d.rectangle([17, 12, 29, 19], fill=wood), d.rectangle([24, 14, 27, 17], fill=(57, 208, 216, 255)), d.rectangle([9, 5, 21, 12], fill=(96, 70, 44, 255)), d.rectangle([12, 7, 15, 10], fill=(255, 176, 32, 255)), d.line([3, 12, 15, 12], fill=dark), d.line([17, 12, 29, 12], fill=dark)))
    # Research (0038): the study terminal (screen glow, text lines,
    # chart tick, desk lamp) and the credential shelf (book spines,
    # one earned plaque with its seal — the shelf fills from the
    # player's completion records conceptually; v1 draws one).
    setpiece("set-research-terminal", 32, 20, lambda d: (d.rectangle([6, 13, 26, 15], fill=wood), d.rectangle([8, 15, 10, 19], fill=dark), d.rectangle([22, 15, 24, 19], fill=dark), d.rectangle([10, 3, 22, 13], fill=dark), d.rectangle([12, 5, 20, 10], fill=(20, 46, 40, 255)), d.line([13, 6, 19, 6], fill=(127, 176, 105, 255)), d.line([13, 8, 17, 8], fill=(57, 208, 216, 255)), d.line([13, 9, 20, 9], fill=(255, 176, 32, 255)), d.rectangle([14, 11, 18, 12], fill=(190, 196, 206, 255)), d.rectangle([24, 5, 25, 9], fill=(255, 209, 102, 255)), d.rectangle([24, 9, 26, 13], fill=steel)))
    setpiece("set-research-shelf", 32, 20, lambda d: (d.rectangle([3, 1, 5, 19], fill=wood), d.rectangle([27, 1, 29, 19], fill=wood), d.rectangle([3, 9, 29, 11], fill=wood), d.rectangle([3, 17, 29, 19], fill=wood), d.rectangle([7, 4, 9, 9], fill=(226, 72, 61, 255)), d.rectangle([10, 3, 12, 9], fill=(57, 208, 216, 255)), d.rectangle([13, 4, 15, 9], fill=(255, 176, 32, 255)), d.rectangle([20, 4, 24, 8], fill=(226, 218, 196, 255)), d.rectangle([21, 5, 23, 6], fill=(127, 176, 105, 255)), d.rectangle([7, 12, 10, 17], fill=(150, 90, 50, 255)), d.rectangle([12, 13, 15, 17], fill=(96, 102, 110, 255)), d.rectangle([19, 12, 22, 17], fill=(177, 140, 255, 255))))


def build_imports() -> None:
    """Register the media-generated sprites keyed by pixel-key.py."""
    sidecar = json.loads((SPRITES / "elite-silt-marshal.anchors.json").read_text())
    img = Image.open(SPRITES / "elite-silt-marshal.png")
    manifest_additions["elite-silt-marshal"] = {
        "src": "sprites/elite-silt-marshal.png", "width": img.size[0], "height": img.size[1],
        "kind": "enemy", "anchors": sidecar["anchors"],
    }
    for boss in ("dune-tyrant", "siltstalker", "heap-guard", "ashgut", "mirage-duster", "rust-prophet", "scrap-bishop"):
        img = Image.open(SPRITES / f"arena-{boss}.jpg")
        manifest_additions[f"arena-{boss}"] = {
            "src": f"sprites/arena-{boss}.jpg", "width": img.size[0], "height": img.size[1],
            "kind": "background",
            "anchors": {"centerMass": {"x": 0.5, "y": 0.5}, "groundLine": {"x": 0.5, "y": 0.86}},
        }
    # Boss roster expansion (tiers 8-13): bespoke boss sprites keyed by
    # pixel-key.py from magenta sources (art-source/), palette-quantized
    # to 192 colors per the heavy-sprite rule in save_sprite, plus their
    # unique arena backgrounds.
    for boss in ("spinneret-widow", "mnemosyne-mirror", "static-choir", "verdant-maw", "sister-null", "vaultkeeper-omega"):
        sidecar = json.loads((SPRITES / f"boss-{boss}.anchors.json").read_text())
        img = Image.open(SPRITES / f"boss-{boss}.png")
        manifest_additions[f"boss-{boss}"] = {
            "src": f"sprites/boss-{boss}.png", "width": img.size[0], "height": img.size[1],
            "kind": "enemy", "anchors": sidecar["anchors"],
        }
        img = Image.open(SPRITES / f"arena-{boss}.jpg")
        manifest_additions[f"arena-{boss}"] = {
            "src": f"sprites/arena-{boss}.jpg", "width": img.size[0], "height": img.size[1],
            "kind": "background",
            "anchors": {"centerMass": {"x": 0.5, "y": 0.5}, "groundLine": {"x": 0.5, "y": 0.86}},
        }


def build_goldenbg() -> None:
    """PNG twins of the JPG scene art for the pure-TS golden renderer
    (it decodes PNG only). Test fixtures — never shipped in the bundle
    (the manifest does not reference them)."""
    out_dir = ROOT / "src" / "test" / "golden" / "assets"
    out_dir.mkdir(parents=True, exist_ok=True)
    sources = [f"zone-{zone}-bg" for zone in ZONES] + [
        "arena-dune-tyrant", "arena-siltstalker", "arena-heap-guard", "arena-ashgut",
        "arena-mirage-duster", "arena-rust-prophet", "arena-scrap-bishop",
        "arena-spinneret-widow", "arena-mnemosyne-mirror", "arena-static-choir",
        "arena-verdant-maw", "arena-sister-null", "arena-vaultkeeper-omega",
    ]
    for sprite_id in sources:
        img = Image.open(SPRITES / f"{sprite_id}.jpg").convert("RGB")
        img = img.resize((480, int(img.size[1] * 480 / img.size[0])), Image.LANCZOS)
        img = img.quantize(colors=192, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        img.save(out_dir / f"{sprite_id}.png", optimize=True)
    print(f"goldenbg: {len(sources)} twins -> {out_dir}")


# ----------------------------------------------------------------------
# 10. Unarmed hunter rig variants (real-item invariant)
# ----------------------------------------------------------------------
# The shipped hunter art holds a rifle, and the segmented rig inherits
# it: the arm-fore crop IS mostly the rifle, the arm-upper / arm-off
# crops carry the receiver, and the torso crop keeps a gun patch at its
# top-right. An unequipped hunter therefore rendered a phantom rifle in
# every rig scene. These four variant segments paint the same hunter
# WITHOUT the weapon: the torso with its gun patch erased + row-
# inpainted from its own armor, and three hanging-arm segments ("hands
# at sides") painted in the shipped armor palette / shading language
# (navy ramp sampled from the shipped arm + shin segments). Existing
# sprites are NEVER touched — the equipped path stays bit-identical;
# the unarmed rig swaps only these four segments.

UNARMED_OUTLINE = (9, 11, 18, 255)
UNARMED_DARK = (13, 32, 64, 255)
UNARMED_BASE = (23, 48, 92, 255)
UNARMED_MID = (42, 76, 131, 255)
UNARMED_LIGHT = (78, 116, 174, 255)
UNARMED_CYAN = (64, 224, 255, 255)
UNARMED_GLOVE = (15, 17, 25, 255)
UNARMED_GLOVE_L = (40, 46, 62, 255)
UNARMED_FAR_DARK = (10, 24, 48, 255)
UNARMED_FAR_BASE = (17, 36, 69, 255)
UNARMED_FAR_GLOVE = (11, 13, 19, 255)


def _grow(pts, cx, cy, d):
    return [(x + (-d if x < cx else d if x > cx else 0),
             y + (-d if y < cy else d if y > cy else 0)) for x, y in pts]


def build_unarmed() -> None:
    hunter = Image.open(SPRITES / "hunter.png").convert("RGBA")

    # --- torso: erase the gun patch, inpaint from the row's own armor ---
    torso = hunter.crop((24, 76, 148, 198))
    tp = torso.load()
    # Gun patch in torso-local coords: the rifle receiver crosses the
    # whole chest (frame x ~88..148, y ~96..138 -> local x 64..124,
    # y 20..62), scope glow included — the blue-gray gunmetal is too
    # close to the armor navy for a color test, so the measured rect is
    # erased outright and each row is inpainted from the armor pixel at
    # its left edge (cyan accents never seed the smear, so the chest
    # light cannot streak).
    GX0, GY0, GX1, GY1 = 64, 20, 124, 62
    for y in range(GY0, GY1):
        last = None
        for x in range(GX0):
            r, g, b, a = tp[x, y]
            if a > 200 and not (g > 150 and b > 180):
                last = (r, g, b, a)
        # The gun WAS the silhouette out to the crop edge; the body
        # underneath slopes from the neck (~x96) over the shoulder
        # (~x112) and tapers to the waist (~x98) — the hanging arm
        # (frame x>=103) covers the seam.
        t = (y - GY0) / max(1, GY1 - GY0)
        edge = int(96 + t * 64) if t < 0.25 else int(112 - (t - 0.25) * 18.7)
        for x in range(GX0, GX1):
            if tp[x, y][3] == 0:
                continue
            if last is None or x > edge:
                tp[x, y] = (0, 0, 0, 0)
            elif x == edge:
                tp[x, y] = (last[0] // 2, last[1] // 2, last[2] // 2, 255)
            else:
                tp[x, y] = last
    save_sprite("rig-hunter-torso-unarmed", torso, "character", {"pivot": {"x": 0.45, "y": 0.1}})

    # --- near upper arm: shoulder pad + hanging sleeve (52x70) ---
    img = Image.new("RGBA", (52, 70), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    arm = [(11, 18), (31, 18), (28, 58), (14, 58)]
    d.polygon(_grow(arm, 21, 38, 1), fill=UNARMED_OUTLINE)
    d.polygon(arm, fill=UNARMED_BASE)
    d.polygon([(11, 18), (19, 18), (18, 58), (14, 58)], fill=UNARMED_DARK)
    d.rectangle((24, 20, 26, 56), fill=UNARMED_MID)
    d.polygon([(13, 52), (29, 52), (28, 58), (14, 58)], fill=UNARMED_DARK)
    d.ellipse((3, 1, 33, 24), fill=UNARMED_OUTLINE)
    d.ellipse((4, 2, 32, 23), fill=UNARMED_LIGHT)
    d.ellipse((4, 6, 32, 23), fill=UNARMED_MID)
    d.polygon([(8, 12), (28, 12), (27, 17), (10, 17)], fill=UNARMED_BASE)
    d.rectangle((21, 9, 28, 11), fill=UNARMED_CYAN)
    save_sprite("rig-hunter-arm-upper-unarmed", img, "character", {"pivot": {"x": 0.37, "y": 0.17}})

    # --- near forearm + glove: hangs to mid-thigh (48x76) ---
    img = Image.new("RGBA", (48, 76), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fore = [(13, 4), (31, 4), (29, 44), (15, 44)]
    d.polygon(_grow(fore, 22, 24, 1), fill=UNARMED_OUTLINE)
    d.polygon(fore, fill=UNARMED_BASE)
    d.polygon([(13, 4), (19, 4), (18, 44), (15, 44)], fill=UNARMED_DARK)
    d.rectangle((24, 6, 26, 42), fill=UNARMED_MID)
    d.rectangle((13, 38, 30, 46), fill=UNARMED_OUTLINE)
    d.rectangle((14, 39, 29, 45), fill=UNARMED_MID)
    d.rectangle((20, 41, 26, 43), fill=UNARMED_CYAN)
    d.rounded_rectangle((10, 44, 33, 68), radius=6, fill=UNARMED_OUTLINE)
    d.rounded_rectangle((11, 45, 32, 67), radius=5, fill=UNARMED_GLOVE)
    d.ellipse((12, 44, 20, 53), fill=UNARMED_GLOVE_L)
    d.ellipse((19, 43, 27, 52), fill=UNARMED_GLOVE_L)
    d.ellipse((25, 44, 32, 52), fill=UNARMED_GLOVE_L)
    d.ellipse((29, 52, 37, 61), fill=UNARMED_OUTLINE)
    d.ellipse((30, 53, 36, 60), fill=UNARMED_GLOVE)
    d.line((19, 54, 19, 63), fill=UNARMED_OUTLINE)
    d.line((25, 54, 25, 63), fill=UNARMED_OUTLINE)
    save_sprite("rig-hunter-arm-fore-unarmed", img, "character", {"pivot": {"x": 0.46, "y": 0.08}})

    # --- far forearm + hand: peeks below the torso hem (36x74) ---
    img = Image.new("RGBA", (36, 74), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    far = [(12, 2), (26, 2), (25, 52), (13, 52)]
    d.polygon(_grow(far, 19, 27, 1), fill=UNARMED_OUTLINE)
    d.polygon(far, fill=UNARMED_FAR_BASE)
    d.polygon([(12, 2), (17, 2), (17, 52), (13, 52)], fill=UNARMED_FAR_DARK)
    d.rounded_rectangle((10, 50, 28, 71), radius=5, fill=UNARMED_OUTLINE)
    d.rounded_rectangle((11, 51, 27, 70), radius=4, fill=UNARMED_FAR_GLOVE)
    d.line((19, 56, 19, 65), fill=UNARMED_OUTLINE)
    save_sprite("rig-hunter-arm-off-unarmed", img, "character", {"pivot": {"x": 0.5, "y": 0.05}})
    print("unarmed: 4 variant segments (gun-free torso + hands at sides)")


def write_manifest() -> None:
    data = json.loads(MANIFEST.read_text())
    data["sprites"].update(manifest_additions)
    # The hunter's pixel-key grip heuristic lands on the backpack mass;
    # the measured hand position on the rifle (alpha profile: hands at
    # x~143/260, y~118/320) is the anchor the held weapon aligns to.
    if "hunter" in data["sprites"]:
        data["sprites"]["hunter"]["anchors"]["grip"] = {"x": 0.55, "y": 0.37}
    MANIFEST.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True))
    print(f"manifest: {len(data['sprites'])} sprites total")


def build_shieldtech() -> None:
    """Shield-tech services (0044): the calibration rig set piece and
    the five behavior sigils. The rig is drawn neutral (steel + cyan
    emitter light) — the behavior COLOR enters the scene through the
    glyph sprite of the ACTUAL job shield's target behavior, never
    baked into the set piece (real-item invariant)."""
    def setpiece(sprite_id: str, w: int, h: int, painter) -> None:
        img, d = glyph(w, h)
        painter(d)
        finish_glyph(sprite_id, img, scale=3)

    steel = (96, 102, 110, 255)
    dark = (44, 46, 52, 255)
    cyan = (57, 208, 216, 255)
    pale = (240, 250, 255, 255)

    def rig(d):
        # Stand: base bar, two legs, a crossbar the shield floats over.
        d.rectangle([4, 18, 28, 19], fill=dark)
        d.line([8, 18, 13, 13], fill=steel)
        d.line([24, 18, 19, 13], fill=steel)
        d.rectangle([11, 12, 21, 13], fill=steel)
        # Emitter posts at the ring's sides, tips lit.
        d.rectangle([3, 6, 4, 12], fill=steel)
        d.rectangle([28, 6, 29, 12], fill=steel)
        d.rectangle([3, 5, 4, 6], fill=cyan)
        d.rectangle([28, 5, 29, 6], fill=cyan)
        # The floating shield (neutral plate — its behavior sigil is
        # the glyph sprite the scene overlays).
        d.polygon([(12, 3), (20, 3), (20, 8), (16, 12), (12, 8)], fill=(70, 74, 84, 255), outline=pale)
        d.polygon([(14, 5), (18, 5), (18, 8), (16, 10), (14, 8)], fill=(140, 220, 255, 160))
        # Emitter ring: broken arcs around the shield, lit in segments.
        d.arc([9, 0, 23, 14], 300, 20, fill=cyan)
        d.arc([9, 0, 23, 14], 60, 130, fill=cyan)
        d.arc([9, 0, 23, 14], 160, 230, fill=cyan)
        d.arc([9, 0, 23, 14], 250, 285, fill=(57, 208, 216, 140))
    setpiece("set-calibration-rig", 32, 20, rig)

    def sigil(sprite_id: str, painter) -> None:
        img, d = glyph(16, 16)
        painter(d)
        finish_glyph(sprite_id, img)

    gray = (154, 149, 138, 255)
    nova = (255, 110, 64, 255)
    absorb = (57, 208, 216, 255)
    amp = (177, 140, 255, 255)
    turtle = (127, 176, 105, 255)
    # Standard: a plain ringed shield outline — nothing special, by design.
    sigil("glyph-behavior-standard", lambda d: (
        d.polygon([(5, 2), (11, 2), (11, 8), (8, 13), (5, 8)], outline=gray),
        d.line([5, 7, 11, 7], fill=gray),
    ))
    # Nova: an eight-point burst.
    sigil("glyph-behavior-nova", lambda d: (
        d.polygon([(8, 0), (9, 5), (14, 3), (10, 7), (15, 8), (10, 9), (14, 13), (9, 11), (8, 16), (7, 11), (2, 13), (6, 9), (1, 8), (6, 7), (2, 3), (7, 5)], fill=nova),
        d.ellipse([6, 6, 10, 10], fill=(255, 209, 102, 255)),
    ))
    # Absorb: a shield cradling a droplet core.
    sigil("glyph-behavior-absorb", lambda d: (
        d.polygon([(4, 1), (12, 1), (12, 8), (8, 14), (4, 8)], outline=absorb),
        d.polygon([(8, 4), (10, 8), (8, 11), (6, 8)], fill=absorb),
        d.ellipse([7, 7, 9, 9], fill=pale),
    ))
    # Amp: twin chevrons driving up.
    sigil("glyph-behavior-amp", lambda d: (
        d.polygon([(8, 1), (13, 7), (10, 7), (8, 4), (6, 7), (3, 7)], fill=amp),
        d.polygon([(8, 7), (13, 13), (10, 13), (8, 10), (6, 13), (3, 13)], fill=amp),
    ))
    # Turtle: a heavy filled shell with a rim band.
    sigil("glyph-behavior-turtle", lambda d: (
        d.polygon([(4, 1), (12, 1), (12, 8), (8, 14), (4, 8)], fill=turtle),
        d.polygon([(4, 1), (12, 1), (12, 4), (4, 4)], fill=(95, 140, 76, 255)),
        d.line([8, 4, 8, 12], fill=(95, 140, 76, 255)),
    ))


SECTIONS = {
    "imports": build_imports,
    "rigs": build_rigs,
    "heads": build_heads,
    "death": build_death,
    "layers": build_layers,
    "glyphs": build_glyphs,
    "vehicles": build_vehicles,
    "sets": build_sets,
    "unarmed": build_unarmed,
    "goldenbg": build_goldenbg,
    "shieldtech": build_shieldtech,
}

if __name__ == "__main__":
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].split(",")
    for name, fn in SECTIONS.items():
        if only and name not in only:
            continue
        fn()
        print(f"section {name}: done")
    if not only or "manifest" in only:
        write_manifest()
    print(f"registered {len(manifest_additions)} new sprites")
