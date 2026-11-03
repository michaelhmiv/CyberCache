#!/usr/bin/env python3
"""Assemble weapon-marriage review sheets from rendered cells.

Usage: assemble-weapon-marriage-sheets.py <cellsDir> <outDir>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

cells = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

BG = (13, 15, 20)
PANEL = (21, 24, 32)
LABEL = (200, 208, 224)
DIM = (120, 128, 148)

def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

def cell(name):
    return Image.open(cells / f"{name}.png").convert("RGB")

TYPES = ["Pistol", "SMG", "Shotgun", "Launcher", "Sniper", "Beam"]
MAKERS = ["Redline", "Ironwood", "BlastForge", "Prismatek", "ThrowTech", "HelixWorks"]

# ---- Sheet 1: 36 identities at full card render size (detail) ----
cw, chh, lab = 480, 176, 22
W = 6 * cw + 7 * 8
H = 6 * (chh + lab) + 7 * 8 + 30
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((10, 6), "36 IDENTITIES — Kinetic / Common / clean — card density 240x88 (shown 2x)", fill=LABEL, font=font(18))
for r, maker in enumerate(MAKERS):
    for c, t in enumerate(TYPES):
        x = 8 + c * (cw + 8)
        y = 38 + r * (chh + lab + 8)
        img.paste(cell(f"id-{t}-{maker}"), (x, y + lab))
        d.text((x + 4, y + 3), f"{maker} {t}", fill=LABEL, font=font(15))
img.save(out / "sheet-36-detail.png")
print("sheet-36-detail", img.size)

# ---- Sheet 2: 412x915 contact sheet (at-range readability) ----
cw2 = 132
ch2 = round(cw2 * 88 / 240)
lab2 = 13
cols, rows = 3, 12
W2 = 412
H2 = 40 + rows * (ch2 + lab2 + 4) + 8
img2 = Image.new("RGB", (W2, min(H2, 915)), BG)
d2 = ImageDraw.Draw(img2)
d2.text((8, 8), "36 IDENTITIES at range — 412 wide", fill=LABEL, font=font(15))
order = [(t, m) for m in MAKERS for t in TYPES]
for i, (t, m) in enumerate(order):
    c, r = i % cols, i // cols
    x = 6 + c * (cw2 + 6)
    y = 40 + r * (ch2 + lab2 + 4)
    if y + ch2 + lab2 > 915:
        break
    thumb = cell(f"id-{t}-{m}").resize((cw2, ch2), Image.NEAREST)
    img2.paste(thumb, (x, y + lab2))
    d2.text((x + 2, y + 1), f"{m[:4]} {t[:4]}", fill=DIM, font=font(10))
img2.save(out / "sheet-36-contact-412.png")
print("sheet-36-contact-412", img2.size)

# ---- Sheet 3: ladders ----
def ladder(title, names, labels, fname, cellw=480):
    cellh = round(cellw * 88 / 240)
    Wd = cellw + 16
    Hd = 34 + len(names) * (cellh + 20 + 6) + 6
    im = Image.new("RGB", (Wd, Hd), BG)
    dr = ImageDraw.Draw(im)
    dr.text((8, 8), title, fill=LABEL, font=font(17))
    for i, (n, lb) in enumerate(zip(names, labels)):
        y = 34 + i * (cellh + 26)
        im.paste(cell(n).resize((cellw, cellh), Image.NEAREST), (8, y + 20))
        dr.text((10, y + 2), lb, fill=LABEL, font=font(14))
    im.save(out / fname)
    print(fname, im.size)

ELS = ["Kinetic", "Fire", "Shock", "Corrosive", "Cryo", "Void"]
ladder("ELEMENT LADDER — Redline Sniper", [f"el-sniper-redline-{e}" for e in ELS], ELS, "sheet-element-sniper.png")
ladder("ELEMENT LADDER — Ironwood SMG", [f"el-smg-ironwood-{e}" for e in ELS], ELS, "sheet-element-smg.png")
RARS = ["Common", "Uncommon", "Rare", "Epic", "Legendary"]
ladder("RARITY LADDER — BlastForge Shotgun (Kinetic)", [f"rar-shotgun-blastforge-{r}" for r in RARS], RARS, "sheet-rarity-shotgun.png")
ladder("RARITY LADDER — Prismatek Beam (Fire)", [f"rar-beam-prismatek-{r}" for r in RARS], RARS, "sheet-rarity-beam.png")
ladder("PART VARIANTS — HelixWorks SMG (Rare)", ["var-helixsmg-alpha", "var-helixsmg-beta", "var-helixsmg-gamma"], ["roll alpha", "roll beta", "roll gamma"], "sheet-variants.png")
ladder("THEME — Ironwood Sniper", ["id-Sniper-Ironwood", "theme-wasteland-bone"], ["stock Ironwood", "Wasteland Bone theme"], "sheet-theme.png")
