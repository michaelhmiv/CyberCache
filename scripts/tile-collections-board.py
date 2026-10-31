#!/usr/bin/env python3
"""Tile the collections sample into one review board.

Input: docs/pixel-samples/collections-shelf.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-collections.png — the full trophy
shelf, a close crop of the found shelf (legendaries in color, the
center frame under the G-1 beam), and a close crop of a silhouette
plaque (the unproven read). Review artifact for the collections +
legendary cores slice (0026); baselines are Claude-reviewed per
Michael's golden ruling.
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
    shelf = Image.open(SAMPLES / "collections-shelf.png").convert("RGB")
    tiles = [
        (shelf, "collections-shelf - the trophy shelf"),
        (centered_crop(shelf, (92, 74, 364, 126)), "found shelf - color + beam read"),
        (centered_crop(shelf, (272, 112, 368, 180)), "silhouette plaque - the unproven read"),
    ]
    board = Image.new("RGB", (COLS * TILE_W, TILE_H + LABEL_H), (12, 12, 16))
    draw = ImageDraw.Draw(board)
    for i, (tile, label) in enumerate(tiles):
        x = i * TILE_W
        board.paste(tile, (x, 0))
        draw.rectangle([x, TILE_H, x + TILE_W, TILE_H + LABEL_H], fill=(24, 24, 30))
        draw.text((x + 8, TILE_H + 6), label, fill=(232, 228, 216))
    board.save(SAMPLES / "board-collections.png")
    print(f"board board-collections: {len(tiles)} tiles")


if __name__ == "__main__":
    main()
