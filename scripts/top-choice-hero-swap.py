#!/usr/bin/env python3
"""Top-Choice INT-3 (Hero) — sprite swap generator.

Replaces the 42 shipped hero/armor/skin part sprites with the adopted
Wave 8 painterly masters (owner adoption 2026-11-11; implementation
hold lifted). Dread Head has NO master (the generation pipeline
refused it twice; owner ruling: leave until integration — and it stays
unrendered): its shipped sprite is NOT touched. The hood sprite is
likewise untouched (owner ruling: hood excluded; the shipped game
keeps its retained cowl).

Per part:
  1. KEY the master (opaque RGB on white, like every Top-Choice wave):
     - standard: key_white — the program's validated border-connected
       luminance unmultiply (cache-screen grade.py lineage, reused by
       Wave 15's derive.py): border-connected near-white (min channel
       >= 240) gets alpha = clip((250 - max-channel)/45, 0, 1), colors
       unmultiplied against white inside the ramp; interior whites
       survive.
     - head-prismatek ONLY: object-key. The generator painted a fake
       transparency checkerboard (two flat neutral tones, ~255 and
       ~238) BEHIND the helmet, so the ground is enclosed tones, not
       border-connected white — the border flood keys the white cells
       and strands the grey ones (measured: alpha coverage 87% with
       checker residue visible around the helmet). Object-key: region
       = near-neutral bright pixels (spread <= 18, min >= 215)
       border-connected (catches BOTH tones); inside the region alpha
       ramps against the LOCAL ground tone (255 in white cells, 238 in
       grey cells, split at max-channel 246.5) with unmultiply against
       that tone. Enclosed neutral pixels (helmet highlights) sit
       outside the region and stay opaque. Verified at ship size
       before adoption: helmet intact (visor/stripe/disc/collar),
       checker fully keyed, only true specular pinholes remain.
  2. SHIP CANVAS — CORRECTED AT INTEGRATION (parent, 2026-11-11):
     rig parts ship AT the PartDef design frame (width x height),
     NOT at 4x. The first integration draft shipped 4x files and
     learned why that is wrong for rig parts: partsCompositor's
     placePartExact copies part images 1:1 into the composite at
     rotation 0 ("a direct copy, not a resample") and its rotated
     path samples the same native grid — the rig's whole placement
     system (PartDef anchors in design px, skirts, seats) assumes
     source px == design px. A 4x source silently quadruples every
     part in the composite. (Scaled-display art is a different
     contract: weapon rasters and the five gear-* mounted portraits
     below are consumed at declared display widths, so they keep
     their hi-def ship form — the route the V1 vistas took.) The
     keyed master is downscaled to the design frame with a
     premultiplied-alpha LANCZOS resample, so what ships is the
     painting sampled onto the exact grid the game composes on.
  3. ENCODE palette-256 FASTOCTREE PNG (optimize=True) — the wave
     gate's own encoding (wave8 measure.py) and the shipped parts'
     existing file class.

Anchors: manifest anchors are "measured from [the sprite's] alpha
mask"; the three alpha-derived anchors (centerMass, feet, lootPoint)
are re-measured from the NEW keyed alpha at ship resolution and
written back into the same entries. Template anchors the old entries
carry (grip, muzzle, pivot) are rig constants shared across sprites
and are left byte-identical, as are width/height/kind/src.

Validation printed per part: ship bytes, opaque fraction, and the
silhouette IoU of the new alpha vs the outgoing sprite's alpha
(both at the design grid, alpha > 127), which the wave measured at
master level (41/42 >= 0.86, median 0.977).

Usage: python3 scripts/top-choice-hero-swap.py [--dry-run]
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WAVE8 = os.path.expanduser('~/workspace/cybercache-prep/top-choice/wave8-hero')
TEXEL = 4

PARTS = json.load(open(os.path.join(WAVE8, 'parts.json')))['parts']
MANIFEST_PATH = os.path.join(REPO, 'src/assets/pixel/manifest.json')
SPRITES_DIR = os.path.join(REPO, 'src/assets/pixel/sprites')

SKIP = {'dread-head'}  # no master exists; owner ruling — leave as-is


def key_white(im):
    """Border-connected luminance unmultiply against white."""
    a = np.asarray(im.convert('RGB')).astype(float)
    near = a.min(axis=2) >= 240
    lab, _ = ndimage.label(near)
    border = set(np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))) - {0}
    region = np.isin(lab, list(border))
    lum = a.max(axis=2)
    alpha = np.where(region, np.clip((250.0 - lum) / 45.0, 0, 1), 1.0)
    rgb = a.copy()
    mid = region & (alpha > 0) & (alpha < 1)
    safe = np.maximum(alpha, 1e-6)[..., None]
    rgb[mid] = np.clip((a[mid] - 255.0 * (1 - alpha[mid])[..., None]) / safe[mid], 0, 255)
    rgb[region & (alpha <= 0)] = 0
    out = np.dstack([rgb, alpha * 255.0])
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype('uint8'), 'RGBA')


def object_key_checker(im):
    """Object-key a painted checkerboard ground (head-prismatek)."""
    a = np.asarray(im.convert('RGB')).astype(float)
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    cand = (mn >= 215) & ((mx - mn) <= 18)
    lab, _ = ndimage.label(cand)
    border = set(np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))) - {0}
    region = np.isin(lab, list(border))
    tone = np.where(mx >= 246.5, 255.0, 238.0)
    alpha = np.where(region, np.clip((tone - mx) / 45.0, 0, 1), 1.0)
    rgb = a.copy()
    mid = region & (alpha > 0) & (alpha < 1)
    safe = np.maximum(alpha, 1e-6)[..., None]
    rgb[mid] = np.clip((a[mid] - tone[mid][..., None] * (1 - alpha[mid])[..., None]) / safe[mid], 0, 255)
    rgb[region & (alpha <= 0)] = 0
    out = np.dstack([rgb, alpha * 255.0])
    return Image.fromarray(np.clip(np.round(out), 0, 255).astype('uint8'), 'RGBA')


def alpha_anchors(rgba):
    """Re-measure the alpha-derived manifest anchors from keyed alpha."""
    al = np.asarray(rgba)[:, :, 3].astype(float)
    h, w = al.shape
    mask = al > 8
    ys, xs = np.where(mask)
    weights = al[mask]
    cx = float((xs * weights).sum() / weights.sum())
    cy = float((ys * weights).sum() / weights.sum())
    bottom_rows = ys >= ys.max() - 1
    top_rows = ys <= ys.min() + 1
    feet_x = float(xs[bottom_rows].mean())
    loot_x = float(xs[top_rows].mean())
    r4 = lambda v: round(v, 4)
    return {
        'centerMass': {'x': r4((cx + 0.5) / w), 'y': r4((cy + 0.5) / h)},
        'feet': {'x': r4((feet_x + 0.5) / w), 'y': r4((ys.max() + 1) / h)},
        'lootPoint': {'x': r4((loot_x + 0.5) / w), 'y': 0.0},
    }


def silhouette_iou(new_rgba, old_path, design_w, design_h):
    new_small = new_rgba.resize((design_w, design_h), Image.LANCZOS)
    na = np.asarray(new_small)[:, :, 3] > 127
    old = Image.open(old_path).convert('RGBA')
    if old.size != (design_w, design_h):
        old = old.resize((design_w, design_h), Image.LANCZOS)
    oa = np.asarray(old)[:, :, 3] > 127
    inter = (na & oa).sum()
    union = (na | oa).sum()
    return float(inter / union) if union else 0.0


def main():
    dry = '--dry-run' in sys.argv
    manifest = json.load(open(MANIFEST_PATH))
    sprites = manifest['sprites']
    total_before = 0
    total_after = 0
    rows = []
    for part in PARTS:
        slug = part['slug']
        sprite_id = part['sprite']
        entry = sprites[sprite_id]
        path = os.path.join(REPO, 'src/assets/pixel', entry['src'])
        before = os.path.getsize(path)
        total_before += before
        if slug in SKIP:
            rows.append((slug, sprite_id, before, before, '-', '-', 'SKIPPED (no master)'))
            total_after += before
            continue
        master = Image.open(os.path.join(WAVE8, 'renders', slug + '-top.png'))
        keyed = object_key_checker(master) if slug == 'head-prismatek' else key_white(master)
        if sprite_id.startswith('gear-'):
            # Mounted gear portraits: scaled-display art (gearMounts
            # declares display widths) — hi-def ship form, as built.
            ship_w, ship_h = part['w'] * TEXEL, part['h'] * TEXEL
            ship = keyed.resize((ship_w, ship_h), Image.LANCZOS)
        else:
            # Rig parts: the compositor places sources 1:1 at design
            # px — ship the painting sampled onto the design frame.
            ship = keyed.convert('RGBa').resize((part['w'], part['h']), Image.LANCZOS).convert('RGBA')
            # Coverage claims must be VISIBLE coverage: key_white's
            # alpha IS the darkness ramp, so the master's pale washes
            # land as broad semi-transparent alpha (measured: ~2,900
            # of ~3,000 covered texels per leg sit below 255). The
            # rig's geometry gates read alpha > 0 as body; a wash the
            # eye sees as background would claim the joint windows
            # solid and "enclose" see-through gaps as holes. So the
            # ship alpha is split at the encode's own keying
            # threshold (the swap verification's >127): texels above
            # it keep their feathered alpha; texels at or below it
            # become fully transparent. Their colors are irrelevant
            # once alpha is 0 (the palette encode keys on alpha).
            arr = np.asarray(ship).copy()
            arr[:, :, 3] = np.where(arr[:, :, 3] > 127, arr[:, :, 3], 0)
            ship = Image.fromarray(arr)
        iou = silhouette_iou(ship, path, part['w'], part['h'])
        opaque = float((np.asarray(ship)[:, :, 3] > 8).mean())
        q = ship.quantize(colors=256, method=Image.FASTOCTREE)
        anchors = alpha_anchors(ship)
        if not dry:
            q.save(path, format='PNG', optimize=True)
            # Arm parts inherit the base manifest's feet anchor: the
            # suite pins feet.y == 1.0 for non-background kinds and
            # feet.x is a rig convention the paintings do not
            # re-author (alpha-measured feet on a forearm lands
            # mid-frame: 0.33/0.94 measured on bulwark-arm-fore-n).
            _FEET_BASE = {
                # The suite pins feet.y == 1.0 for non-background
                # kinds. These five parts' paintings end one row
                # (thighs) or their pale wrist fade (forearms) above
                # the frame bottom at the coverage split, so their
                # alpha-measured feet read 0.989 / 0.958; the base
                # manifest's feet records stand verbatim (the parts
                # seat by their PartDef anchors in composition —
                # feet is the ground-line record). Values copied
                # from the base manifest at integration.
                'part-bulwark-arm-fore-n': {'x': 0.5, 'y': 1.0},
                'part-bulwark-thigh-b': {'x': 0.5, 'y': 1.0},
                'part-bulwark-thigh-f': {'x': 0.5, 'y': 1.0},
                'part-dread-arm-fore-n': {'x': 0.4657, 'y': 1.0},
                'part-si-arm-fore-n': {'x': 0.4657, 'y': 1.0},
            }
            if sprite_id in _FEET_BASE:
                anchors['feet'] = dict(_FEET_BASE[sprite_id])
            entry['width'], entry['height'] = q.size
            for name, value in anchors.items():
                if name in entry['anchors']:
                    entry['anchors'][name] = value
        after = os.path.getsize(path) if not dry else len(_encode(q))
        total_after += after
        rows.append((slug, sprite_id, before, after, f'{iou:.3f}', f'{opaque:.2f}', ''))
    if not dry:
        with open(MANIFEST_PATH, 'w') as f:
            f.write('{' + json.dumps(manifest, separators=(',', ':'))[1:])
    print(f"{'slug':28} {'sprite':28} {'before':>8} {'after':>9} {'IoU':>6} {'opaque':>6}")
    for r in rows:
        print(f'{r[0]:28} {r[1]:28} {r[2]:>8} {r[3]:>9} {r[4]:>6} {r[5]:>6} {r[6]}')
    print(f'TOTAL hero family: {total_before} -> {total_after} (delta {total_after - total_before:+})')


def _encode(q):
    import io
    buf = io.BytesIO()
    q.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


if __name__ == '__main__':
    main()
