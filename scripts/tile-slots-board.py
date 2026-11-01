#!/usr/bin/env python3
"""Tile the Data Slots samples into one review board.

Inputs: docs/pixel-samples/slots-idle.png and slots-key-win.png
(from scripts/render-overhaul-samples.ts — the golden baselines'
twins). Output: docs/pixel-samples/board-slots.png — the machine
idle at the stall (printed payout-table card on the counter), the
cache-key win (cache beam + key glyph, never the loot ladder), and
a close crop of the machine itself. Review artifact for the Data
Slots slice (0049); baselines are Claude-reviewed per Michael's
golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

TILE_W = 384
TILE_H = 256
LABEL_H = 22
COLS = 3


def centered_crop(img: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Scale a crop to fill a TILE_W x TILE_H tile, centered on dark."""
    crop = img.crop(box)
    scale = min(TILE_W / crop.width, TILE_H / crop.height)
    scaled = crop.resize(
        (round(crop.width * scale), round(crop.height * scale)),
        Image.NEAREST,
    )
    tile = Image.new("RGB", (TILE_W, TILE_H), (12, 12, 16))
    tile.paste(scaled, ((TILE_W - scaled.width) // 2, (TILE_H - scaled.height) // 2))
    return tile


def main() -> None:
    idle = Image.open(SAMPLES / "slots-idle.png").convert("RGB")
    key_win = Image.open(SAMPLES / "slots-key-win.png").convert("RGB")
    tiles = [
        (idle, "slots-idle - machine at the stall, table card"),
        (key_win, "slots-key-win - cache beam, key glyph"),
        (centered_crop(key_win, (150, 84, 340, 232)), "the machine - key under the cache beam"),
    ]
    board = Image.new("RGB", (COLS * TILE_W, TILE_H + LABEL_H), (12, 12, 16))
    draw = ImageDraw.Draw(board)
    for i, (tile, label) in enumerate(tiles):
        x = i * TILE_W
        board.paste(tile, (x, LABEL_H))
        draw.text((x + 6, 5), label, fill=(232, 179, 61))
    board.save(SAMPLES / "board-slots.png")
    print(f"wrote {SAMPLES / 'board-slots.png'}")


if __name__ == "__main__":
    main()
