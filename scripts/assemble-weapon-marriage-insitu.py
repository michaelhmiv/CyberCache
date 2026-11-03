#!/usr/bin/env python3
"""In-situ compositions for the weapon marriage captures.

These are compositions, not app screenshots: the PRODUCTION card
compositor's renders (the cells from render-weapon-marriage-samples)
placed at the surfaces' real display sizes on 412-wide panels in the
app's panel colors — inventory grid card (70px art), market listing
thumb (46px art), and the loot-moment card (fluid, ~372px art).

Usage: assemble-weapon-marriage-insitu.py <cellsDir> <outDir>
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

def font(size, bold=True):
    p = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.load_default()

def cell_img(name, width):
    im = Image.open(cells / f"{name}.png").convert("RGB")
    h = round(width * im.height / im.width)
    return im.resize((width, h), Image.NEAREST)

def panel(draw, x, y, w, h, edge=PANEL_EDGE):
    draw.rectangle([x, y, x + w, y + h], fill=PANEL, outline=edge, width=1)

# ---------- 1. Inventory grid (GearIllustration 'card' = 70px art) ----------
W, H = 412, 372
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((14, 10), "GEAR — INVENTORY GRID (art at 70px, card density)", fill=LABEL, font=font(13))
grid = [
    ("id-Sniper-Redline", "Redline Sniper", (239, 68, 68)),
    ("id-SMG-Ironwood", "Ironwood SMG", (34, 197, 94)),
    ("id-Shotgun-BlastForge", "BlastForge Shotgun", (245, 158, 11)),
    ("id-Beam-Prismatek", "Prismatek Beam", (168, 85, 247)),
    ("id-Pistol-ThrowTech", "ThrowTech Pistol", (6, 182, 212)),
    ("id-Launcher-HelixWorks", "HelixWorks Launcher", (59, 130, 246)),
]
cw, chh, gap, x0, y0 = 124, 148, 8, 10, 40
for i, (name, label, color) in enumerate(grid):
    cx = x0 + (i % 3) * (cw + gap)
    cy = y0 + (i // 3) * (chh + gap)
    panel(d, cx, cy, cw, chh)
    d.rectangle([cx, cy, cx + cw, cy + 3], fill=color)
    art = cell_img(name, 70)
    img.paste(art, (cx + (cw - 70) // 2, cy + 34))
    tw = d.textlength(label, font=font(10))
    d.text((cx + (cw - tw) / 2, cy + chh - 24), label, fill=DIM, font=font(10))
img.save(out / "insitu-inventory-grid.png")
print("insitu-inventory-grid", img.size)

# ---------- 2. Market listings (GearIllustration 'thumb' = 46px art) ----------
W, H = 412, 300
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((14, 10), "MARKET — LISTINGS (art at 46px, card density)", fill=LABEL, font=font(13))
rows = [
    ("el-sniper-redline-Fire", "Emberline Longshot", "Fire · Epic", "12,400 cr", (240, 125, 242)),
    ("rar-shotgun-blastforge-Rare", "Forgebreath Scatter", "Kinetic · Rare", "3,150 cr", (87, 182, 255)),
    ("el-smg-ironwood-Shock", "Stormroot Repeater", "Shock · Uncommon", "860 cr", (87, 217, 61)),
    ("id-Beam-HelixWorks", "Coilspine Projector", "Kinetic · Common", "240 cr", (154, 163, 178)),
]
y = 40
for name, label, meta, price, color in rows:
    panel(d, 10, y, 392, 56)
    d.rectangle([10, y, 13, y + 56], fill=color)
    art = cell_img(name, 46)
    img.paste(art, (26, y + (56 - art.height) // 2))
    d.text((86, y + 8), label, fill=LABEL, font=font(12))
    d.text((86, y + 28), meta, fill=DIM, font=font(10))
    tw = d.textlength(price, font=font(12))
    d.text((392 - tw, y + 18), price, fill=(255, 234, 58), font=font(12))
    y += 64
img.save(out / "insitu-market-listings.png")
print("insitu-market-listings", img.size)

# ---------- 3. Loot card (LootMoment fluid art, Legendary) ----------
W, H = 412, 300
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((14, 10), "LOOT MOMENT — RISEN WEAPON (fluid art, card density)", fill=LABEL, font=font(13))
panel(d, 10, 44, 392, 226, edge=GOLD)
d.rectangle([10, 44, 402, 47], fill=GOLD)
art = cell_img("rar-shotgun-blastforge-Legendary", 372)
img.paste(art, ((W - 372) // 2, 84))
t = "LEGENDARY"
tw = d.textlength(t, font=font(15))
d.text(((W - tw) / 2, 58), t, fill=GOLD, font=font(15))
t2 = "Forgebreath Prime — BlastForge Shotgun"
tw = d.textlength(t2, font=font(12))
d.text(((W - tw) / 2, 232), t2, fill=LABEL, font=font(12))
img.save(out / "insitu-loot-card.png")
print("insitu-loot-card", img.size)
