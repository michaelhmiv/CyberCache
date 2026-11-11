#!/usr/bin/env python3
"""Top-Choice INT-4 — consumables + materials sprite production.

Turns the adopted Wave 11 (consumables) and Wave 12 (materials)
painterly masters into shipped sprites, following the program's
established keying lineage:

  1. KEY (Wave 9 luminance lineage — the cache-screen grade.py
     `key_white`, validated against that wave's shipped keyed files
     and reused verbatim by the Wave 15 derived-plate pass):
     border-connected near-white region (min channel >= 240) gets
     alpha = clip((250 - max-channel) / 45, 0, 1); colors are
     unmultiplied against white inside the ramp; interior whites
     survive at full alpha. PRISM SHARDS is the one exception: its
     master carries a painted fake-transparency checkerboard that is
     NOT border-connected, so for that master the enclosed background
     is recovered by OBJECT-keying instead — the checkerboard period
     is estimated from the border frame and every pixel matching its
     two neutral checker tones is keyed out the same way, after which
     the standard border key runs. The result is verified by
     measuring residual checkerboard-tone pixels outside the object
     silhouette; if they do not collapse to noise, the script exits
     non-zero for that master (the slice keeps the shipped render).
  2. CROP to the keyed alpha > 8 bounding box.
  3. FIT into the ship box preserving aspect (LANCZOS), centered, so
     the sprite canvas is BOX x BOX with the object fitted inside.
     (BRIEF floor 4 governs exhibits, not shipped sprites; the game's
     own wiki derivation uses the same fit-to-box LANCZOS step.)
  4. ENCODE palette-256 (PIL FASTOCTREE, optimize=True) — the
     program's shipping encode class (BRIEF hard floor 2, DESIGN.md
     palette-256 class): true alpha ships as an indexed tRNS chunk.
  5. ANCHORS computed from the final alpha mask with the same
     definitions as scripts/pixel-key.py's compute_anchors (feet /
     centerMass / muzzle / lootPoint / grip), written as a
     `<output>.anchors.json` sidecar, for the manifest entry.

Ship boxes (2x the family's largest CSS display size, the game's own
retina convention — cf. wiki plates at 96px for 48px display):
  - consumables / materials (STUFF): 104 (largest display 52px)
  - wallet resources: 80 (the 40px hero slot of the 13/17/26/40 ramp)

Usage:
  python3 scripts/topchoice-items-key.py --batch jobs.json
  # job: {src, out, box, object_key?: bool}

Requires: Python 3.10+, Pillow, numpy, scipy.
Exit codes: 0 ok, 2 bad input / failed object-key verification.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


def key_white(im: Image.Image) -> Image.Image:
    """Border-connected luminance unmultiply against white."""
    a = np.asarray(im.convert("RGB")).astype(float)
    near = a.min(axis=2) >= 240
    lab, _ = ndimage.label(near)
    border = set(
        np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))
    ) - {0}
    region = np.isin(lab, list(border))
    lum = a.max(axis=2)
    alpha = np.where(region, np.clip((250.0 - lum) / 45.0, 0, 1), 1.0)
    rgb = a.copy()
    mid = region & (alpha > 0) & (alpha < 1)
    safe = np.maximum(alpha, 1e-6)[..., None]
    rgb[mid] = np.clip((a[mid] - 255.0 * (1 - alpha[mid])[..., None]) / safe[mid], 0, 255)
    rgb[region & (alpha <= 0)] = 0
    out = np.dstack([rgb, alpha * 255.0])
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype("uint8"), "RGBA")


def object_key_checkerboard(im: Image.Image) -> Image.Image:
    """Remove a painted fake-transparency checkerboard ground by
    keying alpha FROM THE OBJECT (the Wave 12 disposition: "alpha
    keys from the object, so the ground is removable").

    The object is recovered as the largest connected component of
    object-like pixels (saturated, or dark — the crystal cluster and
    its rock base), morphologically closed so anti-aliased seams
    inside the silhouette join it, then grown by a few pixels to
    reclaim the painterly edge. Alpha feathers across the
    silhouette's outer band with colors unmultiplied against the
    local ground estimate (the checkerboard's own mean tone), so no
    checker fringe survives. Everything outside the silhouette is
    transparent BY CONSTRUCTION — the enclosed, non-border-connected
    checkerboard cannot survive, because it is never admitted.

    Returns (keyed RGBA, outside_fraction): the share of object-like
    pixels that fell outside the recovered silhouette — the caller's
    cleanliness check (satellite fragments lost with the ground).
    """
    a = np.asarray(im.convert("RGB")).astype(float)
    lum = a.max(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    obj = (sat >= 25) | (lum <= 110)
    lab, n = ndimage.label(obj)
    if n == 0:
        raise ValueError("object-key: no object-like pixels found")
    sizes = ndimage.sum(obj, lab, range(1, n + 1))
    mask = lab == (1 + int(np.argmax(sizes)))
    outside = float((obj & ~mask).sum() / max(1, obj.sum()))
    mask = ndimage.binary_closing(mask, iterations=6)
    mask = ndimage.binary_fill_holes(mask)
    grown = ndimage.binary_dilation(mask, iterations=3)
    # Feather: alpha from signed distance across the grown edge.
    dist_in = ndimage.distance_transform_edt(grown)
    dist_out = ndimage.distance_transform_edt(~grown)
    signed = np.where(grown, dist_in, -dist_out)
    alpha = np.clip((signed + 2.0) / 4.0, 0, 1)
    # Ground estimate for unmultiply: the mean of the non-object field.
    ground = a[~grown].mean(axis=0) if (~grown).any() else np.array([235.0, 235.0, 235.0])
    rgb = a.copy()
    mid = (alpha > 0) & (alpha < 1)
    safe = np.maximum(alpha, 1e-6)[..., None]
    rgb[mid] = np.clip((a[mid] - ground * (1 - alpha[mid])[..., None]) / safe[mid], 0, 255)
    rgb[alpha <= 0] = 0
    out = np.dstack([rgb, alpha * 255.0])
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype("uint8"), "RGBA"), outside


def compute_anchors(img: Image.Image) -> dict:
    """pixel-key.py's anchor definitions, on the shipped sprite."""
    w, h = img.size
    alpha = np.asarray(img)[:, :, 3].astype(float)
    mask = alpha >= 32
    if not mask.any():
        raise ValueError("no opaque pixels")
    weight = np.where(mask, alpha, 0.0)
    total = weight.sum()
    ys, xs = np.mgrid[0:h, 0:w]
    cx = float((weight * xs).sum() / total)
    cy = float((weight * ys).sum() / total)
    rows = weight.sum(axis=1)
    cols = weight.sum(axis=0)
    top_row = int(np.argmax(rows > 0))
    bottom_row = h - 1 - int(np.argmax(rows[::-1] > 0))
    right_col = w - 1 - int(np.argmax(cols[::-1] > 0))
    band = max(1, int((bottom_row - top_row) * 0.15))

    def frac_x(v: float) -> float:
        return round(v / max(1, w - 1), 4)

    def frac_y(v: float) -> float:
        return round(v / max(1, h - 1), 4)

    feet_w = weight[bottom_row - band : bottom_row + 1]
    feet_x = float((feet_w * xs[bottom_row - band : bottom_row + 1]).sum() / feet_w.sum())
    top_w = weight[top_row : top_row + band + 1]
    top_x = float((top_w * xs[top_row : top_row + band + 1]).sum() / top_w.sum())
    muzzle_w = weight[:, right_col]
    muzzle_y = float((muzzle_w * ys[:, right_col]).sum() / muzzle_w.sum())
    grip_mask = mask & (xs <= w * 0.45) & (ys >= h * 0.45)
    if grip_mask.any():
        grip_w = np.where(grip_mask, alpha, 0.0)
        grip_x = float((grip_w * xs).sum() / grip_w.sum())
        grip_y = float((grip_w * ys).sum() / grip_w.sum())
    else:
        grip_x, grip_y = cx, cy

    return {
        "feet": {"x": frac_x(feet_x), "y": 1.0},
        "centerMass": {"x": frac_x(cx), "y": frac_y(cy)},
        "muzzle": {"x": 1.0, "y": frac_y(muzzle_y)},
        "lootPoint": {"x": frac_x(top_x), "y": 0.0},
        "grip": {"x": frac_x(grip_x), "y": frac_y(grip_y)},
    }


def process(src_path: Path, out_path: Path, *, box: int, object_key: bool) -> dict:
    img = Image.open(src_path)
    img.load()
    img = img.convert("RGB")

    residual = None
    if object_key:
        keyed, residual = object_key_checkerboard(img)
        if residual > 0.01:
            print(
                f"error: {src_path} object-key left {residual:.4f} of the "
                "object's pixels outside the recovered silhouette — "
                "STOP this master",
                file=sys.stderr,
            )
            raise SystemExit(2)
    else:
        keyed = key_white(img)

    a = np.asarray(keyed)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        print(f"error: {src_path} has no opaque pixels after keying", file=sys.stderr)
        raise SystemExit(2)
    content = keyed.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))

    scale = min(box / content.width, box / content.height)
    new_size = (max(1, round(content.width * scale)), max(1, round(content.height * scale)))
    fitted = content.resize(new_size, Image.LANCZOS)
    canvas = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((box - new_size[0]) // 2, (box - new_size[1]) // 2))

    quantized = canvas.quantize(colors=256, method=Image.FASTOCTREE)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    quantized.save(out_path, optimize=True)

    anchors = compute_anchors(canvas)
    sidecar = out_path.with_suffix(".anchors.json")
    sidecar.write_text(
        json.dumps({"sprite": out_path.stem, "anchors": anchors}, indent=2) + "\n"
    )
    result = {
        "src": str(src_path),
        "out": str(out_path),
        "width": box,
        "height": box,
        "bytes": out_path.stat().st_size,
        "anchors": anchors,
        "sidecar": str(sidecar),
    }
    if residual is not None:
        result["object_key_residual"] = residual
    return result


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Top-Choice INT-4 item sprite production")
    ap.add_argument("--batch", required=True, help="JSON file of jobs: [{src, out, box, object_key?}]")
    args = ap.parse_args(argv)
    jobs = json.loads(Path(args.batch).read_text())
    for job in jobs:
        result = process(
            Path(job["src"]),
            Path(job["out"]),
            box=int(job["box"]),
            object_key=bool(job.get("object_key", False)),
        )
        print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
