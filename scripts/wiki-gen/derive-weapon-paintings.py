#!/usr/bin/env python3
"""Top-Choice integration INT-1 — derive the wiki generator's painted
weapon sources from the adopted Top-Choice masters.

WHAT THIS PRODUCES (committed beside this script):
  assets/weapons/legendary/<slug>.png   x26  (Wave 1 + Wave 1.5 masters)
  assets/weapons/frames/<type>-<maker>.png x36 (Wave 2 masters)
  assets/weapons/sources.json           provenance record for every file

RECIPE (Wave 15's printed derivation recipe, wave15-derived/NOTES.md —
the same one scratch/derive.py proved against the published plates):
  1. KEY the white-ground master with key_white (below; the cache-screen
     wave's validated Wave 9-lineage keying, vendored verbatim).
  2. CROP to the keyed alpha > 8 bounding box.
  3. RESIZE to the books' shipping class: 1440 px wide (LANCZOS),
     downscale only — a master narrower than 1440 keeps its width.
  4. PALETTE-256 via PIL FASTOCTREE, PNG optimize=True — the program's
     standing compression form, now with true alpha from step 1.

The wiki generator (images.ts / images-w5.ts) fits these sources into
the 480x176 plate boxes; the plates it emits are the committed files
under wiki/images/. The 1440 px class is deliberate: it is the card
width both weapon books measured as the realistic shipping class, so
these same files are the production card assets if a future slice
wires the paintings into the game's renderers (see
docs/top-choice-weapon-integration.md for that decision record).

ADOPTED MASTERS (owner adoption 2026-11-11):
  - Legendaries: the silhouette-pass adopted set — 11 masters in
    wave1-legendaries/renders/ + 15 in wave1-5-silhouette/renders/,
    each `<slug>-top.png` (8,084,274 B palette-256 at native size).
  - Bases: wave2-weapon-bases/renders/<type>-<maker>-top.png x36
    (4,611,563 B palette-256 at native size; pistol-redline's canonical
    file is the adopted flat-profile v2, per the wave NOTES' parent
    adoption record).

RE-RUNNING: needs the Top-Choice prep tree (the masters live outside
the repo). Set TOP_CHOICE_ROOT or pass it as argv[1]; default
~/workspace/cybercache-prep/top-choice. Python deps: PIL, numpy, scipy.
Output is deterministic: same masters in, same bytes out.
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
OUT_ROOT = os.path.join(SCRIPT_DIR, "assets", "weapons")
TC = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get(
        "TOP_CHOICE_ROOT",
        os.path.expanduser("~/workspace/cybercache-prep/top-choice"),
    )
)

CARD_WIDTH = 1440  # the books' measured shipping class (px)


# ---------------------------------------------------------------------------
# key_white — vendored verbatim from the cache-screen wave's grade.py
# (~/workspace/cybercache-prep/top-choice/cache-screen/grade-work/grade.py),
# the Wave 9 luminance lineage validated there against shipped keyed files
# and reused by Wave 15's derive.py. Do not "improve" it here: the plates'
# edge treatment is this function's exact behavior.
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


def derive(master_path, out_path):
    """Key, crop, fit to the card-width class, palette-256. Returns a
    provenance record for the asset."""
    im = Image.open(master_path).convert("RGB")
    native = im.size
    keyed = key_white(im)
    a = np.asarray(keyed)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        raise ValueError(f"empty key: {master_path}")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    content = keyed.crop(box)
    if content.width > CARD_WIDTH:
        h = max(1, round(content.height * CARD_WIDTH / content.width))
        content = content.resize((CARD_WIDTH, h), Image.LANCZOS)
    pal = content.quantize(colors=256, method=Image.FASTOCTREE)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pal.save(out_path, optimize=True)
    return {
        "master": os.path.relpath(master_path, TC),
        "master_size": list(native),
        "content_box": list(box),
        "out_size": list(content.size),
        "bytes": os.path.getsize(out_path),
    }


def legendary_masters():
    """slug -> adopted master path. The adopted set (consolidated ledger
    D-3: 7,130,362 - 4,127,981 + 5,081,893 = 8,084,274 B) replaces 15 of
    the Wave 1 masters with the Wave 1.5 silhouette-pass masters; the
    superseded Wave 1 originals still sit in the Wave 1 folder, so a
    silhouette-pass file, when present, IS the adopted master. (Wave
    15's derive.py mapped all 26 to the Wave 1 folder — its legendary
    plates for the 15 silhouette slugs derive from superseded art;
    this script follows the adoption, not that mapping.)"""
    plate_dir = os.path.join(REPO_ROOT, "wiki", "images", "weapons", "legendary")
    slugs = sorted(f[:-4] for f in os.listdir(plate_dir) if f.endswith(".png"))
    assert len(slugs) == 26, f"expected 26 legendary plates, found {len(slugs)}"
    out = {}
    replaced = 0
    for slug in slugs:
        w1 = os.path.join(TC, "wave1-legendaries", "renders", f"{slug}-top.png")
        w15 = os.path.join(TC, "wave1-5-silhouette", "renders", f"{slug}-top.png")
        assert os.path.exists(w1), f"{slug}: no Wave 1 master at {w1}"
        if os.path.exists(w15):
            out[slug] = w15
            replaced += 1
        else:
            out[slug] = w1
    assert replaced == 15, f"expected 15 silhouette-pass masters, found {replaced}"
    return out


# Wiki frame plate stems are kebab-case game ids; the Wave 2 files use
# compact maker slugs (the map Wave 15's derive.py used).
MAKER_KEBAB_TO_SLUG = {
    "blast-forge": "blastforge",
    "helix-works": "helixworks",
    "ironwood": "ironwood",
    "prismatek": "prismatek",
    "redline": "redline",
    "throw-tech": "throwtech",
}


def frame_masters():
    """plate stem -> adopted Wave 2 master path."""
    plate_dir = os.path.join(REPO_ROOT, "wiki", "images", "weapons", "frames")
    stems = sorted(f[:-4] for f in os.listdir(plate_dir) if f.endswith(".png"))
    assert len(stems) == 36, f"expected 36 frame plates, found {len(stems)}"
    out = {}
    for stem in stems:
        for kebab, slug in MAKER_KEBAB_TO_SLUG.items():
            if stem.endswith("-" + kebab):
                typ = stem[: -len(kebab) - 1]
                master = os.path.join(
                    TC, "wave2-weapon-bases", "renders", f"{typ}-{slug}-top.png"
                )
                assert os.path.exists(master), f"{stem}: missing master {master}"
                out[stem] = master
                break
        else:
            raise ValueError(f"{stem}: no maker suffix matched")
    return out


def main():
    records = {}
    total = 0
    for kind, mapping in (
        ("legendary", legendary_masters()),
        ("frames", frame_masters()),
    ):
        for stem, master in sorted(mapping.items()):
            out_path = os.path.join(OUT_ROOT, kind, f"{stem}.png")
            rec = derive(master, out_path)
            rec["asset"] = f"assets/weapons/{kind}/{stem}.png"
            records[f"{kind}/{stem}"] = rec
            total += rec["bytes"]
            print(
                f"{kind}/{stem}: {rec['master']} {rec['master_size']} -> "
                f"{rec['out_size']} {rec['bytes']:,} B"
            )
    os.makedirs(OUT_ROOT, exist_ok=True)
    with open(os.path.join(OUT_ROOT, "sources.json"), "w") as fh:
        json.dump(records, fh, indent=1, sort_keys=True)
    print(f"derived {len(records)} painted sources, {total:,} B total")


if __name__ == "__main__":
    main()
