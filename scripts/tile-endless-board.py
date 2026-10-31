#!/usr/bin/env python3
"""Tile the endless-mode samples into one review board.

Inputs: docs/pixel-samples/<scene>.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-endless.png — the Chaos Chamber at
depth 1 (bare arena, one pip), depth 12 (band-2 wash over the
Prismatek rotation), and depth 25 (a boss depth under the band-4
wash, full 25-pip track). Review artifact for the endless slice;
baselines are Claude-reviewed per Michael's golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

TILES = [
    ("endless-depth-1", "Depth 1 - Dustwaste pack, band 0"),
    ("endless-depth-12", "Depth 12 - Prismatek pack, band 2 wash"),
    ("endless-depth-25", "Depth 25 - Mirage Duster, band 4 wash"),
]

TILE_W = 384
TILE_H = 256
LABEL_H = 22
COLS = 3


def main() -> None:
    board = Image.new(
        "RGB",
        (COLS * TILE_W, TILE_H + LABEL_H),
        (12, 12, 16),
    )
    draw = ImageDraw.Draw(board)
    for i, (scene_id, label) in enumerate(TILES):
        path = SAMPLES / f"{scene_id}.png"
        if not path.exists():
            continue
        img = Image.open(path).convert("RGB")
        x = i * TILE_W
        board.paste(img, (x, 0))
        draw.rectangle([x, TILE_H, x + TILE_W, TILE_H + LABEL_H], fill=(24, 24, 30))
        draw.text((x + 8, TILE_H + 6), f"{scene_id} - {label}", fill=(232, 228, 216))

    board.save(SAMPLES / "board-endless.png")
    print(f"board board-endless: {len(TILES)} tiles")


if __name__ == "__main__":
    main()
