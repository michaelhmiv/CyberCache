#!/usr/bin/env python3
"""Tile the contracts-board samples into one review board.

Inputs: docs/pixel-samples/contracts-board.png and
contracts-board-weekly.png (from scripts/render-overhaul-samples.ts
— the golden baselines' twins). Output:
docs/pixel-samples/board-contracts.png — the daily board (three
work orders mid-progress on the war-room table), the weekly board
(five orders, one claimable lit under the standard beam, the key
diamond on the bonus line), and a close crop of the claimable
weekly card. Review artifact for the Contracts Board slice (0042);
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
    daily = Image.open(SAMPLES / "contracts-board.png").convert("RGB")
    weekly = Image.open(SAMPLES / "contracts-board-weekly.png").convert("RGB")
    tiles = [
        (daily, "contracts-board - daily set, one claimable"),
        (weekly, "contracts-board-weekly - five orders, key bonus"),
        (centered_crop(weekly, (108, 24, 374, 110)), "claimable card - standard beam, lit"),
    ]
    board = Image.new("RGB", (COLS * TILE_W, TILE_H + LABEL_H), (12, 12, 16))
    draw = ImageDraw.Draw(board)
    for i, (tile, label) in enumerate(tiles):
        x = i * TILE_W
        board.paste(tile, (x, LABEL_H))
        draw.text((x + 6, 5), label, fill=(232, 179, 61))
    board.save(SAMPLES / "board-contracts.png")
    print(f"wrote {SAMPLES / 'board-contracts.png'}")


if __name__ == "__main__":
    main()
