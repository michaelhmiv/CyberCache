#!/usr/bin/env python3
"""Render the device-feedback r2 sample board.

Output: docs/pixel-samples/board-device-r2.png

IMPORTANT — what this is: a SCHEMATIC of the shipped phone-width
layout contract at 360dp (drawn at 2x), not a device screenshot.
The repo's sample tooling renders pixel scenes, not DOM screens, so
this board draws the Board screen's chrome with the exact geometry
the components ship:

- ResourceBar (src/components/layout/ResourceBar.tsx): 3-across
  grid at phone width (6-across only from 560dp), chips 108dp wide
  × 50dp tall with the angled sign clip, line 1 = full label +
  secondary count, line 2 = the value at 15px.
- Values come from compactResourceValue (src/lib/ui/formatValue.ts)
  — bounded to 6 glyphs, so nothing ellipsizes: the fixture below
  uses the layout-contract test's values (999,949 credits etc.).
- Hunter Totals (CharacterStatBar): values carry whitespace-nowrap,
  never the truncate class.
- BottomNav: six ~52dp cells, 8px labels, unchanged.

The DOM-level contract itself is pinned by
src/test/deviceLayoutContract.test.tsx.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "pixel-samples" / "board-device-r2.png"

S = 2  # 1dp = 2px
W = 360 * S
BG = (10, 13, 18)
SURFACE = (18, 23, 34)
BORDER = (52, 62, 82)
TEXT = (235, 238, 245)
MUTED = (140, 150, 168)

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def font(size_dp: float, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_B if bold else FONT, round(size_dp * S))


def clipped_chip(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, accent) -> None:
    cut = 10 * S // 2
    poly = [(x, y), (x + w - cut, y), (x + w, y + cut), (x + w, y + h),
            (x + cut, y + h), (x, y + h - cut)]
    draw.polygon(poly, fill=SURFACE)
    draw.line(poly + [poly[0]], fill=accent, width=2)
    draw.rectangle([x, y + 6, x + 3, y + h - 6], fill=accent)


def main() -> None:
    img = Image.new("RGB", (W, 600 * S), BG)
    d = ImageDraw.Draw(img)
    pad = 12 * S
    content_w = W - 2 * pad

    y = 14 * S
    d.text((pad, y), "BOARD CHROME — 360dp", font=font(11, True), fill=TEXT)
    d.text((pad, y + 16 * S), "schematic of the shipped layout contract (not a screenshot)",
           font=font(8), fill=MUTED)
    y += 42 * S

    # ── Resource bar: 3-across grid, gap 6dp, chips 50dp tall ──
    gap = 6 * S
    chip_w = (content_w - 2 * gap) // 3
    chip_h = 50 * S
    chips = [
        ("CREDITS", "999.9K", "", (245, 166, 35)),
        ("SCRAP", "12.3K", "", (159, 180, 200)),
        ("KEYS", "15", "3/5", (177, 140, 255)),
        ("CORES", "2", "", (57, 213, 232)),
        ("LOOT", "123", "1/7", (126, 231, 135)),
        ("LEVEL", "100", "", (232, 121, 249)),
    ]
    for i, (label, value, micro, accent) in enumerate(chips):
        cx = pad + (i % 3) * (chip_w + gap)
        cy = y + (i // 3) * (chip_h + gap)
        clipped_chip(d, cx, cy, chip_w, chip_h, accent)
        d.text((cx + 8 * S, cy + 6 * S), label, font=font(8, True), fill=MUTED)
        if micro:
            tw = d.textlength(micro, font=font(8, True))
            d.text((cx + chip_w - 6 * S - tw, cy + 6 * S), micro, font=font(8, True), fill=MUTED)
        d.text((cx + 8 * S, cy + 24 * S), value, font=font(15, True), fill=TEXT)
    y += 2 * chip_h + gap + 10 * S
    d.text((pad, y), "Resource bar — every label whole, every value whole (<=6 glyphs).",
           font=font(8), fill=MUTED)
    y += 30 * S

    # ── Hunter Totals strip ──
    d.text((pad, y), "HUNTER TOTALS", font=font(9, True), fill=MUTED)
    y += 16 * S
    metrics = [("HEALTH", "820 (+0%)"), ("BASE DPS", "0"), ("SHIELD BREAK", "0")]
    for i, (label, value) in enumerate(metrics):
        cx = pad + i * (chip_w + gap)
        d.rectangle([cx, y, cx + chip_w, y + 34 * S], fill=SURFACE, outline=BORDER, width=2)
        tw = d.textlength(value, font=font(13, True))
        d.text((cx + (chip_w - tw) / 2, y + 4 * S), value, font=font(13, True), fill=TEXT)
        lw = d.textlength(label, font=font(7, True))
        d.text((cx + (chip_w - lw) / 2, y + 22 * S), label, font=font(7, True), fill=MUTED)
    y += 34 * S + 10 * S
    d.text((pad, y), "Hunter Totals — values nowrap, never ellipsized.",
           font=font(8), fill=MUTED)
    y += 40 * S

    # ── Market tab grid note ──
    d.text((pad, y), "MARKET TABS — even 3x2 grid, 52dp targets", font=font(9, True), fill=MUTED)
    y += 16 * S
    tabs = ["Buy", "Vendor", "Sell", "My Listings", "History", "Repair Services"]
    tab_h = 52 * S // 2
    for i, label in enumerate(tabs):
        cx = pad + (i % 3) * (chip_w + gap)
        cy = y + (i // 3) * (tab_h + gap)
        d.rectangle([cx, cy, cx + chip_w, cy + tab_h], fill=SURFACE, outline=BORDER, width=2)
        tw = d.textlength(label, font=font(9, True))
        d.text((cx + (chip_w - tw) / 2, cy + (tab_h - 9 * S) / 2), label, font=font(9, True), fill=TEXT)
    y += 2 * tab_h + gap + 26 * S

    # ── Bottom nav ──
    nav_y = 600 * S - 66 * S // 2 - 20 * S
    d.rectangle([0, nav_y, W, nav_y + 66 * S // 2], fill=(14, 18, 26))
    d.line([0, nav_y, W, nav_y], fill=BORDER, width=2)
    cell = W // 6
    for i, label in enumerate(["BOARD", "ACTION", "GEAR", "MARKET", "RANK", "HUNTER"]):
        tw = d.textlength(label, font=font(8, True))
        d.text((i * cell + (cell - tw) / 2, nav_y + 18 * S), label, font=font(8, True),
               fill=TEXT if i == 0 else MUTED)

    d.text((pad, 600 * S - 14 * S),
           "Geometry: ResourceBar grid-cols-3 @360dp · values via compactResourceValue",
           font=font(7), fill=MUTED)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
