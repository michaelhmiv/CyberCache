#!/usr/bin/env python3
"""Capture sheets for the relic marriage (gear marriage, slice 4).

These are compositions, not app screenshots: the PRODUCTION relic
grammar's renders (the cells from render-relic-samples) placed at
412 CSS px width — the name-pool sheet at native plate scale with
composed thumbs beside each plate, plus in-situ panels placing the
renders at the real display sizes of the surfaces that show them
(Gear slot blocks ~50px art, the Action loadout strip at 44px,
the inspect sheet's 190px showcase).

Usage: assemble-relic-captures.py <cellsDir> <outDir>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

cells = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

BG = (10, 11, 16)
PANEL = (18, 20, 28)
PANEL_EDGE = (42, 46, 60)
LABEL = (205, 212, 226)
DIM = (130, 138, 158)
GOLD = (255, 210, 31)
PINK = (255, 105, 180)

def font(size, bold=True):
    p = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.load_default()

def cell(name):
    return Image.open(cells / f"{name}.png").convert("RGB")

def resized(name, width):
    im = cell(name)
    h = round(width * im.height / im.width)
    return im.resize((width, h), Image.NEAREST)

FORMS = [
    ("vault-chip", "Vault Chip", "gold chip — die window, contact pins"),
    ("data-shard", "Data Shard", "faceted shard, satellite shards"),
    ("neural-key", "Neural Key", "bow, shaft, teeth, lit nodes"),
    ("cache-relic", "Cache Relic", "domed casket, lock clasp"),
    ("echo-stone", "Echo Stone", "rounded stone, echo rings"),
    ("void-prism", "Void Prism", "hex prism, levitating shards"),
    ("circuit-totem", "Circuit Totem", "stacked segments, face, antennae"),
    ("ancient-module", "Ancient Module", "rack casing, card slots, dial"),
    ("scrap-core", "Scrap Core", "junk housing, hot core, pipe"),
    ("glitched-token", "Glitched Token", "struck coin, sheared slices"),
    ("ethereal-drive", "Ethereal Drive", "floating slab, ghost-wave window"),
    ("quantum-fragment", "Quantum Fragment", "jagged fragment cluster"),
]

# ---------------------------------------------------------------- pool sheet
{
    "name": "pool",
}
W = 412
HEADER_H = 96
ROW_H = 176
sheet = Image.new("RGB", (W, HEADER_H + ROW_H * len(FORMS) + 8), BG)
d = ImageDraw.Draw(sheet)
d.text((10, 12), "RELIC MARRIAGE — THE NAME POOL", font=font(19), fill=LABEL)
d.text((10, 40), "form = the relic's NAME · one row per name in the closed pool", font=font(12, False), fill=DIM)
d.text((10, 60), "native 240x140 plates + composed thumbs (detail level 0) at right", font=font(12, False), fill=DIM)
d.text((10, 78), "all Epic / world base / 3 affixes — rarity & base vary elsewhere", font=font(12, False), fill=DIM)
for i, (fid, name, desc) in enumerate(FORMS):
    y = HEADER_H + i * ROW_H
    d.text((10, y + 4), name.upper(), font=font(15), fill=GOLD)
    d.text((182, y + 6), desc, font=font(11, False), fill=DIM)
    sheet.paste(cell(f"form-{fid}-card"), (8, y + 28))
    thumb = cell(f"form-{fid}-thumb")  # rendered at 6x: 360x210
    sheet.paste(thumb.resize((120, 70), Image.NEAREST), (264, y + 62))
    d.text((264, y + 40), "THUMB", font=font(10), fill=DIM)
sheet.save(out / "relic-name-pool-412.png")
print("wrote relic-name-pool-412.png", sheet.size)

# ---------------------------------------------------------------- treatments
TREATMENTS = [
    ("world", "World Drop — field plinth"),
    ("boss", "Boss Drop — totem foot"),
    ("cache", "Cache-Forged — forge cradle"),
    ("event", "Event — display stand"),
    ("crafted", "Crafted — workbench base"),
    ("market", "Marketplace — listing shelf"),
]
ROW_H = 172
sheet = Image.new("RGB", (W, 84 + ROW_H * len(TREATMENTS) + 8), BG)
d = ImageDraw.Draw(sheet)
d.text((10, 12), "BASE TREATMENTS — SOURCETAG DEMOTED", font=font(17), fill=LABEL)
d.text((10, 38), "one form (Cache Relic, Rare) on all six bases:", font=font(12, False), fill=DIM)
d.text((10, 56), "where a relic came from changes only what it rests on", font=font(12, False), fill=DIM)
for i, (tid, label) in enumerate(TREATMENTS):
    y = 84 + i * ROW_H
    d.text((10, y + 2), label, font=font(13), fill=GOLD)
    sheet.paste(cell(f"treatment-{tid}"), (8, y + 24))
sheet.save(out / "relic-treatments-412.png")
print("wrote relic-treatments-412.png", sheet.size)

# ---------------------------------------------------------------- rarity ladder
RARITIES = ["common", "uncommon", "rare", "epic", "legendary"]
ROW_H = 168
sheet = Image.new("RGB", (W, 84 + ROW_H * len(RARITIES) + 8), BG)
d = ImageDraw.Draw(sheet)
d.text((10, 12), "RARITY IS FINISH ONLY — VOID PRISM", font=font(17), fill=LABEL)
d.text((10, 38), "same form, same seed: only the core's frame escalates", font=font(12, False), fill=DIM)
for i, r in enumerate(RARITIES):
    y = 84 + i * ROW_H
    d.text((10, y + 2), r.upper(), font=font(13), fill=GOLD)
    sheet.paste(cell(f"rarity-{r}"), (8, y + 22))
sheet.save(out / "relic-rarity-ladder-412.png")
print("wrote relic-rarity-ladder-412.png", sheet.size)

# ---------------------------------------------------------------- in-situ: gear strip
sheet = Image.new("RGB", (412, 236), BG)
d = ImageDraw.Draw(sheet)
d.text((10, 10), "IN SITU — GEAR SLOT + LOADOUT STRIP", font=font(15), fill=LABEL)
d.text((10, 32), "compositions of production renders at real surface sizes", font=font(11, False), fill=DIM)
# Gear slot blocks (~50px art, card density as GearHub renders it)
strip_forms = [("form-cache-relic-card", "Cache Relic"), ("form-void-prism-card", "Void Prism"),
               ("form-neural-key-card", "Neural Key"), ("record-rec-glitched-legendary", "Glitched Token")]
for i, (cn, label) in enumerate(strip_forms):
    x = 10 + i * 100
    d.rectangle([x, 56, x + 92, 128], fill=PANEL, outline=PANEL_EDGE, width=1)
    art = resized(cn, 50)
    sheet.paste(art, (x + 21, 66))
    d.text((x + 6, 112), "RELIC", font=font(9), fill=DIM)
    d.text((x + 6, 134), label, font=font(10), fill=LABEL)
d.text((10, 158), "slot blocks: card density at 50px (Gear tab)", font=font(10, False), fill=DIM)
# Loadout strip row (44px, thumb density as ActionLoadout renders it)
for i, (cn, label) in enumerate([("record-rec-quantum-common-thumb", "Quantum Fragment"),
                                 ("record-rec-ethereal-epic-thumb", "Ethereal Drive")]):
    x = 10 + i * 200
    d.rectangle([x, 182, x + 190, 222], fill=PANEL, outline=PANEL_EDGE, width=1)
    art = cell(cn).resize((44, 26), Image.NEAREST)
    sheet.paste(art, (x + 8, 189))
    d.text((x + 60, 196), label, font=font(11), fill=LABEL)
d.text((10, 226 - 14), "", font=font(10), fill=DIM)
sheet.save(out / "insitu-gear-strip-412.png")
print("wrote insitu-gear-strip-412.png", sheet.size)

# ---------------------------------------------------------------- in-situ: inspect sheet
sheet = Image.new("RGB", (412, 516), BG)
d = ImageDraw.Draw(sheet)
d.rectangle([6, 6, 406, 510], fill=PANEL, outline=PANEL_EDGE, width=1)
d.text((20, 18), "INSPECT — composition at the sheet's real art size", font=font(11, False), fill=DIM)
d.text((20, 44), "Glitched Token", font=font(24), fill=LABEL)
d.text((20, 76), "LEGENDARY RELIC", font=font(13), fill=GOLD)
art = resized("record-rec-glitched-legendary", 190)
sheet.paste(art, (111, 104))
d.text((20, 232), "A struck token, glitching at the seams. Dropped by a boss;", font=font(12, False), fill=DIM)
d.text((20, 250), "it rests on the totem foot its source earned it.", font=font(12, False), fill=DIM)
y = 292
for line in ["+5 Luck", "+4 Luck", "+3 Luck", "+2 Luck", "+1 Luck"]:
    d.rectangle([20, y, 392, y + 26], fill=BG, outline=PANEL_EDGE, width=1)
    d.text((30, y + 6), line, font=font(12), fill=LABEL)
    y += 34
d.text((20, y + 4), "Boss Drop base - 5 affix pips on the plinth - seed-locked form", font=font(10, False), fill=DIM)
sheet.save(out / "insitu-inspect-sheet-412.png")
print("wrote insitu-inspect-sheet-412.png", sheet.size)
