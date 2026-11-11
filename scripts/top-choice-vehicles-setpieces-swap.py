#!/usr/bin/env python3
"""Top-Choice integration INT-5 — produce the shipped vehicle + set-piece
sprites from the adopted Top-Choice masters.

WHAT THIS PRODUCES (in place, over the shipped sprite files):
  src/assets/pixel/sprites/vehicle-*.png  x13  (7 class bases + 6 overlays)
  src/assets/pixel/sprites/set-*.png      x21

RECIPE (the program's integration form — INT-7's shipped cache family is
the precedent; Wave 15's NOTES.md prints the keying recipe):
  1. KEY the white-ground master with key_white (vendored verbatim below;
     the cache-screen wave's validated Wave 9-lineage border-flood
     luminance unmultiply). Full frame — no crop, no resize: the shipped
     sprite keeps the master's native dimensions and the manifest entry
     is re-measured to match.
  2. PALETTE-256 via PIL FASTOCTREE, PNG optimize=True — the program's
     standing compression form, now carrying true alpha from step 1.

ADOPTED MASTERS (owner adoption 2026-11-11):
  - Vehicle bases: the Wave 7.5 COLORWAY masters
    (wave7-vehicles/colorways/<slug>-colorway-top.png), 3,508,202 B
    palette-256 at native size. The utility rover's adopted file is the
    MASKED v2 grade, utility-rover-colorway2-top.png (554,190 B) — NOT
    the v1 grade (558,055 B) that also sits in that folder; the seven
    adopted files' own palette-256 twins sum to exactly 3,508,202 B
    only with v2 (with v1 they sum to 3,512,067 B — the colorway NOTES'
    stale headline).
  - Vehicle overlays: the Wave 7 navy masters
    (wave7-vehicles/renders/<slug>-top.png) — the colorway pass graded
    bases only; the overlays ride unchanged. EXCEPTION: condition-scuff
    was generated on a plain mid-grey ground BY DESIGN (its marks are
    near-white; on white they would vanish — Wave 7 NOTES), so it is
    keyed against its own measured ground colour, not key_white.
  - Set pieces: the Wave 10 masters (wave10-setpieces/renders/
    set-*-top.png), 7,878,811 B palette-256 at native size.

RE-RUNNING: needs the Top-Choice prep tree (the masters live outside the
repo). Set TOP_CHOICE_ROOT or pass it as argv[1]; default
~/workspace/cybercache-prep/top-choice. Python deps: PIL, numpy, scipy.
Output is deterministic: same masters in, same bytes out.
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
SPRITES = os.path.join(REPO_ROOT, "src", "assets", "pixel", "sprites")
TC = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get(
        "TOP_CHOICE_ROOT",
        os.path.expanduser("~/workspace/cybercache-prep/top-choice"),
    )
)


# ---------------------------------------------------------------------------
# key_white — vendored verbatim from the cache-screen wave's grade.py
# (~/workspace/cybercache-prep/top-choice/cache-screen/grade-work/grade.py),
# the Wave 9 luminance lineage validated there against shipped keyed files
# and reused by Wave 15's derive.py and INT-1's painting derivation.
# Do not "improve" it here: the sprites' edge treatment is this function's
# exact behavior.
# ---------------------------------------------------------------------------
def key_white(im):
    """Border-connected luminance unmultiply against white (NOTES-LOGOID)."""
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


def key_grey(im):
    """Distance key against the master's own measured border ground —
    for condition-scuff, whose ground is a deliberate mid-grey (Wave 7
    NOTES: its marks are near-white and would vanish on white)."""
    a = np.asarray(im.convert("RGB")).astype(float)
    border = np.concatenate([a[0, :], a[-1, :], a[:, 0], a[:, -1]])
    ground = np.median(border, axis=0)
    dist = np.abs(a - ground).max(axis=2)
    alpha = np.clip(dist / 26.0, 0, 1)
    out = np.dstack([a, alpha * 255.0])
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype("uint8"), "RGBA")


def jobs():
    w7 = os.path.join(TC, "wave7-vehicles")
    cw = os.path.join(w7, "colorways")
    rd = os.path.join(w7, "renders")
    out = []
    for slug in (
        "scrap-bike", "dune-buggy", "cargo-hauler",
        "armored-crawler", "relay-skimmer", "leviathan-rig",
    ):
        out.append((f"vehicle-{slug}", os.path.join(cw, f"{slug}-colorway-top.png"), "white"))
    # The adopted rover is the masked v2 grade — never the v1 file.
    out.append(("vehicle-utility-rover", os.path.join(cw, "utility-rover-colorway2-top.png"), "white"))
    for slug in (
        "affix-armor-plate", "affix-cargo-rack", "affix-reinforced-frame",
        "affix-scanner-array", "condition-smoke",
    ):
        out.append((f"vehicle-{slug}", os.path.join(rd, f"{slug}-top.png"), "white"))
    out.append(("vehicle-condition-scuff", os.path.join(rd, "condition-scuff-top.png"), "grey"))
    w10 = os.path.join(TC, "wave10-setpieces", "renders")
    for f in sorted(os.listdir(w10)):
        if f.startswith("set-") and f.endswith("-top.png"):
            out.append((f[: -len("-top.png")], os.path.join(w10, f), "white"))
    return out


def main():
    records = {}
    for sid, master, key_kind in jobs():
        assert os.path.exists(master), f"missing master: {master}"
        im = Image.open(master).convert("RGB")
        keyed = key_grey(im) if key_kind == "grey" else key_white(im)
        pal = keyed.quantize(colors=256, method=Image.FASTOCTREE)
        dest = os.path.join(SPRITES, f"{sid}.png")
        old = os.path.getsize(dest) if os.path.exists(dest) else 0
        buf = io.BytesIO()
        pal.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        with open(dest, "wb") as fh:
            fh.write(data)
        records[sid] = {
            "master": os.path.relpath(master, TC),
            "master_size": list(im.size),
            "key": key_kind,
            "before_bytes": old,
            "bytes": len(data),
        }
        print(f"{sid}: {records[sid]['master']} {im.size} -> {len(data):,} B (was {old:,})")
    total = sum(r["bytes"] for r in records.values())
    print(f"produced {len(records)} sprites, {total:,} B total")
    sidecar = os.path.join(SCRIPT_DIR, "top-choice-vehicles-setpieces-sources.json")
    with open(sidecar, "w") as fh:
        json.dump(records, fh, indent=1, sort_keys=True)
    print(f"provenance: {sidecar}")


if __name__ == "__main__":
    main()
