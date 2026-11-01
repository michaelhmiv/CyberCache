#!/usr/bin/env python3
"""Tile the unarmed-hunter samples into one review board.

Inputs: docs/pixel-samples/roam-dustwaste.png + roam-unarmed.png
(from scripts/render-overhaul-samples.ts — the golden baselines'
twins). Output: docs/pixel-samples/board-unarmed.png — the armed
roam scene (equipped path, unchanged) beside the unarmed roam scene
(real-item invariant: no weapon equipped renders NO weapon), plus a
matched close crop of each hunter at the same box and scale so the
only difference on the board is the weapon itself. Review artifact
for the unarmed-render fix; baselines are Claude-reviewed per
Michael's golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

TILE_W = 384
TILE_H = 256
LABEL_H = 22
COLS = 2


def close_crop(img: Image.Image) -> Image.Image:
    """The hunter's stage box, identical for both scenes."""
    crop = img.crop((40, 56, 248, 238))
    tile = Image.new("RGB", (TILE_W, TILE_H), (12, 12, 16))
    tile.paste(crop, ((TILE_W - crop.width) // 2, (TILE_H - crop.height) // 2))
    return tile


def main() -> None:
    armed = Image.open(SAMPLES / "roam-dustwaste.png").convert("RGB")
    unarmed = Image.open(SAMPLES / "roam-unarmed.png").convert("RGB")
    tiles = [
        (armed, "ARMED - equipped: baked rifle + compositor weapon (unchanged)"),
        (unarmed, "UNARMED - no weapon equipped: hands at sides, no phantom rifle"),
        (close_crop(armed), "armed hunter close-up"),
        (close_crop(unarmed), "unarmed hunter close-up - empty hands"),
    ]
    rows = (len(tiles) + COLS - 1) // COLS
    board = Image.new("RGB", (COLS * TILE_W, rows * (TILE_H + LABEL_H)), (12, 12, 16))
    draw = ImageDraw.Draw(board)
    for i, (tile, label) in enumerate(tiles):
        x = (i % COLS) * TILE_W
        y = (i // COLS) * (TILE_H + LABEL_H)
        board.paste(tile, (x, y))
        draw.text((x + 8, y + TILE_H + 5), label, fill=(230, 230, 235))
    out = SAMPLES / "board-unarmed.png"
    board.save(out, optimize=True)
    print(f"board: {out} {board.size}")


if __name__ == "__main__":
    main()
