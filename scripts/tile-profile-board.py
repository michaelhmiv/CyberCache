#!/usr/bin/env python3
"""Tile the profile-showcase sample into one review board.

Input: docs/pixel-samples/profile-showcase.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-profile.png — the full trophy
shelf, a close crop of the top-3 weapon plank (real compositor
renders, the center Legendary under its beam), and a close crop of
the fact row (endless depth track, Cache Rank diamond, collections
strip). Review artifact for the Profile showcase slice (0034);
baselines are Claude-reviewed per Michael's golden ruling.
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
    panel = Image.open(SAMPLES / "profile-showcase.png").convert("RGB")
    tiles = [
        (panel, "profile-showcase - the trophy shelf"),
        (centered_crop(panel, (120, 40, 436, 132)), "top-3 plank - server-ranked weapons"),
        (centered_crop(panel, (126, 136, 440, 214)), "fact row - depth track, rank diamond, strip"),
    ]
    board = Image.new("RGB", (COLS * TILE_W, TILE_H + LABEL_H), (12, 12, 16))
    draw = ImageDraw.Draw(board)
    for i, (tile, label) in enumerate(tiles):
        x = i * TILE_W
        board.paste(tile, (x, 0))
        draw.text((x + 8, TILE_H + 5), label, fill=(220, 220, 230))
    board.save(SAMPLES / "board-profile.png")
    print(f"wrote {SAMPLES / 'board-profile.png'}")


if __name__ == "__main__":
    main()
