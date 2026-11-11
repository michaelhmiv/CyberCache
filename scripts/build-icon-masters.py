#!/usr/bin/env python3
"""INT-9 icon masters — build the shipping icon assets from the painterly
masters (Wave 13 pilot masters + the six INT-9 generations).

Pipeline per master (the wave's own integration recipes):
  1. White-ground key, flood-fill from the border (Wave 13 size-lab
     `key_rgba`, threshold 242): only near-white connected to the border
     becomes transparent; interior whites (the calendar's lit cell, the
     tag's punched hole, the coin band) survive. Two documented
     exceptions below.
  2. Alpha-bbox crop, then LANCZOS fit into the shipping box, centered
     (the shipped glyphs' own boxes are read off the game's grids, so the
     masters occupy the same visual footprint the glyphs did).
  3. Palette-256 FASTOCTREE save with alpha preserved.

Exceptions (documented in the PR body):
  - droprise-material: the painted ground is a fake-transparency
    CHECKERBOARD (grey + white checks), which defeats border keying.
    It is object-keyed instead: silhouette = the largest connected
    non-background component of a luminance segmentation (ground checks
    segment as background because they are achromatic; the violet
    crystal is chromatic), then the same crop/fit/save.
  - droprise-* masters carry a baked checkerboard-free white ground
    EXCEPT material; all others key by the standard border fill.

Source masters live outside the repo (the wave folders); this script is
run once at build time and only its OUTPUTS (small palette PNGs under
src/assets/icons/) are committed. The verbatim generation prompts for
the six new masters are recorded in the PR body.
"""
import glob
import json
import os
from collections import deque

import numpy as np
from PIL import Image

WT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W13 = os.path.expanduser('~/workspace/cybercache-prep/top-choice/wave13-icons/renders')
GEN = os.path.join(WT, 'int-icons-gen')
OUT = os.path.join(WT, 'src/assets/icons')
os.makedirs(OUT, exist_ok=True)


def gen_file(stem):
    hits = glob.glob(os.path.join(GEN, f'media-generation-{stem}-0-*.png'))
    assert len(hits) == 1, (stem, hits)
    return hits[0]


def key_rgba(path, thresh=242):
    """Border flood-fill white key (Wave 13 size_lab.key_rgba, verbatim logic)."""
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(int)
    h, w = a.shape[:2]
    near_white = a.min(axis=2) > thresh
    bg = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if near_white[y, x] and not bg[y, x]:
                bg[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and near_white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                dq.append((ny, nx))
    out = np.dstack([a, np.where(bg, 0, 255)]).astype('uint8')
    return Image.fromarray(out, 'RGBA')


def key_object_checkerboard(path):
    """Object key for droprise-material's painted checkerboard ground.

    The ground checks are ACHROMATIC (grey/white); the crystal is strongly
    chromatic. Segment chromatic pixels, keep the largest connected
    component (+ anything enclosed by it), feather nothing — the ship
    size is 60px, where the wave's own plates show the object key clean.
    """
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(int)
    h, w = a.shape[:2]
    chroma = a.max(axis=2) - a.min(axis=2)
    fg = chroma > 40
    # largest connected component (iterative flood on a downscaled mask,
    # then nearest-upscale the winning label region is overkill: the
    # crystal is one blob; scan at full res with a label pass via deque
    # from the most-chromatic pixel).
    seed = np.unravel_index(np.argmax(chroma), chroma.shape)
    seen = np.zeros((h, w), bool)
    dq = deque([seed])
    seen[seed] = True
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and fg[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True
                dq.append((ny, nx))
    # fill enclosed holes: background = not-seen reachable from border
    outside = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not seen[y, x] and not outside[y, x]:
                outside[y, x] = True
                dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y, x] and not outside[y, x]:
                outside[y, x] = True
                dq.append((y, x))
    while dq:
        y, x = dq.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and not outside[ny, nx]:
                outside[ny, nx] = True
                dq.append((ny, nx))
    alpha = np.where(outside, 0, 255).astype('uint8')
    out = np.dstack([a, alpha]).astype('uint8')
    return Image.fromarray(out, 'RGBA')


def fit_into(rgba, box_w, box_h, canvas):
    """Crop to alpha bbox, scale to fit (box_w, box_h), center on a square canvas."""
    bbox = rgba.getchannel('A').getbbox()
    assert bbox, 'empty after keying'
    crop = rgba.crop(bbox)
    scale = min(box_w / crop.width, box_h / crop.height)
    nw = max(1, round(crop.width * scale))
    nh = max(1, round(crop.height * scale))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
    out.alpha_composite(crop, ((canvas - nw) // 2, (canvas - nh) // 2))
    return out


def save_pal(rgba, name):
    q = rgba.quantize(colors=256, method=Image.FASTOCTREE)
    path = os.path.join(OUT, name)
    q.save(path, optimize=True)
    return os.path.getsize(path)


report = {}

# Nav sigils: ship box 34x34 on a 34 canvas (rendered 17 CSS px; 2x raster).
NAV = [
    ('home', os.path.join(W13, 'home-top.png')),
    ('pack', os.path.join(W13, 'pack-top.png')),
    ('tag', gen_file('tag')),
    ('person', gen_file('person')),
]
for slug, src in NAV:
    keyed = key_rgba(src)
    img = fit_into(keyed, 34, 34, 34)
    report[f'nav-{slug}'] = save_pal(img, f'nav-{slug}.png')

# Calendar display hero: ships at 40 CSS px; the master is square-ish in a
# 80x80 box (2x).
keyed = key_rgba(os.path.join(W13, 'calendar-top.png'))
report['display-calendar'] = save_pal(fit_into(keyed, 80, 80, 80), 'display-calendar.png')

# Drop-rise markers: 60x60 (rendered 30 CSS px, 2x). Grayscale masters for
# material/essence/fragment/scrap (re-tinted at runtime by hue rotation);
# credits + crate ship in their fixed identity colors.
DR_GRAY = [
    ('material', None),  # special: object key below
    ('essence', gen_file('droprise-essence')),
    ('fragment', gen_file('droprise-fragment')),
    ('scrap', gen_file('droprise-scrap')),
]
for kind, src in DR_GRAY:
    if kind == 'material':
        keyed = key_object_checkerboard(os.path.join(W13, 'droprise-material-top.png'))
    else:
        keyed = key_rgba(src)
    img = fit_into(keyed, 60, 60, 60)
    gray = img.convert('L').convert('RGBA')
    gray.putalpha(img.getchannel('A'))
    report[f'drop-{kind} (gray)'] = save_pal(gray, f'drop-{kind}.png')

keyed = key_rgba(gen_file('droprise-credits'))
report['drop-credits'] = save_pal(fit_into(keyed, 60, 60, 60), 'drop-credits.png')
keyed = key_rgba(os.path.join(W13, 'droprise-crate-top.png'))
report['drop-crate'] = save_pal(fit_into(keyed, 60, 60, 60), 'drop-crate.png')

print(json.dumps(report, indent=1))
print('total', sum(report.values()))
