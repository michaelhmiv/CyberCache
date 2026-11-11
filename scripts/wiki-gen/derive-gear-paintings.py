#!/usr/bin/env python3
"""Top-Choice integration INT-2 — derive the gear paintings (in-game
sprites + wiki sources) from the adopted Top-Choice masters.

WHAT THIS PRODUCES (committed beside this script / in the game tree):
  src/assets/pixel/sprites/gear-{shield,relic,class-mod,ordnance}-<form>.png x29
      the in-game sprite files (native master size, palette-256, true alpha)
  src/assets/pixel/sprites/gear-<kind>-<form>.anchors.json x29
      pixel-key.py anchor sidecars for those sprites
  scripts/wiki-gen/assets/gear/<plate-name>.png x29
      the wiki generator's painted sources, at Wave 15's published plate
      geometry (480x280 shields/relics, 480x240 class mods/ordnance)
  scripts/wiki-gen/assets/gear/sources.json
      provenance record for every file (master path, recipe, sizes, bytes)

RECIPE (Wave 15's printed derivation recipe, wave15-derived/NOTES.md —
the same one scratch/derive.py proved against the published plates):
  1. KEY the white-ground master with key_white (below; the cache-screen
     wave's validated Wave 9-lineage keying, vendored verbatim).
     ANCIENT MODULE EXCEPTION: its master wears a *painted* fake
     checkerboard ground (not border-connected, so key_white cannot
     remove it — Wave 4 NOTES + Wave 15's object-key call). It is
     object-keyed instead: the largest connected opaque component of
     the keyed master — the relic itself; the checkerboard squares are
     disconnected specks by construction. Asserted in-script.
  2. CROP to the keyed alpha > 8 bounding box.
  3. IN-GAME SPRITE: the cropped content at native size, palette-256
     FASTOCTREE, PNG optimize=True — the program's standing compression
     form, now with true alpha from step 1. (The cache-screen slice
     INT-7 ships its sprites at native size the same way.)
  4. WIKI SOURCE: the cropped content fitted (LANCZOS) into today's
     plate box minus 28 px, centered on a transparent canvas of the
     plate size, palette-256 FASTOCTREE — exactly Wave 15's
     derive_card. The wiki generator (images-w5.ts) re-encodes these
     sources verbatim, so the published plates are the derived plates.

ELEMENT COLORWAYS (in-game): each sprite's palette is derived from the
adopted master Palette by the waves' zone rules, executed in palette
space (the Wave 2/3/6 method):
  - shields: palette entries classified GLOW (hue 185-250 deg, sat >=
    0.45, val >= 0.62 — Wave 3's rule, run on every form per its own
    palette) are re-hued per element with Wave 3's exact targets
    (Kinetic 30 sat-capped 0.08; Fire 11; Shock 217; Corrosive 142;
    Cryo 189; Void 258), saturation/value pattern preserved; the
    near-white heart stays unswapped by design (it never classifies
    as glow). The in-game module (src/lib/pixel/gearPainted.ts) holds
    the resulting per-element tables as data.
  - ordnance: palette entries classified GLOW by Wave 6's zone rule
    (warm seat above the form's body hue ceiling) are remapped by
    Wave 6's luminance-preserving core->accent blend toward each
    element's ELEMENT_VISUALS core/accent hexes. The rule is measured
    per form at integration, exactly as Wave 6's NOTES prescribe
    ("the same per-form measurement discipline applies"): Spike keeps
    its published rule verbatim (body hue ceiling ~18 deg); Disc
    (Shock master), Dart (Void) and Canister (Corrosive) measure
    their body ceilings from their own palettes (the 97.5th-percentile
    hue of entries OUTSIDE the master element's family band), and the
    glow window is the band above it. The seat of each form is its
    lit core/eye/window — the only content painted in the element
    family above the body. Per-form zone stats are printed and land
    in sources.json.

ADOPTED MASTERS (owner adoption 2026-11-11):
  - Shields:  wave3-shields/renders/<form>-top.png x5
              (1,585,353 B palette-256 at native size; Absorb keeps its
              plasma-orb core exactly as rendered — attempt 1 master.)
  - Relics:   wave4-relics/renders/<slug>-top.png x16 (3,550,449 B;
              Void Prism keeps its nebula eye exactly as rendered.)
  - Class mods: wave5-classmods/renders/classmod-<tree>-top.png x4
              (896,489 B; the deck windows stay EMPTY — nothing is
              painted into them; the live deck is code, drawn at
              runtime to the measured window rects in gearPainted.ts.)
  - Ordnance: wave6-ordnance/renders/<form>-top.png x4 (680,734 B).

CLASS-MOD WINDOW RECTS: measured on the keyed masters with Wave 5's
own deck-proof method (largest near-black component inside each
casing's canonical zone), as fractions of the content bbox — printed
here and recorded in sources.json; gearPainted.ts carries the same
numbers as its measured-window data (the integration-time mapping
Wave 5's NOTES prescribe).

RE-RUNNING: needs the Top-Choice prep tree (the masters live outside
the repo). Set TOP_CHOICE_ROOT or pass it as argv[1]; default
~/workspace/cybercache-prep/top-choice. Python deps: PIL, numpy, scipy.
Output is deterministic: same masters in, same bytes out.
"""
import colorsys
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
SPRITE_DIR = os.path.join(REPO_ROOT, "src", "assets", "pixel", "sprites")
OUT_ROOT = os.path.join(SCRIPT_DIR, "assets", "gear")
TC = (
    sys.argv[1]
    if len(sys.argv) > 1
    else os.environ.get(
        "TOP_CHOICE_ROOT",
        os.path.expanduser("~/workspace/cybercache-prep/top-choice"),
    )
)

ELEMENTS = ["Kinetic", "Fire", "Shock", "Corrosive", "Cryo", "Void"]
ELEMENT_VISUALS = {  # src/constants/visualAssets.ts ELEMENT_VISUALS
    "Kinetic": ((0xB8, 0xB0, 0xA8), (0xF5, 0xF5, 0xF5)),
    "Fire": ((0xFF, 0x4B, 0x1F), (0xFF, 0xEA, 0x3A)),
    "Shock": ((0x3B, 0x82, 0xF6), (0xA5, 0xF3, 0xFC)),
    "Corrosive": ((0x22, 0xC5, 0x5E), (0xC4, 0xFF, 0x2F)),
    "Cryo": ((0x06, 0xB6, 0xD4), (0xE0, 0xF2, 0xFE)),
    "Void": ((0x8B, 0x5C, 0xF6), (0xFF, 0x9D, 0xF5)),
}
SHIELD_FORMS = ["standard", "nova", "absorb", "amp", "turtle"]
RELIC_SLUGS = [
    "vault-chip", "data-shard", "neural-key", "cache-relic", "echo-stone",
    "void-prism", "circuit-totem", "ancient-module", "scrap-core",
    "glitched-token", "ethereal-drive", "quantum-fragment",
    "precision-calipers", "servo-bench-rig", "reclaimer-head",
    "prime-laboratory",
]
CLASS_MOD_TREES = ["gunslinger", "demolition", "scavenger", "fixer"]
ORDNANCE_FORMS = ["spike", "disc", "dart", "canister"]
ORDNANCE_MASTER_ELEMENT = {
    "spike": "Fire", "disc": "Shock", "dart": "Void", "canister": "Corrosive",
}
# Wave 5 canonical deck origins (design units, 232x112 space) — the zone
# each casing's window is searched in, as in plates_build.py deck_proof.
DECK_ORIGINS = {
    "gunslinger": (122, 33), "demolition": (120, 36),
    "scavenger": (77, 37), "fixer": (100, 44),
}
PLATE_BOXES = {  # today's published wiki plate geometry (Wave 15 census)
    "shield": (480, 280), "relic": (480, 280),
    "class-mod": (480, 240), "ordnance": (480, 240),
}


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


def object_key(keyed):
    """Ancient Module only: keep the largest connected opaque component
    (the relic); drop the painted checkerboard's disconnected squares.
    Returns (image, kept_fraction_of_opaque_px)."""
    a = np.asarray(keyed)[:, :, 3]
    opaque = a > 8
    lab, n = ndimage.label(opaque)
    if n <= 1:
        return keyed, 1.0
    sizes = ndimage.sum(opaque, lab, range(1, n + 1))
    keep = 1 + int(np.argmax(sizes))
    mask = lab == keep
    out = np.asarray(keyed).copy()
    out[~mask] = (0, 0, 0, 0)
    return Image.fromarray(out, "RGBA"), float(mask.sum() / opaque.sum())


def key_and_crop(master_path, slug):
    im = Image.open(master_path).convert("RGB")
    keyed = key_white(im)
    note = "key_white"
    if slug == "ancient-module":
        keyed, kept = object_key(keyed)
        note = f"key_white + object-key (largest component, kept {kept:.4f} of opaque px)"
        assert kept > 0.5, f"object-key kept only {kept:.3f} — the relic is not the largest component"
    a = np.asarray(keyed)[:, :, 3]
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        raise ValueError(f"empty key: {master_path}")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return keyed.crop(box), box, note


def pal_save(im, out_path):
    pal = im.quantize(colors=256, method=Image.FASTOCTREE)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    pal.save(out_path, optimize=True)
    return pal


def fit_into(content, box_w, box_h):
    scale = min(box_w / content.width, box_h / content.height)
    nw = max(1, round(content.width * scale))
    nh = max(1, round(content.height * scale))
    return content.resize((nw, nh), Image.LANCZOS)


def derive_wiki_source(content, kind, out_path):
    """Wave 15 derive_card: bare object fitted into the plate box minus
    28 px, centered on transparency, palette-256."""
    W, H = PLATE_BOXES[kind]
    fitted = fit_into(content, W - 28, H - 28)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.alpha_composite(fitted, ((W - fitted.width) // 2, (H - fitted.height) // 2))
    pal_save(canvas, out_path)
    return (W, H)


# ---------------------------------------------------------------------------
# Anchors — pixel-key.py's compute_anchors, vendored (same alpha-mask
# semantics; the sidecars are that script's output shape).
# ---------------------------------------------------------------------------
def compute_anchors(img):
    w, h = img.size
    alpha = np.asarray(img.split()[3]).astype(np.int64)
    mask = alpha >= 32
    if mask.sum() == 0:
        raise ValueError("no opaque pixels")
    aw = np.where(mask, alpha, 0)
    total = aw.sum()
    ys, xs = np.nonzero(mask)
    cx = float((aw.sum(axis=0) * np.arange(w)).sum() / total)
    cy = float((aw.sum(axis=1) * np.arange(h)).sum() / total)
    top_row, bottom_row, right_col = int(ys.min()), int(ys.max()), int(xs.max())
    band = max(1, int((bottom_row - top_row) * 0.15))

    def band_centroid_x(y0, y1):
        sub = aw[y0 : y1 + 1]
        s = sub.sum()
        return float((sub.sum(axis=0) * np.arange(w)).sum() / s) if s else cx

    def col_centroid_y(x):
        col = aw[:, x]
        s = col.sum()
        return float((col * np.arange(h)).sum() / s) if s else cy

    grip_mask = mask.copy()
    grip_mask[:, int(w * 0.45) + 1 :] = False
    grip_mask[: int(h * 0.45), :] = False
    gw = np.where(grip_mask, alpha, 0)
    if gw.sum():
        gx = float((gw.sum(axis=0) * np.arange(w)).sum() / gw.sum())
        gy = float((gw.sum(axis=1) * np.arange(h)).sum() / gw.sum())
    else:
        gx, gy = cx, cy

    fx = lambda v: round(v / max(1, w - 1), 4)
    fy = lambda v: round(v / max(1, h - 1), 4)
    return {
        "feet": {"x": fx(band_centroid_x(max(0, bottom_row - band), bottom_row)), "y": 1.0},
        "centerMass": {"x": fx(cx), "y": fy(cy)},
        "muzzle": {"x": 1.0, "y": fy(col_centroid_y(right_col))},
        "lootPoint": {"x": fx(band_centroid_x(top_row, min(h - 1, top_row + band))), "y": 0.0},
        "grip": {"x": fx(gx), "y": fy(gy)},
    }


# ---------------------------------------------------------------------------
# HSV helpers (vectorized; same math as wave6-ordnance/zone_proof.py)
# ---------------------------------------------------------------------------
def rgb_to_hsv(arr):
    a = arr.astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    df = mx - mn
    h = np.zeros_like(mx)
    m = (df > 0) & (mx == r)
    h[m] = (60 * ((g - b)[m] / df[m]) + 360) % 360
    m = (df > 0) & (mx == g)
    h[m] = 60 * ((b - r)[m] / df[m]) + 120
    m = (df > 0) & (mx == b)
    h[m] = 60 * ((r - g)[m] / df[m]) + 240
    s = np.where(mx > 0, df / np.maximum(mx, 1e-9), 0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    h = (h % 360) / 60.0
    c = v * s
    x = c * (1 - np.abs(h % 2 - 1))
    z = np.zeros_like(c)
    conds = [(h < 1), (h < 2), (h < 3), (h < 4), (h < 5), (h < 6)]
    rs = np.select(conds, [c, x, z, z, x, c])
    gs = np.select(conds, [x, c, c, x, z, z])
    bs = np.select(conds, [z, z, x, c, c, x])
    m = v - c
    return np.stack([rs + m, gs + m, bs + m], axis=-1)


def palette_of(pal_img):
    pal = np.asarray(pal_img.getpalette()[: 256 * 3]).reshape(256, 3).astype(np.int64)
    counts = np.bincount(np.asarray(pal_img).ravel(), minlength=256)
    return pal, counts


# ---------------------------------------------------------------------------
# Shield colorways — Wave 3's zone rule + swap targets, verbatim.
# ---------------------------------------------------------------------------
SHIELD_SWAP_TARGETS = {  # wave3 plates2.py ELEMENTS: (hue deg, sat cap|None)
    "Kinetic": (30, 0.08), "Fire": (11, None), "Shock": (217, None),
    "Corrosive": (142, None), "Cryo": (189, None), "Void": (258, None),
}


def shield_colorways(pal_img):
    pal, counts = palette_of(pal_img)
    tables = {}
    glow_idx = []
    for i, (r, g, b) in enumerate(pal):
        if counts[i] == 0:
            continue
        h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        hd = h * 360
        if 185 <= hd <= 250 and s >= 0.45 and v >= 0.62:
            glow_idx.append(i)
    fg = int(counts.sum())
    glow_px = int(counts[glow_idx].sum()) if glow_idx else 0
    for element in ELEMENTS:
        th, ts = SHIELD_SWAP_TARGETS[element]
        table = {}
        for i in glow_idx:
            r, g, b = (int(x) for x in pal[i])
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            ns = s if ts is None else min(s, ts)
            nr, ng, nb = colorsys.hsv_to_rgb(th / 360, ns, v)
            table[i] = [round(nr * 255), round(ng * 255), round(nb * 255)]
        tables[element] = table
    stats = {
        "glow_entries": len(glow_idx),
        "glow_share_pct": round(100 * glow_px / fg, 2) if fg else 0.0,
    }
    return tables, stats


# ---------------------------------------------------------------------------
# Ordnance colorways — Wave 6's zone rule + core->accent blend, with the
# body hue ceiling measured per form (Spike's published ceiling: 18 deg).
# ---------------------------------------------------------------------------
ELEMENT_HUE = {  # representative hue of each element's core color
    "Kinetic": None, "Fire": 11, "Shock": 217, "Corrosive": 142,
    "Cryo": 189, "Void": 258,
}


def _hue_dist(h, ref):
    return np.abs((h - ref + 540) % 360 - 180)


def ordnance_colorways(pal_img, form):
    pal, counts = palette_of(pal_img)
    palf = pal.astype(np.float32)
    h, s, v = rgb_to_hsv(palf.reshape(-1, 1, 3))
    h, s, v = h.ravel(), s.ravel(), v.ravel()
    lum = palf.mean(axis=1)
    used = counts > 0
    master_el = ORDNANCE_MASTER_ELEMENT[form]
    ref = ELEMENT_HUE[master_el]
    if form == "spike":
        ceiling = 18.0
    else:
        # Body = entries clearly outside the master element's family band;
        # the ceiling is their 97.5th-percentile warm-side distance edge:
        # measured as the largest hue (in the warm reading, h in [0,180])
        # among saturated body entries, capped at the family's low edge.
        outside = used & (s > 0.25) & (_hue_dist(h, ref) > 45)
        warm = outside & (h <= 180)
        ceiling = float(np.percentile(h[warm], 97.5)) if warm.sum() >= 4 else 18.0
        ceiling = min(ceiling, ref - 60) if ref > 90 else ceiling
    cls = np.ones(256, dtype=np.uint8)  # body
    cls[(lum > 248) & (s < 0.04)] = 0  # background class (unused entries)
    trim = (cls != 0) & (v > 0.15) & (v < 0.75) & ((s < 0.22) | ((h > 190) & (h < 260) & (s < 0.45)))
    cls[trim] = 2
    glow = used & (cls != 0) & (
        ((h >= ceiling + 1) & (h <= ceiling + 62) & (s > 0.40) & (v > 0.50))
        | ((lum > 248) & (s >= 0.04))
    )
    if form != "spike":
        # The seat is painted in the master element's family: restrict the
        # warm window's complement — entries already inside the family band
        # at seat saturation/value are the seat's own gradient.
        in_family = used & (cls != 0) & (_hue_dist(h, ref) <= 45) & (s > 0.40) & (v > 0.50)
        glow = glow | in_family
    cls[glow] = 3
    gi = np.where(cls == 3)[0]
    fg = int(counts[used & (cls != 0)].sum())
    glow_px = int(counts[gi].sum()) if len(gi) else 0
    tables = {}
    for element in ELEMENTS:
        core, accent = ELEMENT_VISUALS[element]
        newpal = pal.copy()
        if len(gi):
            gh, gs, gv = h[gi], s[gi], v[gi]
            ch, cs, _ = rgb_to_hsv(np.array([[core]], dtype=np.uint8))
            ah, asat, _ = rgb_to_hsv(np.array([[accent]], dtype=np.uint8))
            ch, cs, ah, asat = ch.ravel()[0], cs.ravel()[0], ah.ravel()[0], asat.ravel()[0]
            t = np.clip((gv - 0.55) / 0.45, 0, 1) * np.clip(1.05 - gs, 0, 1)
            dh = ((ah - ch + 540) % 360) - 180
            nh = (ch + dh * t) % 360
            ns = cs + (asat - cs) * t
            nv = np.maximum(gv, 0.45)
            rgb = hsv_to_rgb(nh, np.clip(ns, 0, 1), np.clip(nv, 0, 1))
            newpal[gi] = np.round(rgb * 255).astype(np.int64)
            assert (newpal[cls != 3] == pal[cls != 3]).all(), element
        tables[element] = {int(i): [int(x) for x in newpal[i]] for i in gi}
    stats = {
        "master_element": master_el,
        "body_hue_ceiling_deg": round(float(ceiling), 1),
        "glow_entries": int(len(gi)),
        "glow_share_pct": round(100 * glow_px / fg, 2) if fg else 0.0,
    }
    return tables, stats


# ---------------------------------------------------------------------------
# Class-mod window measurement — Wave 5's deck_proof method.
# ---------------------------------------------------------------------------
def measure_window(content, slug):
    CELL = 3
    small = content.resize(
        (content.width // CELL, content.height // CELL), Image.LANCZOS
    )
    a = np.asarray(small.convert("RGB")).astype(int)
    alpha = np.asarray(content.split()[3])[::CELL, ::CELL][: a.shape[0], : a.shape[1]]
    fg = alpha > 8
    ys, xs = np.nonzero(fg)
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    ox, oy = DECK_ORIGINS[slug]
    zx0 = x0 + (ox - 12) / 232 * bw
    zx1 = x0 + (ox + 78 + 12) / 232 * bw
    zy0 = y0 + (oy - 9) / 112 * bh
    zy1 = y0 + (oy + 30 + 9) / 112 * bh
    dark = (a[:, :, 0] < 55) & (a[:, :, 1] < 60) & (a[:, :, 2] < 70)
    zone = np.zeros_like(dark)
    zone[int(max(0, zy0)) : int(zy1), int(max(0, zx0)) : int(zx1)] = True
    cand = dark & zone & fg
    lab, n = ndimage.label(cand)
    if n == 0:
        raise ValueError(f"no deck window found: {slug}")
    sizes = ndimage.sum(cand, lab, range(1, n + 1))
    best = 1 + int(np.argmax(sizes))
    wys, wxs = np.nonzero(lab == best)
    wy0, wx0, wy1, wx1 = int(wys.min()), int(wxs.min()), int(wys.max()), int(wxs.max())
    frac = {
        "x0": round((wx0 - x0) / bw, 4), "y0": round((wy0 - y0) / bh, 4),
        "x1": round((wx1 + 1 - x0) / bw, 4), "y1": round((wy1 + 1 - y0) / bh, 4),
    }
    frac["aspect"] = round(
        ((frac["x1"] - frac["x0"]) * content.width) / ((frac["y1"] - frac["y0"]) * content.height), 2
    )
    return frac


# ---------------------------------------------------------------------------
def derive_family(kind, slugs, master_path_of, sprite_slug_of, plate_name_of):
    records = {}
    colorways = {}
    windows = {}
    for slug in slugs:
        master = master_path_of(slug)
        content, box, note = key_and_crop(os.path.join(TC, master), slug)
        sprite_name = sprite_slug_of(slug)
        sprite_path = os.path.join(SPRITE_DIR, sprite_name + ".png")
        pal = pal_save(content, sprite_path)
        anchors = compute_anchors(content)
        sidecar = {
            "sprite": sprite_name,
            "src": f"top-choice/{master}",
            "out": f"src/assets/pixel/sprites/{sprite_name}.png",
            "width": content.width,
            "height": content.height,
            "anchors": anchors,
        }
        with open(os.path.join(SPRITE_DIR, sprite_name + ".anchors.json"), "w") as f:
            json.dump(sidecar, f, indent=2)
            f.write("\n")
        plate_name = plate_name_of(slug)
        wiki_path = os.path.join(OUT_ROOT, plate_name + ".png")
        plate_size = derive_wiki_source(content, kind, wiki_path)
        rec = {
            "master": master,
            "key": note,
            "master_size": list(Image.open(os.path.join(TC, master)).size),
            "content_box": list(box),
            "sprite": f"src/assets/pixel/sprites/{sprite_name}.png",
            "sprite_size": list(content.size),
            "sprite_bytes": os.path.getsize(sprite_path),
            "anchors": anchors,
            "wiki_source": f"scripts/wiki-gen/assets/gear/{plate_name}.png",
            "wiki_plate_size": list(plate_size),
            "wiki_bytes": os.path.getsize(wiki_path),
        }
        if kind == "shield":
            tables, stats = shield_colorways(pal)
            colorways[slug] = tables
            rec["zone"] = stats
        elif kind == "ordnance":
            tables, stats = ordnance_colorways(pal, slug)
            colorways[slug] = tables
            rec["zone"] = stats
        elif kind == "class-mod":
            win = measure_window(content, slug)
            windows[slug] = win
            rec["deck_window_frac"] = win
        records[plate_name] = rec
        print(f"{kind}/{slug}: sprite {content.size} {rec['sprite_bytes']} B · wiki {rec['wiki_bytes']} B")
    return records, colorways, windows


def main():
    os.makedirs(SPRITE_DIR, exist_ok=True)
    os.makedirs(OUT_ROOT, exist_ok=True)
    sources = {"families": {}, "colorways": {}, "deck_windows": {}}

    rec, cw, _ = derive_family(
        "shield", SHIELD_FORMS,
        lambda s: f"wave3-shields/renders/{s}-top.png",
        lambda s: f"gear-shield-{s}",
        lambda s: f"shield-{s}",
    )
    sources["families"]["shield"] = rec
    sources["colorways"]["shield"] = cw

    rec, _, _ = derive_family(
        "relic", RELIC_SLUGS,
        lambda s: f"wave4-relics/renders/{s}-top.png",
        lambda s: f"gear-relic-{s}",
        lambda s: f"relic-{s}",
    )
    sources["families"]["relic"] = rec

    rec, _, win = derive_family(
        "class-mod", CLASS_MOD_TREES,
        lambda s: f"wave5-classmods/renders/classmod-{s}-top.png",
        lambda s: f"gear-class-mod-{s}",
        lambda s: f"class-mod-{s}",
    )
    sources["families"]["class-mod"] = rec
    sources["deck_windows"] = win

    rec, cw, _ = derive_family(
        "ordnance", ORDNANCE_FORMS,
        lambda s: f"wave6-ordnance/renders/{s}-top.png",
        lambda s: f"gear-ordnance-{s}",
        lambda s: f"ordnance-{s}",
    )
    sources["families"]["ordnance"] = rec
    sources["colorways"]["ordnance"] = cw

    with open(os.path.join(OUT_ROOT, "sources.json"), "w") as f:
        json.dump(sources, f, indent=1)
        f.write("\n")
    total_sprite = sum(
        r["sprite_bytes"] for fam in sources["families"].values() for r in fam.values()
    )
    total_wiki = sum(
        r["wiki_bytes"] for fam in sources["families"].values() for r in fam.values()
    )
    print(f"TOTAL sprites {total_sprite} B · wiki sources {total_wiki} B")
    print("deck windows:", json.dumps(win))


if __name__ == "__main__":
    main()
