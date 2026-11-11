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


def build_int9():
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


# ── INT-10 functional paintings (Top-Choice Wave 13 tranche 2) ─────────────
# The 76 everyday functional glyphs (owner REBUILD ruling 2026-11-11: the
# paintings won the side-by-side). Same machinery as INT-9 above — border
# key (scipy connected components, the tranche-2 postprocess recipe: the
# identical border-connected set, fast enough at 1600x1600), alpha-bbox
# crop, LANCZOS fit into the ship box, palette-256 FASTOCTREE — extended
# with the variant bake: for every glyph whose call sites carry state
# through tint (tranche-2 NOTES §6 state census), one asset per deliberate
# color is baked by LUMINANCE RE-TINT at build time — the painting's
# luminance runs through the five-stop ramp dropRisePalette builds from
# the state color (iconTint.ts's dropRiseTintRamp/rampColorAt, ported
# verbatim incl. hueLerp). No runtime tinting of paintings anywhere.
#
# Ship box: 64x64 canvas for every functional painting (the glyphs render
# at 10-40 CSS px; 64 is 2x of the 26-30px row/display class and ~4x of
# the 13-17px inline class).
#
# Master sources: tranche-2 renders/ (68 fresh + cog-v2/gun-v2/grid-v2/
# halfDisc-v2 correctives) and the Wave 13 pilot renders/ (anvil, search,
# infinity, skull). Masters are stored OPAQUE (-top.png); keying happens
# here, at ship time, exactly as the pilot did.
# Glyphs with no call sites (blob, boot, gift, power) are NOT built —
# their paintings stay sheet-complete in the wave folders.

FN_CANVAS = 64
T2_RENDERS = os.path.expanduser('~/workspace/cybercache-prep/top-choice/wave13-icons/tranche2/renders')
W13_RENDERS = os.path.expanduser('~/workspace/cybercache-prep/top-choice/wave13-icons/renders')

# FIXED glyphs (census §6/§7): every appearance resolves to one effective
# look — the base painting ships as-is.
FN_FIXED = [
    'anvil', 'chart', 'check', 'chevL', 'chevU', 'chip', 'help', 'info',
    'lock', 'pencil', 'plus', 'scrap', 'search', 'stop', 'swap', 'vial', 'x',
]

# Market stop-rail glyphs: census FIXED under the INT-9 nav pattern — the
# rail's two states (active #050608 on amber / inactive #B8B0A8) bake as a
# variant pair alongside the base painting.
FN_RAIL = ['badge', 'basket', 'vendor']
FN_RAIL_COLORS = ['#050608', '#B8B0A8']

# VARIANTS glyphs (census §6): deliberate color sets, exact hex.
RARITY5 = ['#A5A7B5', '#7CFC00', '#5AA7FF', '#FF9DF5', '#FFEA3A']
ELEMENTS6 = ['#9CA3AF', '#EF4444', '#3B82F6', '#22C55E', '#06B6D4', '#8B5CF6']
ACCENT7 = ['#7CFC00', '#FF4B5C', '#FF9000', '#00E5FF', '#FFB300', '#B66BFF', '#5AA7FF']
LOADOUT11 = sorted(set(RARITY5 + ELEMENTS6 + ['#8A847C']))
FN_VARIANTS = {
    'armor': ['#A855F7'],
    'barEmpty': ['#FFB300'],
    'barFill': ['#FFB300'],
    'book': ['#FF9000', '#3B82F6', '#EAE3D1', '#A79D8E', '#B4AB9C'],
    'bullseye': ['#FF4B5C', '#FF9000', '#8A847C', '#7CFC00', '#00E5FF'],
    'burst': ['#FF4B5C'],
    'chevD': ['#F2C063', '#7FD4FF', '#B08968', '#FF4B5C', '#FF8FA3', '#B18CFF', '#8FE388'],
    'chevR': ['#8A847C', '#FF9000', '#A79D8E'],
    'clock': ['#F2C063', '#3B82F6'],
    'cog': ['#3B82F6', '#A855F7', '#B8B0A8', '#FF9000'],
    'crate': ['#7DD0F0', '#7CFC00', '#FF9000', '#FF4B5C', '#8A847C'],
    'cross': ['#FF9000', '#7CFC00', '#FFB300'],
    'crosshair': ['#FF4B5C', '#FF9000', '#8A847C', '#B8B0A8'],
    'crown': ['#FF9000', '#8A847C'],
    'diamond': sorted(set(LOADOUT11 + ['#FF9000', '#00E5FF'])),
    'diamondFill': ['#B66BFF'],
    'diamondIn': ['#FF9000', '#7CFC00', '#8A847C', '#00E5FF'],
    'flag': ['#FF9000'],
    'flask': ['#B8B0A8'],
    'gem': LOADOUT11,
    'grid': ['#FF4B5C', '#F7D20B', '#FFB300'],
    'gun': ['#FF9000', '#8A847C'],
    'halfDisc': ['#FFB300'],
    'hammer': ['#2EC4B6', '#FF9000', '#B08968', '#7CFC00', '#B8B0A8'],
    'hatch': ['#00E5FF', '#FFB300'],
    'hatchH': ['#FF4B5C'],
    'heart': ['#FF4B5C', '#7CFC00', '#FF8FA3'],
    'hex': ['#B18CFF', '#00E5FF'],
    'infinity': ['#C026D3', '#E879F9', '#FF9000', '#B8B0A8'],
    'pause': ['#B8B0A8', '#FF9000'],
    'pawn': ['#00E5FF'],
    'pick': ['#E8B33C', '#FF9000', '#B8B0A8'],
    'pin': ['#FF9000'],
    'recycle': sorted(set(RARITY5 + ['#A855F7', '#FF9000', '#FF4B5C'])),
    'ring': ['#B8B0A8'],
    'rings': sorted(set(LOADOUT11 + ['#FF4B5C', '#FF9000'])),
    'shield': sorted(set(LOADOUT11 + ['#FF9000', '#050608', '#B8B0A8'])),
    'signal': ['#A855F7', '#00E5FF', '#5AA7FF', '#F7D20B', '#FF9000'],
    'skull': ['#FF4B5C'],
    'star5': ACCENT7,
    'swirl': ['#F9A8D4'],
    'target': ['#FF9000'],
    'triR': ['#5AA7FF'],
    'trophy': ['#FF9000', '#8A847C'],
    'truck': ['#FF9000', '#8A847C'],
    'warn': ['#B66BFF'],
    'waves': ['#00E5FF', '#5AA7FF'],
    'wheel': ['#8A847C', '#B8B0A8', '#FF9000'],
    'wrench': ['#050608', '#B8B0A8', '#FF9000', '#8A847C'],
}

FN_PILOT_GLYPHS = {'anvil', 'search', 'infinity', 'skull'}
FN_CORRECTIVE_STEMS = {'cog': 'cog-v2', 'gun': 'gun-v2', 'grid': 'grid-v2', 'halfDisc': 'halfDisc-v2'}


def fn_master_path(glyph):
    if glyph in FN_PILOT_GLYPHS:
        return os.path.join(W13_RENDERS, f'{glyph}-top.png')
    stem = FN_CORRECTIVE_STEMS.get(glyph, glyph)
    return os.path.join(T2_RENDERS, f'{stem}-top.png')


def fn_key_rgba(path):
    """Border-connected white key via scipy label (tranche-2 recipe)."""
    from scipy import ndimage
    im = Image.open(path).convert('RGBA')
    a = np.asarray(im).astype(int)
    near_white = a[:, :, :3].min(axis=2) > 242
    lab, _n = ndimage.label(near_white, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]]))
    border = set(np.unique(np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border)) if border else np.zeros(near_white.shape, bool)
    out = np.asarray(im).copy()
    out[bg, 3] = 0
    return Image.fromarray(out.astype('uint8'), 'RGBA')


# ── hueLerp / dropRisePalette / ramp ports (weaponCardCompositor.ts +
# iconTint.ts, verbatim math) ──────────────────────────────────────────────

def _hex_rgb(hexs):
    n = int(hexs[1:], 16)
    return (n >> 16) & 255, (n >> 8) & 255, n & 255


def _rgb_hex(r, g, b):
    return '#%02x%02x%02x' % (round(r), round(g), round(b))


def _hex_lerp(a, b, t):
    ar, ag, ab = _hex_rgb(a)
    br, bg, bb = _hex_rgb(b)
    return _rgb_hex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)


def _hex_to_hsl(hexs):
    r, g, b = [v / 255 for v in _hex_rgb(hexs)]
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    d = mx - mn
    if not d:
        return 0.0, 0.0, l
    s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
    if mx == r:
        h = ((g - b) / d + 6) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return h * 60, s, l


def _hsl_to_hex(h, s, l):
    hn = ((h % 360) + 360) % 360
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((hn / 60) % 2 - 1))
    m = l - c / 2
    if hn < 60:
        r, g, b = c, x, 0
    elif hn < 120:
        r, g, b = x, c, 0
    elif hn < 180:
        r, g, b = 0, c, x
    elif hn < 240:
        r, g, b = 0, x, c
    elif hn < 300:
        r, g, b = x, 0, c
    else:
        r, g, b = c, 0, x
    return _rgb_hex((r + m) * 255, (g + m) * 255, (b + m) * 255)


def _hue_toward(frm, target, deg):
    diff = ((target - frm + 540) % 360) - 180
    step = (1 if diff >= 0 else -1) * min(abs(diff), deg)
    return frm + step


def _hue_lerp(a, b, t):
    straight = _hex_lerp(a, b, t)
    if t <= 0:
        return straight
    ah, asat, al = _hex_to_hsl(a)
    if asat < 0.04:
        return straight
    _, _, bl = _hex_to_hsl(b)
    _, ss, target_l = _hex_to_hsl(straight)
    rng = (1 - al) if bl > al else al
    frac = min(1, abs(target_l - al) / rng) if rng > 0 else 0
    shift = 24 * frac
    h, s = ah, ss
    if target_l < al:
        h = _hue_toward(ah, 250, shift)
        s = min(1, ss * (1 + 0.15 * frac))
    elif target_l > al:
        h = _hue_toward(ah, 55, shift)
        s = ss * (1 - 0.3 * frac)
    return _hsl_to_hex(h, s, target_l)


def _tint_ramp(base):
    """dropRisePalette(base) stops K/D/B/L/W, each converted to
    (lumThreshold, h, s, l) and sorted by luminance — dropRiseTintRamp."""
    pal = {
        'K': _hue_lerp(base, '#000000', 0.72),
        'D': _hue_lerp(base, '#000000', 0.35),
        'B': base,
        'L': _hue_lerp(base, '#FFFFFF', 0.35),
        'W': _hue_lerp(base, '#FFFFFF', 0.75),
    }
    stops = []
    for key in ('K', 'D', 'B', 'L', 'W'):
        r, g, b = _hex_rgb(pal[key])
        h, s, l = _hex_to_hsl(pal[key])
        stops.append({'lum': (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, 'h': h, 's': s, 'l': l})
    stops.sort(key=lambda st: st['lum'])
    return stops


def fn_retint(rgba, base_hex):
    """Bake one variant: the painting's per-pixel luminance runs through
    the base color's ramp (rampColorAt, HSL-interpolated, hue unwrapped
    across stops). Alpha untouched."""
    stops = _tint_ramp(base_hex)
    xs = np.array([st['lum'] for st in stops])
    # unwrap hue around the first stop so interpolation never wraps
    hs = [stops[0]['h']]
    for st in stops[1:]:
        h = st['h']
        while h - hs[-1] > 180:
            h -= 360
        while h - hs[-1] < -180:
            h += 360
        hs.append(h)
    ss = np.array([st['s'] for st in stops])
    ls = np.array([st['l'] for st in stops])
    a = np.asarray(rgba).astype(float)
    lum = (0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]) / 255
    h = np.interp(lum, xs, np.array(hs))
    s = np.interp(lum, xs, ss)
    l = np.interp(lum, xs, ls)
    hn = ((h % 360) + 360) % 360 / 60
    c = (1 - np.abs(2 * l - 1)) * s
    x = c * (1 - np.abs(hn % 2 - 1))
    m = l - c / 2
    zero = np.zeros_like(c)
    conds = [hn < 1, hn < 2, hn < 3, hn < 4, hn < 5]
    r = np.select(conds, [c, x, zero, zero, x], default=c)
    g = np.select(conds, [x, c, c, x, zero], default=zero)
    b = np.select(conds, [zero, zero, x, c, c], default=x)
    out = np.dstack([(r + m) * 255, (g + m) * 255, (b + m) * 255, a[:, :, 3]]).round().clip(0, 255).astype('uint8')
    return Image.fromarray(out, 'RGBA')


def fn_save(rgba, name):
    q = rgba.quantize(colors=256, method=Image.FASTOCTREE)
    path = os.path.join(OUT, name)
    q.save(path, optimize=True)
    return os.path.getsize(path)


def build_functional():
    os.makedirs(OUT, exist_ok=True)
    report = {}
    glyphs = {}
    for glyph in FN_FIXED:
        glyphs[glyph] = []
    for glyph in FN_RAIL:
        glyphs[glyph] = list(FN_RAIL_COLORS)
    for glyph, colors in FN_VARIANTS.items():
        glyphs[glyph] = list(colors)
    for glyph, colors in sorted(glyphs.items()):
        src = fn_master_path(glyph)
        assert os.path.exists(src), (glyph, src)
        keyed = fn_key_rgba(src)
        base_img = fit_into(keyed, FN_CANVAS, FN_CANVAS, FN_CANVAS)
        report[f'fn-{glyph}'] = fn_save(base_img, f'fn-{glyph}.png')
        for color in colors:
            slug = color[1:].lower()
            variant = fn_retint(base_img, color)
            report[f'fn-{glyph}--{slug}'] = fn_save(variant, f'fn-{glyph}--{slug}.png')
    # Generated registry data for src/lib/pixel/iconPaintings.ts.
    data = {
        'fixed': sorted(FN_FIXED),
        'rail': {g: FN_RAIL_COLORS for g in sorted(FN_RAIL)},
        'variants': {g: FN_VARIANTS[g] for g in sorted(FN_VARIANTS)},
        'canvas': FN_CANVAS,
    }
    gen_path = os.path.join(WT, 'src/lib/pixel/iconPaintingsData.ts')
    with open(gen_path, 'w') as f:
        f.write('// GENERATED by scripts/build-icon-masters.py (INT-10 functional\n')
        f.write('// section) from the tranche-2 state census (NOTES §6) — the color\n')
        f.write('// sets are the census\'s deliberate hex sets, verbatim. Regenerate\n')
        f.write('// with: python3 scripts/build-icon-masters.py functional\n\n')
        f.write('export const FN_CANVAS = %d;\n\n' % FN_CANVAS)
        f.write('export const FN_FIXED_GLYPHS: readonly string[] = %s;\n\n' % json.dumps(data['fixed']))
        f.write('export const FN_RAIL_COLORS: Record<string, readonly string[]> = %s;\n\n' % json.dumps(data['rail'], indent=1))
        f.write('export const FN_VARIANT_COLORS: Record<string, readonly string[]> = %s;\n' % json.dumps(data['variants'], indent=1))
    print(json.dumps({'files': len(report), 'total': sum(report.values())}, indent=1))
    return report


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'functional':
        build_functional()
    else:
        build_int9()
