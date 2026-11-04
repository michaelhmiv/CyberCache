#!/usr/bin/env python3
"""
Boss identity data generator — the Arena Plate system (C-4).

Derives, from the SHIPPED boss sprites alone, the per-boss presentation
data the boss identity components consume:

  window  — the detail-crop window (file px) for the encounter CELL.
            ONE deterministic rule for every boss: over the sprite's
            texel-grid alpha coverage (texel = 4), take the square
            window (side = 52% of body height, top within the body's
            upper 45%) maximizing mass + 0.5 * top-third mass +
            0.35 * edge density. Mass finds the body, the top weighting
            finds the head end, the edge term keeps the window on
            faces/skulls instead of uniform plate runs.
  stamp   — the micro STAMP grid (picker 20px / vitals 14px): the
            sprite's own alpha silhouette quantized to a 14-column
            texel grid (DESIGN.md §8 detail level 0 — a derivation,
            never a redraw). Each filled cell is one of two tones
            sampled from the sprite's own pixels: its dark mass tone
            (lower-quartile opaque luminance, lifted 55/45 toward the
            core tone so it reads off near-black) and its vivid core
            tone (median of the high-saturation opaque pixels).
  tones   — the two stamp tones as rendered (post-lift).

Inputs : src/lib/pixel/manifest.ts (PIXEL_BOSS_SPRITES id map),
         src/assets/pixel/manifest.json (sprite file + dims),
         src/assets/pixel/sprites/boss-*.png (the shipped art).
Output : src/lib/pixel/bossIdentityData.ts (checked in; do not edit).

The rule set is a faithful port of the approved exploration renderer
(~/workspace/cybercache-prep/boss-identity-samples/renderer/bossid.py +
boss_data.py); the generated values are pinned by
src/test/bossIdentity.test.ts. Re-run after adding a boss sprite:

    python3 scripts/generate-boss-identity.py

Deterministic: same sprites in -> byte-identical module out.
"""
import json
import re
import time
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TEXEL = 4
STAMP_COLS = 14


def texel_coverage(sprite, cell=TEXEL):
    """Alpha coverage per texel cell (float 0..1), numpy array."""
    a = np.asarray(sprite.getchannel("A")).astype(np.float32) / 255.0
    h, w = a.shape
    th, tw = h // cell, w // cell
    a = a[: th * cell, : tw * cell]
    return a.reshape(th, cell, tw, cell).mean(axis=(1, 3))


def body_extent(cov, thresh=0.5):
    ys, xs = np.where(cov >= thresh)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1  # texel units


def detail_window(sprite):
    """The ONE crop rule (see header). Returns (x, y, side) in file px."""
    cov = texel_coverage(sprite)
    x0, y0, x1, y1 = body_extent(cov)
    bh = y1 - y0
    side = max(14, int(round(0.52 * bh)))
    integ = np.pad(cov, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    gx = np.abs(np.diff(cov, axis=1, prepend=0))
    gy = np.abs(np.diff(cov, axis=0, prepend=0))
    edge = gx + gy
    einteg = np.pad(edge, ((1, 0), (1, 0))).cumsum(0).cumsum(1)

    def win_sum(cx, cy, s):
        return (integ[cy + s, cx + s] - integ[cy, cx + s]
                - integ[cy + s, cx] + integ[cy, cx])

    best, best_pos = -1.0, (x0, y0)
    max_top = y0 + int(0.45 * bh)
    third = max(1, side // 3)
    for cy in range(y0, max_top + 1):
        for cx in range(x0, max(x0 + 1, x1 - side + 1)):
            if cx + side > cov.shape[1] or cy + side > cov.shape[0]:
                continue
            total = win_sum(cx, cy, side)
            top = (integ[cy + third, cx + side] - integ[cy, cx + side]
                   - integ[cy + third, cx] + integ[cy, cx])
            esum = (einteg[cy + side, cx + side] - einteg[cy, cx + side]
                    - einteg[cy + side, cx] + einteg[cy, cx])
            score = total + 0.5 * top + 0.35 * esum
            if score > best:
                best, best_pos = score, (cx, cy)
    cx, cy = best_pos
    return (int(cx * TEXEL), int(cy * TEXEL), int(side * TEXEL))


def sprite_tones(sprite):
    """Two tones sampled from the sprite's OWN opaque pixels.

    body = lower-quartile tone by luminance (the mass color in shadow);
    core = median of the vivid set (saturation > 0.45, luminance > 60),
    falling back to the upper-quartile opaque tone when nothing is vivid.
    """
    w, h = sprite.size
    px = sprite.load()
    opaque = []
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            r, g, b, a = px[x, y]
            if a > 200:
                opaque.append((r, g, b))

    def lum(c):
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

    def sat(c):
        mx, mn = max(c), min(c)
        return (mx - mn) / mx if mx else 0

    opaque.sort(key=lum)
    n = len(opaque)
    body = opaque[n // 4]
    vivid = [c for c in opaque if sat(c) > 0.45 and lum(c) > 60]
    vivid.sort(key=lum)
    core = vivid[len(vivid) // 2] if vivid else opaque[(3 * n) // 4]
    return body, core


def stamp_grid(sprite, body_tone, core_tone, cols=STAMP_COLS):
    """Quantize the sprite's alpha silhouette to the stamp grid.

    Returns (rows, cells) where cells is a list of row strings over
    '.' (empty), 'B' (body tone), 'C' (core tone). The rendered body
    tone is lifted toward the core tone (0.55/0.45) — applied by the
    caller when emitting tones, matching the exploration renderer.
    """
    cov = texel_coverage(sprite)
    x0, y0, x1, y1 = body_extent(cov)
    body_img = sprite.crop((x0 * TEXEL, y0 * TEXEL, x1 * TEXEL, y1 * TEXEL))
    bw, bh = body_img.size
    rows = max(6, min(16, int(round(cols * bh / bw))))
    arr = np.asarray(body_img).astype(np.float32)
    H, W = arr.shape[:2]
    out = []
    for gy in range(rows):
        row = []
        for gx in range(cols):
            ya, yb = int(gy * H / rows), int((gy + 1) * H / rows)
            xa, xb = int(gx * W / cols), int((gx + 1) * W / cols)
            block = arr[ya:yb, xa:xb]
            solid = block[..., 3] > 200
            if solid.mean() < 0.42:
                row.append(".")
                continue
            rgb = block[..., :3][solid]
            mx, mn = rgb.max(axis=1), rgb.min(axis=1)
            sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
            lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            vivid = ((sat > 0.45) & (lum > 60)).mean()
            row.append("C" if vivid >= 0.30 else "B")
        out.append("".join(row))
    return rows, out


def hexof(c):
    return "#%02x%02x%02x" % (c[0], c[1], c[2])


def main():
    manifest_ts = (ROOT / "src/lib/pixel/manifest.ts").read_text()
    block = re.search(r"PIXEL_BOSS_SPRITES[^=]*= \{(.*?)\};", manifest_ts, re.S).group(1)
    boss_sprites = re.findall(r"(\w+): '(boss-[a-z-]+)'", block)
    manifest = json.loads((ROOT / "src/assets/pixel/manifest.json").read_text())

    entries = []
    for boss_id, sprite_id in boss_sprites:
        entry = manifest["sprites"][sprite_id]
        file_name = entry["src"].split("/")[-1]
        sprite = Image.open(ROOT / "src/assets/pixel/sprites" / file_name).convert("RGBA")
        wx, wy, side = detail_window(sprite)
        body, core = sprite_tones(sprite)
        lifted_body = tuple(int(body[i] * 0.55 + core[i] * 0.45) for i in range(3))
        rows, cells = stamp_grid(sprite, body, core)
        entries.append({
            "id": boss_id,
            "window": (wx, wy, side),
            "stamp": {"cols": STAMP_COLS, "rows": rows, "cells": cells},
            "bodyTone": hexof(lifted_body),
            "coreTone": hexof(core),
        })
        print(f"{boss_id:18s} window=({wx},{wy},{side}) stamp={STAMP_COLS}x{rows}"
              f" body={hexof(lifted_body)} core={hexof(core)}")

    lines = []
    lines.append("/**")
    lines.append(" * Boss identity data — GENERATED by scripts/generate-boss-identity.py.")
    lines.append(" * Do not edit by hand; re-run the generator after adding a boss sprite.")
    lines.append(" *")
    lines.append(" * Per boss: the detail-crop window (file px into the shipped sprite)")
    lines.append(" * for the encounter cell, and the micro stamp grid ('.' empty, 'B'")
    lines.append(" * body tone, 'C' core tone) with its two sprite-sampled tones. All of")
    lines.append(" * it is derived from the boss's own sprite by the ONE rule set in the")
    lines.append(" * generator — no per-boss authored values exist anywhere in the")
    lines.append(" * Arena Plate system.")
    lines.append(" */")
    lines.append("")
    lines.append("export interface BossIdentityData {")
    lines.append("  /** Detail-crop window into the sprite file: [x, y, side] px. */")
    lines.append("  window: readonly [number, number, number];")
    lines.append("  stamp: {")
    lines.append("    cols: number;")
    lines.append("    rows: number;")
    lines.append("    /** Row-major grid, rows joined top-to-bottom. */")
    lines.append("    cells: readonly string[];")
    lines.append("    bodyTone: string;")
    lines.append("    coreTone: string;")
    lines.append("  };")
    lines.append("}")
    lines.append("")
    lines.append("export const BOSS_IDENTITY_DATA: Record<string, BossIdentityData> = {")
    for e in entries:
        wx, wy, side = e["window"]
        lines.append(f"  {e['id']}: {{")
        lines.append(f"    window: [{wx}, {wy}, {side}],")
        lines.append("    stamp: {")
        lines.append(f"      cols: {e['stamp']['cols']},")
        lines.append(f"      rows: {e['stamp']['rows']},")
        lines.append("      cells: [")
        for row in e["stamp"]["cells"]:
            lines.append(f"        '{row}',")
        lines.append("      ],")
        lines.append(f"      bodyTone: '{e['bodyTone']}',")
        lines.append(f"      coreTone: '{e['coreTone']}',")
        lines.append("    },")
        lines.append("  },")
    lines.append("};")
    lines.append("")
    out = ROOT / "src/lib/pixel/bossIdentityData.ts"
    text = "\n".join(lines)
    # The build VM intermittently denies writes (EPERM) for minutes at a
    # time; retry rather than fail the run (same discipline as the
    # exploration renderer).
    for attempt in range(40):
        try:
            out.write_text(text)
            break
        except PermissionError:
            if attempt == 39:
                raise
            time.sleep(5)
    print(f"wrote {out} ({len(entries)} bosses)")


if __name__ == "__main__":
    main()
