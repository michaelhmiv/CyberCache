#!/usr/bin/env python3
"""CyberCache pixel-art chroma-key pipeline (P1).

Turns generated source art on a solid magenta background into transparent PNG
sprites, exactly the way the approved proofs (sample-pixel*.mp4) were made:

  1. Magenta-distance alpha: each pixel's alpha comes from its distance to
     the key color family (generated "magenta" measures ~(252, 0, 170); the
     green channel is the discriminator). Pixels at the key color go fully
     transparent, pixels far from it go fully opaque, and the band in between
     ramps smoothly so edges don't halo.
  2. Despill: partially transparent edge pixels have their magenta cast pulled
     back toward their green channel so no pink fringe survives.
  3. Trim: the result is cropped to the opaque bounding box (plus padding).
  4. Normalize: downscale with NEAREST resampling so the sprite lands on the
     canonical texel grid (--max-height / --max-width caps, aspect preserved).
     Pixel art must never be bilinearly resampled.
  5. Anchors: presentation anchors are computed from the final alpha mask and
     written to a `<output>.anchors.json` sidecar, in normalized (0..1)
     fractions of the trimmed sprite:

       feet       alpha-weighted centroid of the lowest opaque band, y = 1
       centerMass alpha-weighted centroid of the whole mask
       muzzle     rightmost opaque column, at that column's centroid height
                  (weapons point right; characters' held-weapon reference)
       lootPoint  topmost opaque row's centroid, y = 0
       grip       opaque centroid of the lower-left quadrant (held point)

     Components position FX from these anchors (see
     src/assets/pixel/manifest.json) — never hand-tuned per screen.

Background scenes (full-bleed art with no magenta) use --passthrough: they are
only resized/converted, never keyed or trimmed.

Usage:
  python3 scripts/pixel-key.py hunter-source.webp src/assets/pixel/sprites/hunter.png
  python3 scripts/pixel-key.py zone-bg.webp src/assets/pixel/sprites/zone-dustwaste-bg.jpg --passthrough --max-width 960
  python3 scripts/pixel-key.py --batch jobs.json   # [{"src":..., "out":..., ...opts}]

Requires: Python 3.10+ and Pillow (pip install pillow).
Exit codes: 0 ok, 2 bad input (no opaque pixels / unreadable file).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from PIL import Image

KEY_COLOR = (255, 0, 255)


def magenta_distance_alpha(r: int, g: int, b: int, hard: float, soft: float) -> int:
    """Alpha from RGB distance to the key color family.

    Generated "magenta" backgrounds land around (252, 0, 170) rather than pure
    #FF00FF, so distance is measured in a magenta-aware space: the green
    channel is the discriminator (key pixels have essentially no green, and it
    is weighted double), red must be near max, and blue is only penalized when
    it falls well below the key family (< 150). dist ~= 0 on the key color.
    """
    dr = 255 - r
    dg = g * 2
    db = max(0, 150 - b)
    dist = math.sqrt(dr * dr + dg * dg + db * db)
    if dist <= hard:
        return 0
    if dist >= soft:
        return 255
    return int(round(255 * (dist - hard) / (soft - hard)))


def key_image(img: Image.Image, hard: float, soft: float) -> Image.Image:
    src = img.convert("RGB")
    w, h = src.size
    px = src.load()
    out = Image.new("RGBA", (w, h))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            a = magenta_distance_alpha(r, g, b, hard, soft)
            if a == 0:
                opx[x, y] = (0, 0, 0, 0)
                continue
            if a < 255:
                # Despill: pull the magenta cast (R/B surplus over G) down
                # toward G on semi-transparent edge pixels.
                spill = max(0, (r - g) + (b - g)) // 2
                keep = a / 255.0
                r = max(g, int(r - spill * (1 - keep)))
                b = max(g, int(b - spill * (1 - keep)))
            opx[x, y] = (r, g, b, a)
    return out


def compute_anchors(img: Image.Image) -> dict:
    """Presentation anchors (normalized 0..1 fractions) from the alpha mask."""
    w, h = img.size
    alpha = img.split()[3]
    px = alpha.load()

    total = 0
    cx = cy = 0.0
    rows: dict[int, int] = {}
    cols: dict[int, int] = {}
    for y in range(h):
        for x in range(w):
            a = px[x, y]
            if a < 32:  # treat near-transparent as empty
                continue
            total += a
            cx += x * a
            cy += y * a
            rows[y] = rows.get(y, 0) + a
            cols[x] = cols.get(x, 0) + a
    if total == 0:
        raise ValueError("no opaque pixels")

    def frac_x(v: float) -> float:
        return round(v / max(1, w - 1), 4)

    def frac_y(v: float) -> float:
        return round(v / max(1, h - 1), 4)

    top_row = min(rows)
    bottom_row = max(rows)
    right_col = max(cols)

    # Feet: x-centroid of the lowest 15% band of opaque rows, pinned to y=1.
    band = max(1, int((bottom_row - top_row) * 0.15))
    feet_num = feet_den = 0.0
    top_num = top_den = 0.0
    muzzle_num = muzzle_den = 0.0
    grip_num_x = grip_num_y = grip_den = 0.0
    for y in range(h):
        for x in range(w):
            a = px[x, y]
            if a < 32:
                continue
            if y >= bottom_row - band:
                feet_num += x * a
                feet_den += a
            if y <= top_row + band:
                top_num += x * a
                top_den += a
            if x == right_col:
                muzzle_num += y * a
                muzzle_den += a
            if x <= w * 0.45 and y >= h * 0.45:  # lower-left quadrant = grip
                grip_num_x += x * a
                grip_num_y += y * a
                grip_den += a

    return {
        "feet": {"x": frac_x(feet_num / feet_den), "y": 1.0},
        "centerMass": {"x": frac_x(cx / total), "y": frac_y(cy / total)},
        "muzzle": {"x": 1.0, "y": frac_y(muzzle_num / muzzle_den)},
        "lootPoint": {"x": frac_x(top_num / top_den), "y": 0.0},
        "grip": {
            "x": frac_x(grip_num_x / grip_den) if grip_den else frac_x(cx / total),
            "y": frac_y(grip_num_y / grip_den) if grip_den else frac_y(cy / total),
        },
    }


def process(src_path: Path, out_path: Path, *, passthrough: bool, hard: float,
            soft: float, pad: int, max_width: int | None, max_height: int | None) -> dict:
    img = Image.open(src_path)
    img.load()
    if passthrough:
        rgba = img.convert("RGB")
        anchors = None
    else:
        rgba = key_image(img, hard, soft)
        bbox = rgba.split()[3].getbbox()
        if bbox is None:
            print(f"error: {src_path} has no opaque pixels after keying", file=sys.stderr)
            raise SystemExit(2)
        left = max(0, bbox[0] - pad)
        upper = max(0, bbox[1] - pad)
        right = min(rgba.width, bbox[2] + pad)
        lower = min(rgba.height, bbox[3] + pad)
        rgba = rgba.crop((left, upper, right, lower))
        anchors = compute_anchors(rgba)

    # Canonical downscale (NEAREST only — pixel art texels stay square).
    scale = 1.0
    if max_width and rgba.width > max_width:
        scale = min(scale, max_width / rgba.width)
    if max_height and rgba.height > max_height:
        scale = min(scale, max_height / rgba.height)
    if scale < 1.0:
        new_size = (max(1, round(rgba.width * scale)), max(1, round(rgba.height * scale)))
        rgba = rgba.resize(new_size, Image.NEAREST)
        if anchors is not None:
            anchors = compute_anchors(rgba)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.suffix.lower() in (".jpg", ".jpeg"):
        rgba.convert("RGB").save(out_path, quality=88)
    else:
        rgba.save(out_path)

    result = {"src": str(src_path), "out": str(out_path),
              "width": rgba.width, "height": rgba.height, "anchors": anchors}
    if anchors is not None:
        sidecar = out_path.with_suffix(".anchors.json")
        sidecar.write_text(json.dumps({"sprite": out_path.stem, **result}, indent=2) + "\n")
        result["sidecar"] = str(sidecar)
    return result


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="CyberCache magenta chroma-key pipeline")
    ap.add_argument("src", nargs="?", help="source image on solid magenta")
    ap.add_argument("out", nargs="?", help="output PNG (or .jpg for backgrounds)")
    ap.add_argument("--passthrough", action="store_true",
                    help="background scene: resize/convert only, no keying or trim")
    ap.add_argument("--hard", type=float, default=60.0,
                    help="distance at/below which pixels are fully transparent (default 60)")
    ap.add_argument("--soft", type=float, default=170.0,
                    help="distance at/above which pixels are fully opaque (default 170)")
    ap.add_argument("--pad", type=int, default=2, help="trim padding in px (default 2)")
    ap.add_argument("--max-width", type=int, default=None)
    ap.add_argument("--max-height", type=int, default=None)
    ap.add_argument("--batch", help="JSON file of jobs: [{src, out, passthrough?, max_width?, ...}]")
    args = ap.parse_args(argv)

    jobs: list[dict] = []
    if args.batch:
        jobs = json.loads(Path(args.batch).read_text())
    elif args.src and args.out:
        jobs = [{"src": args.src, "out": args.out, "passthrough": args.passthrough,
                 "hard": args.hard, "soft": args.soft, "pad": args.pad,
                 "max_width": args.max_width, "max_height": args.max_height}]
    else:
        ap.error("give SRC and OUT, or --batch jobs.json")

    for job in jobs:
        result = process(
            Path(job["src"]), Path(job["out"]),
            passthrough=bool(job.get("passthrough", False)),
            hard=float(job.get("hard", 60.0)), soft=float(job.get("soft", 170.0)),
            pad=int(job.get("pad", 2)),
            max_width=job.get("max_width"), max_height=job.get("max_height"),
        )
        print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
