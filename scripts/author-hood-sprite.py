#!/usr/bin/env python3
"""Author the Hood head-variant sprite (Hero Pass H1, Q3).

The shipped hood was the stock helmet with two flat tan slabs
draped over it — it read as a rendering error at every size
(Hero Pass AUDIT). This script re-authors it as a real shaped
cowl, painted over the Standard Issue visor head
(rig-hunter-head.png) following the pxl-craft standard
(~/workspace/custom-skills/pxl-craft/SKILL.md): a shaped
silhouette, a hue-shifted cloth ramp (shadows cool toward
olive-brown, highlights warm), cluster-placed folds (a valley
of shadow with a lit ridge beside it — never a lone line or a
dither), and a selective outline in the cloth's own darkest
tone.

The art is DATA: the hood is declared below as row spans +
fold paths + a clasp, keyed to the shared 86x88 head canvas
and neck seat every head variant uses (headParts.ts). A future
head shape authors the same way — spans in, sprite out — no
engine code changes. Output: src/assets/pixel/sprites/
hunter-head-hood.png (same sprite id, same canvas).

Run: python3 scripts/author-hood-sprite.py
"""
from PIL import Image
import os

ROOT = os.path.join(os.path.dirname(__file__), '..')
SRC = os.path.join(ROOT, 'src/assets/pixel/sprites/rig-hunter-head.png')
DST = os.path.join(ROOT, 'src/assets/pixel/sprites/hunter-head-hood.png')
W, H = 86, 88

# ─── The cloth ramp (hue-shifted: deep tones cool, top warm) ──
EDGE = (38, 29, 18, 255)        # selout — the cloth's own darkest
DEEP = (66, 54, 32, 255)        # fold cores, opening depth, hem
SHADOW = (104, 86, 48, 255)     # shaded planes
BASE = (148, 122, 76, 255)      # the cloth's identity tone
LIGHT = (186, 158, 102, 255)    # lit planes
HIGHLIGHT = (216, 190, 128, 255)  # crown catch-light
CLASP_DARK = (92, 74, 30, 255)
CLASP_GOLD = (196, 152, 62, 255)  # brass throat clasp

# ─── The silhouette: row spans (y -> [(x0, x1), ...]) ────────
# A cowl over the helm: proud of the crown, a full back drape
# falling to the shoulders with a clustered hem, the face
# opening arcing over the visor and framing visor + snout, and
# the drape's front corner coming down to a point at the
# throat, where the clasp sits. One connected mass throughout.
def spans():
    s = {}
    def row(y, *xr):
        s.setdefault(y, []).extend(xr)
    # Crown cap (proud of the helm by ~2px at the back-top)
    row(0, (26, 44)); row(1, (22, 50)); row(2, (19, 55)); row(3, (17, 58))
    row(4, (15, 60)); row(5, (14, 61)); row(6, (13, 62)); row(7, (12, 61))
    row(8, (11, 60)); row(9, (10, 59)); row(10, (9, 58)); row(11, (9, 57))
    row(12, (8, 56)); row(13, (8, 55)); row(14, (7, 54)); row(15, (7, 53))
    row(16, (6, 52)); row(17, (6, 51)); row(18, (6, 50)); row(19, (6, 49))
    row(20, (5, 48)); row(21, (5, 47)); row(22, (5, 46)); row(23, (5, 45))
    # Visor band — the opening's right edge holds at x43 (the
    # slit starts ~x47) so the whole visor reads inside the cowl.
    for y in range(24, 40):
        row(y, (5, 43))
    # Snout band (the snout plate's left edge sits ~x45)
    for y in range(40, 48):
        row(y, (5, 44))
    for y in range(48, 52):
        row(y, (5, 45))
    # Throat corner: the drape steps out to its point, clasped.
    row(52, (4, 47)); row(53, (4, 47)); row(54, (4, 47)); row(55, (4, 47))
    row(56, (4, 46)); row(57, (4, 46)); row(58, (4, 45)); row(59, (4, 44))
    row(60, (4, 42)); row(61, (4, 40))
    # Back drape to the shoulders, hem edge wandering in clusters
    row(62, (4, 38)); row(63, (4, 37)); row(64, (3, 35)); row(65, (3, 36))
    row(66, (3, 34)); row(67, (3, 33)); row(68, (3, 34)); row(69, (3, 31))
    row(70, (3, 32)); row(71, (3, 30)); row(72, (3, 29)); row(73, (3, 30))
    row(74, (3, 27)); row(75, (3, 28)); row(76, (3, 26)); row(77, (3, 25))
    row(78, (3, 26)); row(79, (3, 23))
    return s

SPANS = spans()
MASK = {(x, y) for y, xr in SPANS.items() for (a, b) in xr for x in range(a, b + 1)}

# ─── Folds: a valley of shadow with a lit ridge on its light
# side. Paths drift as they fall — cloth, not rulers. ─────────
def fold_path(x0, y0, x1, y1):
    """Cells of a fold valley, 2 wide, drifting x0->x1 over y0..y1."""
    cells = {}
    for y in range(y0, y1 + 1):
        cx = round(x0 + (x1 - x0) * (y - y0) / max(1, y1 - y0))
        cells[y] = cx
    return cells

FOLD_A = fold_path(16, 27, 13, 61)   # the long back fold
FOLD_B = fold_path(27, 35, 24, 56)   # the shorter second fold
VALLEY = set()
RIDGE = set()
CORE = set()
for path in (FOLD_A, FOLD_B):
    for y, cx in path.items():
        VALLEY.add((cx, y)); VALLEY.add((cx + 1, y))
        CORE.add((cx + 1, y))
        RIDGE.add((cx - 1, y))
# Crown fold: a short diagonal valley running off the peak,
# sitting where the crown's light field breaks.
for i in range(6):
    VALLEY.add((26 + i, 9 + i)); VALLEY.add((27 + i, 9 + i))
    RIDGE.add((25 + i, 9 + i))

# Hem clusters: where the drape's bottom edge doubles over
# into its own shade — irregular placed chunks.
HEM_CLUSTERS = set()
for cx, cy, w in ((6, 68, 5), (15, 71, 4), (9, 74, 6), (20, 67, 3), (5, 77, 4), (17, 76, 5)):
    for yy in range(cy, cy + 2):
        for xx in range(cx, cx + w):
            HEM_CLUSTERS.add((xx, yy))

# The throat clasp (brass): proud of the drape's front point.
CLASP = {(x, y) for y in range(55, 60) for x in range(44, 49)} - {(44, 55), (48, 59)}
CLASP_FACE = {(x, y) for y in range(56, 59) for x in range(45, 48)}


def tone(x, y):
    """The ramp by light + form. Light from top-left."""
    if (x, y) in CLASP:
        return CLASP_GOLD if (x, y) in CLASP_FACE else CLASP_DARK
    # Silhouette boundary: selective outline in the cloth's dark.
    if any((x + dx, y + dy) not in MASK for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
        return EDGE
    if (x, y) in CORE:
        return DEEP
    if (x, y) in VALLEY:
        return SHADOW
    if (x, y) in RIDGE:
        return LIGHT
    # Opening depth: the wall just inside the face opening
    # faces away from the light — deep at the edge, shaded in.
    main_right = SPANS[y][0][1]
    if 18 <= y <= 51:
        if x >= main_right - 1:
            return DEEP
        if x >= main_right - 4:
            return SHADOW
    # Crown light, sculpted on the dome (not row bands): the
    # lit field wraps the top-left of the crown.
    dome = (x - 6) + ((y - 2) // 3) * 6
    if y <= 20 and dome < 34:
        return HIGHLIGHT
    if y <= 22 and dome < 58:
        return LIGHT
    if y <= 12 and x <= 56:
        return LIGHT
    # The front plane of the drape (right of fold B) sits in
    # shade; the back plane keeps the base tone.
    if 22 <= y <= 55 and x >= 30:
        return SHADOW
    # The lower drape falls away from the light; its hem band
    # carries a few deep clusters where the cloth doubles over
    # (placed chunks with a cause, never a formula texture).
    if (x, y) in HEM_CLUSTERS:
        return DEEP
    if y >= 58:
        return SHADOW
    return BASE


def main():
    img = Image.open(SRC).convert('RGBA')
    assert img.size == (W, H), img.size
    px = img.load()
    for (x, y) in MASK:
        px[x, y] = tone(x, y)
    img.save(DST)
    print(f'wrote {DST} ({os.path.getsize(DST)} bytes, {len(MASK)} hood cells)')


if __name__ == '__main__':
    main()
