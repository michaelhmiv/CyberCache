#!/usr/bin/env python3
"""Tile the extraction samples into one review board.

Inputs: docs/pixel-samples/extraction-surface.png,
extraction-deep.png, extraction-paused.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins)
and the three extraction set-piece sprites themselves.
Output: docs/pixel-samples/board-extraction.png — Surface Sweep
at work (signature beam over the crates), Deep Delve under its
indigo shade, the paused site idle-dark under its pennant, and
the set pieces at native scale. Review artifact for the
Extraction slice (0033); baselines are Claude-reviewed per
Michael's golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"
SPRITES = ROOT / "src" / "assets" / "pixel" / "sprites"

TILE_W = 384
TILE_H = 256
LABEL_H = 22
COLS = 2
ROWS = 2


def fit(img: Image.Image) -> Image.Image:
    scale = min(TILE_W / img.width, TILE_H / img.height)
    scaled = img.resize(
        (round(img.width * scale), round(img.height * scale)),
        Image.NEAREST,
    )
    tile = Image.new("RGB", (TILE_W, TILE_H), (12, 12, 16))
    tile.paste(scaled, ((TILE_W - scaled.width) // 2, (TILE_H - scaled.height) // 2))
    return tile


def setpiece_tile() -> Image.Image:
    tile = Image.new("RGB", (TILE_W, TILE_H), (12, 12, 16))
    draw = ImageDraw.Draw(tile)
    names = [
        ("set-extract-stakes.png", "claim stakes"),
        ("set-extract-rig.png", "sift rig"),
        ("set-extract-crates.png", "sorted crates"),
    ]
    x = 4
    for file, label in names:
        sprite = Image.open(SPRITES / file).convert("RGBA")
        scaled = sprite.resize((120, 75), Image.NEAREST)
        tile.paste(scaled, (x, 70), scaled)
        draw.text((x + 2, 155), label, fill=(220, 220, 230))
        x += 128
    return tile


def main() -> None:
    tiles = [
        (fit(Image.open(SAMPLES / "extraction-surface.png").convert("RGB")), "extraction-surface - work pose, signature beam on the crates"),
        (fit(Image.open(SAMPLES / "extraction-deep.png").convert("RGB")), "extraction-deep - delve shade, the rig works bigger"),
        (fit(Image.open(SAMPLES / "extraction-paused.png").convert("RGB")), "extraction-paused - idle-dark, pennant up, slot elsewhere"),
        (setpiece_tile(), "set pieces - stakes / rig / crates at native scale"),
    ]
    board = Image.new(
        "RGB",
        (COLS * TILE_W, ROWS * (TILE_H + LABEL_H)),
        (12, 12, 16),
    )
    draw = ImageDraw.Draw(board)
    for i, (tile, label) in enumerate(tiles):
        x = (i % COLS) * TILE_W
        y = (i // COLS) * (TILE_H + LABEL_H)
        board.paste(tile, (x, y))
        draw.text((x + 8, y + TILE_H + 5), label, fill=(220, 220, 230))
    board.save(SAMPLES / "board-extraction.png")
    print(f"wrote {SAMPLES / 'board-extraction.png'}")


if __name__ == "__main__":
    main()
