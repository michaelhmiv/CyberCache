#!/usr/bin/env python3
"""Top-Choice integration INT-1 — sync the painted weapon sources into
the game's sprite production layer.

Inputs (committed, produced by scripts/wiki-gen/derive-weapon-paintings.py):
  scripts/wiki-gen/assets/weapons/legendary/<slug>.png   x26
  scripts/wiki-gen/assets/weapons/frames/<stem>.png      x36
  scripts/wiki-gen/assets/weapons/sources.json           provenance

Outputs:
  src/assets/pixel/sprites/legendary-painting-<slug>.png  (kind weapon-legendary)
  src/assets/pixel/sprites/weapon-base-<stem>.png         (kind weapon-base)
  src/assets/pixel/manifest.json — the 62 entries, anchors measured
    from each sprite's alpha mask by scripts/pixel-key.py's own
    compute_anchors (the manifest's canonical anchor method); the
    file's compact sorted format is preserved byte-exactly (verified
    by a round-trip assertion before anything is written).
  src/lib/pixel/weaponPaintingData.ts — the trim records
    (src/lib/pixel/spriteProduction.ts is the consumer): for each
    sprite, where its content sits on the adopted master's full
    canvas, in sprite pixels. A sprite whose keyed content does not
    touch all four frame edges after the card-width resize is cropped
    to its alpha>8 bounding box first, so the trim round-trip the
    weaponKinds test asserts holds by construction.

The bespoke legendary id space (legendary-<slug>) is deliberately NOT
used: those ids are the V4 authored-data identities, and
src/test/pixelManifest.test.ts pins them as non-sprites. The painting
ids live beside them (legendary-painting-*).

Re-running is idempotent: same inputs, same outputs. No game renderer
consumes these sprites yet — see docs/top-choice-weapon-integration.md.
"""
import importlib.util
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
ASSETS = os.path.join(REPO_ROOT, "scripts", "wiki-gen", "assets", "weapons")
SPRITES_DIR = os.path.join(REPO_ROOT, "src", "assets", "pixel", "sprites")
MANIFEST_PATH = os.path.join(REPO_ROOT, "src", "assets", "pixel", "manifest.json")
DATA_PATH = os.path.join(REPO_ROOT, "src", "lib", "pixel", "weaponPaintingData.ts")

spec = importlib.util.spec_from_file_location(
    "pixel_key", os.path.join(SCRIPT_DIR, "pixel-key.py")
)
pixel_key = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pixel_key)

ALPHA_FLOOR = 8  # the derivation recipe's content threshold


def content_bbox(img):
    a = np.asarray(img)[:, :, 3]
    ys, xs = np.where(a > ALPHA_FLOOR)
    if len(xs) == 0:
        raise ValueError("empty alpha")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def dump_manifest(data):
    return json.dumps(data, sort_keys=True, separators=(",", ":")) + "\n"


def main():
    sources = json.load(open(os.path.join(ASSETS, "sources.json")))
    plan = []  # (sprite_id, kind, asset_rel, src_record_key)
    for key, rec in sorted(sources.items()):
        kind_dir, stem = key.split("/", 1)
        if kind_dir == "legendary":
            plan.append((f"legendary-painting-{stem}", "weapon-legendary", rec["asset"], key))
        else:
            plan.append((f"weapon-base-{stem}", "weapon-base", rec["asset"], key))
    assert len(plan) == 62, f"expected 62 paintings, planned {len(plan)}"

    # The manifest edit must be byte-safe: prove the round-trip first.
    raw_before = open(MANIFEST_PATH).read()
    manifest = json.loads(raw_before)
    assert dump_manifest(manifest) == raw_before, "manifest round-trip mismatch — refusing to edit"
    bytes_before = sum(
        os.path.getsize(os.path.join(REPO_ROOT, "src", "assets", "pixel", e["src"]))
        for e in manifest["sprites"].values()
    )

    trims = {}
    slugs = []
    stems = []
    cropped = []
    for sprite_id, kind, asset_rel, key in plan:
        rec = sources[key]
        src_path = os.path.join(REPO_ROOT, "scripts", "wiki-gen", asset_rel)
        pal_img = Image.open(src_path)  # palette-256, the production form
        bx, by, bx1, by1 = content_bbox(pal_img.convert("RGBA"))
        out_path = os.path.join(SPRITES_DIR, f"{sprite_id}.png")
        if (bx, by, bx1, by1) != (0, 0, pal_img.width, pal_img.height):
            pal_img = pal_img.crop((bx, by, bx1, by1))
            pal_img.save(out_path, optimize=True)
            cropped.append(sprite_id)
        else:
            bx = by = 0
            shutil.copyfile(src_path, out_path)
        img = pal_img.convert("RGBA")

        master_w, master_h = rec["master_size"]
        cx0, cy0, cx1, _cy1 = rec["content_box"]
        # Scale between the master's content box and the pre-crop sprite.
        pre_w = rec["out_size"][0]
        s = pre_w / (cx1 - cx0)
        trims[sprite_id] = {
            "fullWidth": round(master_w * s),
            "fullHeight": round(master_h * s),
            "left": round(cx0 * s) + bx,
            "top": round(cy0 * s) + by,
        }
        anchors = pixel_key.compute_anchors(img)
        manifest["sprites"][sprite_id] = {
            "anchors": anchors,
            "height": img.height,
            "kind": kind,
            "src": f"sprites/{sprite_id}.png",
            "width": img.width,
        }
        if kind == "weapon-legendary":
            slugs.append(sprite_id[len("legendary-painting-"):])
        else:
            stems.append(sprite_id[len("weapon-base-"):])

    note = (
        " Weapon painting entries (legendary-painting-*, weapon-base-*) are synced by"
        " scripts/sync-weapon-paintings.py from the Top-Choice adopted masters."
    )
    if "sync-weapon-paintings" not in manifest["notes"]:
        manifest["notes"] += note
    with open(MANIFEST_PATH, "w") as fh:
        fh.write(dump_manifest(manifest))
    bytes_after = sum(
        os.path.getsize(os.path.join(REPO_ROOT, "src", "assets", "pixel", e["src"]))
        for e in manifest["sprites"].values()
    )

    lines = [
        "/**",
        " * Weapon painting production data (Top-Choice integration INT-1) —",
        " * GENERATED by scripts/sync-weapon-paintings.py from",
        " * scripts/wiki-gen/assets/weapons/sources.json. Do not edit by hand;",
        " * re-run the sync instead.",
        " *",
        " * The trim record for a painting states where the sprite's content",
        " * sits on its adopted master's full canvas, in sprite pixels: the",
        " * sprite placed at (left, top) on a fullWidth x fullHeight canvas",
        " * reproduces the master composition the derivation cropped from.",
        " * src/lib/pixel/spriteProduction.ts owns the trim/untrim/retrim",
        " * operations; src/test/weaponKinds.test.ts pins the round-trip.",
        " */",
        "",
        "export interface WeaponPaintingTrim {",
        "  fullWidth: number;",
        "  fullHeight: number;",
        "  left: number;",
        "  top: number;",
        "}",
        "",
        "/** The 26 adopted legendary paintings, by slug. */",
        f"export const LEGENDARY_PAINTING_SLUGS: readonly string[] = {json.dumps(sorted(slugs), indent=2)};",
        "",
        "/** The 36 adopted weapon base paintings, by wiki frame stem. */",
        f"export const WEAPON_BASE_PAINTING_STEMS: readonly string[] = {json.dumps(sorted(stems), indent=2)};",
        "",
        "/** Trim records, keyed by manifest sprite id. */",
        "export const WEAPON_PAINTING_TRIMS: Readonly<Record<string, WeaponPaintingTrim>> = {",
    ]
    for sprite_id in sorted(trims):
        t = trims[sprite_id]
        lines.append(
            f"  '{sprite_id}': {{ fullWidth: {t['fullWidth']}, fullHeight: {t['fullHeight']}, left: {t['left']}, top: {t['top']} }},"
        )
    lines += ["};", ""]
    with open(DATA_PATH, "w") as fh:
        fh.write("\n".join(lines))

    print(f"sprites written: {len(plan)} (content-cropped at sync: {len(cropped)}{': ' + ', '.join(cropped) if cropped else ''})")
    print(f"manifest: {len(manifest['sprites'])} entries; payload {bytes_before:,} -> {bytes_after:,} B (delta {bytes_after - bytes_before:+,})")
    lg = sum(os.path.getsize(os.path.join(SPRITES_DIR, f"{i}.png")) for i in trims if i.startswith("legendary-painting-"))
    wb = sum(os.path.getsize(os.path.join(SPRITES_DIR, f"{i}.png")) for i in trims if i.startswith("weapon-base-"))
    print(f"  legendary paintings: {lg:,} B | weapon bases: {wb:,} B")


if __name__ == "__main__":
    sys.exit(main())
