#!/usr/bin/env python3
"""Tile the cache-rank sample into one review board.

Input: docs/pixel-samples/cache-rank-panel.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-cache-rank.png — the full rank
board, a close crop of the pip rows (seven tracks in their own
colors, filled to the sample ranks), and a close crop of the token
emblem (the unspent-token read). Review artifact for the Cache Rank
slice (0031); baselines are Claude-reviewed per Michael's golden
ruling.
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
    panel = Image.open(SAMPLES / "cache-rank-panel.png").convert("RGB")
    tiles = [
        (panel, "cache-rank-panel - the rank board"),
        (centered_crop(panel, (158, 78, 442, 200)), "pip rows - seven tracks, sample ranks"),
        (centered_crop(panel, (262, 30, 338, 92)), "token emblem - the unspent read"),
    ]
    board = Image.new("RGB", (COLS * TILE_W, TILE_H + LABEL_H), (12, 12, 16))
    draw = ImageDraw.Draw(board)
    for i, (tile, label) in enumerate(tiles):
        x = i * TILE_W
        board.paste(tile, (x, 0))
        draw.text((x + 8, TILE_H + 5), label, fill=(220, 220, 230))
    board.save(SAMPLES / "board-cache-rank.png")
    print(f"wrote {SAMPLES / 'board-cache-rank.png'}")


if __name__ == "__main__":
    main()
