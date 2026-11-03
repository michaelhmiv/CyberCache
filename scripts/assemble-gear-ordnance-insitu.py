#!/usr/bin/env python3
"""Capture sheets for the gear marriage, slice 2 (ordnance).

These are compositions, not app screenshots: the PRODUCTION
ordnance grammar's renders (the cells from
render-gear-ordnance-samples) placed at the surfaces' real
display sizes on 412-wide panels in the app's panel colors —
the form × element matrix, a loadout strip + market rows at
thumb size (46px art), and an inspect showcase (190px art).

Usage: assemble-gear-ordnance-insitu.py <cellsDir> <outDir>
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
RARITY_RARE = (59, 130, 246)

FORMS = ["spike", "disc", "dart", "canister"]
FORM_LABEL = {"spike": "SPIKE", "disc": "DISC", "dart": "DART", "canister": "CANISTER"}
FORM_EFFECTS = {
    "spike": "Fragmentation / Kinetic Slam",
    "disc": "EMP Payload / Shockwave",
    "dart": "Seeker / Void Tap",
    "canister": "Cluster / Incendiary / Acid Burst / Cryo Shell",
}
ELEMENTS = ["Kinetic", "Fire", "Shock", "Corrosive", "Cryo", "Void"]


def font(size, bold=True):
    p = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    try:
        return ImageFont.truetype(p, size)
    except Exception:
        return ImageFont.load_default()


def cell(name, width):
    im = Image.open(cells / f"{name}.png").convert("RGB")
    h = round(width * im.height / im.width)
    return im.resize((width, h), Image.NEAREST)


def panel(d, x, y, w, h, edge=PANEL_EDGE):
    d.rectangle([x, y, x + w, y + h], fill=PANEL, outline=edge, width=1)


# ---------- 1. Form × element matrix (card density) ----------
CW, CHH = 128, 64
W = 412
H = 30 + 8 * (CHH + 16) + 8
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((12, 8), "ORDNANCE — FORM = EFFECT CLASS × ELEMENT", fill=LABEL, font=font(12))
y = 30
for group in range(2):
    els = ELEMENTS[group * 3:(group + 1) * 3]
    for form in FORMS:
        for ci, el in enumerate(els):
            x = 12 + ci * (CW + 6)
            img.paste(cell(f"form-{form}-{el}", CW), (x, y))
            d.text((x + 2, y + CHH + 2), f"{FORM_LABEL[form]} · {el}", fill=DIM, font=font(10))
        y += CHH + 16
img.save(out / "matrix-forms-elements-412.png")
print("wrote matrix-forms-elements-412.png")

# ---------- 2. In-situ: loadout strip + market rows (thumb, 46px) ----------
W, H = 412, 300
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((12, 8), "IN SITU — LOADOUT STRIP (thumb art at 46px)", fill=LABEL, font=font(12))
panel(d, 10, 30, 392, 74)
for i, form in enumerate(FORMS):
    x = 22 + i * 96
    panel(d, x, 40, 84, 40, edge=(70, 76, 96))
    img.paste(cell(f"thumb-{form}-Fire", 46), (x + 19, 48))
    d.text((x + 6, 86), FORM_LABEL[form], fill=DIM, font=font(9))
d.text((12, 116), "IN SITU — MARKET LISTINGS (thumb art at 46px)", fill=LABEL, font=font(12))
rows = [
    ("thumb-spike-Shock", "Shock Grenade — Fragmentation", "2,450 cr"),
    ("thumb-disc-Cryo", "Cryo Deployable — Shockwave", "1,875 cr"),
    ("thumb-dart-Void", "Void Charge — Void Tap", "3,120 cr"),
    ("thumb-canister-Corrosive", "Corrosive Canister — Acid Burst", "2,030 cr"),
]
y = 138
for name, label, price in rows:
    panel(d, 10, y, 392, 36)
    d.rectangle([10, y, 13, y + 36], fill=RARITY_RARE)
    img.paste(cell(name, 46), (22, y + 6))
    d.text((78, y + 11), label, fill=LABEL, font=font(11))
    d.text((330, y + 11), price, fill=(255, 210, 31), font=font(11))
    y += 42
img.save(out / "insitu-strip-market-412.png")
print("wrote insitu-strip-market-412.png")

# ---------- 3. In-situ: inspect showcase (190px) + gear grid cards (70px) ----------
W, H = 412, 356
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((12, 8), "IN SITU — INSPECT (showcase art at 190px)", fill=LABEL, font=font(12))
panel(d, 10, 30, 392, 150)
img.paste(cell("form-dart-Fire", 190), (111, 44))
d.text((20, 148), "Fire Payload — Seeker", fill=LABEL, font=font(12))
d.text((20, 164), "form follows the effect: a Seeker always wears the dart", fill=DIM, font=font(10))
d.text((12, 192), "IN SITU — GEAR GRID (card art at 70px)", fill=LABEL, font=font(12))
for i, (form, el) in enumerate([("spike", "Fire"), ("disc", "Shock"), ("dart", "Cryo"), ("canister", "Void")]):
    x = 12 + i * 99
    panel(d, x, 214, 93, 128)
    d.rectangle([x, 214, x + 93, 217], fill=RARITY_RARE)
    img.paste(cell(f"form-{form}-{el}", 70), (x + 11, 226))
    d.text((x + 6, 268), FORM_LABEL[form], fill=LABEL, font=font(9))
    d.text((x + 6, 280), el, fill=DIM, font=font(9))
    d.text((x + 6, 300), FORM_EFFECTS[form].split(" / ")[0], fill=DIM, font=font(8))
img.save(out / "insitu-inspect-grid-412.png")
print("wrote insitu-inspect-grid-412.png")

# ---------- 4. Rarity row (one form, five finishes) ----------
W, H = 412, 30 + 5 * 66
img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)
d.text((12, 8), "RARITY — FINISH ESCALATES, FORM NEVER CHANGES (Spike · Fire)", fill=LABEL, font=font(11))
y = 30
for rar in ["Common", "Uncommon", "Rare", "Epic", "Legendary"]:
    img.paste(cell(f"rar-spike-{rar}", 128), (12, y))
    d.text((150, y + 24), rar, fill=LABEL, font=font(12))
    y += 66
img.save(out / "rarity-row-412.png")
print("wrote rarity-row-412.png")
