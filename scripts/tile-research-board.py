#!/usr/bin/env python3
"""Tile the research samples into one review board.

Inputs: docs/pixel-samples/research-study.png and
research-complete.png (the golden baselines' twins) and the
research set-piece sprites themselves.
Output: docs/pixel-samples/board-research.png — the study scene
(hunter at the terminal, G-3 track at ~40%), the completion scene
(G-6 faculty flash + G-1 beam over the credential shelf, track
full), and the set pieces at native scale. Review artifact for
the Research slice (0038); baselines are Claude-reviewed per
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
        ("set-research-terminal.png", "study terminal"),
        ("set-research-shelf.png", "credential shelf"),
        ("set-war-room-table.png", "war-room table"),
    ]
    x = 4
    for file, label in names:
        sprite = Image.open(SPRITES / file).convert("RGBA")
        scaled = sprite.resize((120, 75), Image.NEAREST)
        tile.paste(scaled, (x, 70), scaled)
        draw.text((x + 2, 155), label, fill=(220, 220, 230))
        x += 128
    return tile


def manifest_tile() -> Image.Image:
    tile = Image.new("RGB", (TILE_W, TILE_H), (12, 12, 16))
    draw = ImageDraw.Draw(tile)
    lines = [
        "RESEARCH - the parallel education track (0038)",
        "",
        "4 faculties x 3 tiers - 12 courses",
        "37 days sequential - 310,000 cr of sink",
        "progress is pure wall-clock; completion settles lazily",
        "no player XP - Scholarship mastery + the unlock",
        "",
        "study: terminal + shelf + war-room table, track ~40%",
        "complete: G-6 flash in faculty color, beam on the shelf",
    ]
    y = 60
    for line in lines:
        draw.text((16, y), line, fill=(220, 220, 230))
        y += 16
    return tile


def main() -> None:
    tiles = [
        (fit(Image.open(SAMPLES / "research-study.png").convert("RGB")), "research-study - hunter at the terminal, track at 40%"),
        (fit(Image.open(SAMPLES / "research-complete.png").convert("RGB")), "research-complete - faculty flash, beam on the credential shelf"),
        (setpiece_tile(), "set pieces - terminal / shelf / table at native scale"),
        (manifest_tile(), "the slice in one tile"),
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
    board.save(SAMPLES / "board-research.png")
    print(f"wrote {SAMPLES / 'board-research.png'}")


if __name__ == "__main__":
    main()
