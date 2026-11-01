#!/usr/bin/env python3
"""Tile the dispatch samples into one review board.

Inputs: docs/pixel-samples/dispatch-pad.png,
dispatch-courier-return-worn.png, vehicle-roam-leviathan.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins)
and the vehicle sprites themselves.
Output: docs/pixel-samples/board-dispatch.png — the pad, a worn
courier return, the Leviathan at roam, and the three-way class
comparison the Leviathan brief requires (Relay Skimmer / Leviathan
Rig / Cargo Hauler at the same scale: the Rig is the heaviest
silhouette, the Skimmer the lightest). Review artifact for the
Dispatch slice (0032); baselines are Claude-reviewed per Michael's
golden ruling.
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


def comparison_tile() -> Image.Image:
    tile = Image.new("RGB", (TILE_W, TILE_H), (12, 12, 16))
    draw = ImageDraw.Draw(tile)
    names = [
        ("vehicle-relay-skimmer.png", "Relay Skimmer x1.60"),
        ("vehicle-leviathan-rig.png", "Leviathan Rig x1.50"),
        ("vehicle-cargo-hauler.png", "Cargo Hauler x1.10"),
    ]
    x = 4
    for file, label in names:
        sprite = Image.open(SPRITES / file).convert("RGBA")
        scaled = sprite.resize((120, 60), Image.NEAREST)
        tile.paste(scaled, (x, 70), scaled)
        draw.text((x + 2, 150), label, fill=(220, 220, 230))
        x += 128
    return tile


def main() -> None:
    tiles = [
        (fit(Image.open(SAMPLES / "dispatch-pad.png").convert("RGB")), "dispatch-pad - board, route marker, rover departing"),
        (fit(Image.open(SAMPLES / "dispatch-courier-return-worn.png").convert("RGB")), "courier return worn - crawler at ~77, cargo stacked"),
        (fit(Image.open(SAMPLES / "vehicle-roam-leviathan.png").convert("RGB")), "vehicle-roam-leviathan - the Rig at the scene edge"),
        (comparison_tile(), "class comparison - skimmer / leviathan / hauler"),
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
    board.save(SAMPLES / "board-dispatch.png")
    print(f"wrote {SAMPLES / 'board-dispatch.png'}")


if __name__ == "__main__":
    main()
