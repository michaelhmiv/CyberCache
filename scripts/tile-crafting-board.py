#!/usr/bin/env python3
"""Tile the crafting-as-occupation samples into one review board.

Inputs: docs/pixel-samples/<scene>.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-crafting.png — the three bench tiers
at work, the paused state, and the G-grammar quality-edge swatches a
completion card wears (brief §2.9). Review artifact for the slice;
baselines are Claude-reviewed per Michael's golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

TILES = [
    ("bench-basic", "Bench 1 - Basic Bench, job running"),
    ("bench", "Bench 2 - Forge, job running"),
    ("bench-lab", "Bench 3 - Lab + refinery furnace"),
    ("bench-paused", "Paused - hunter is roaming"),
]

# GRAMMAR.qualityEdge (src/lib/pixel/grammar.ts): the completion-card
# border a rolled quality earns.
SWATCHES = [
    ((154, 149, 138), "75% Crude"),
    ((232, 228, 216), "100% bone"),
    ((155, 225, 93), "110%+ green"),
    ((255, 209, 102), "130%+ gold"),
]

TILE_W = 384
TILE_H = 256
LABEL_H = 22
COLS = 2
SWATCH_H = 46


def main() -> None:
    rows = (len(TILES) + COLS - 1) // COLS
    board = Image.new(
        "RGB",
        (COLS * TILE_W, rows * (TILE_H + LABEL_H) + SWATCH_H),
        (12, 12, 16),
    )
    draw = ImageDraw.Draw(board)
    for i, (scene_id, label) in enumerate(TILES):
        path = SAMPLES / f"{scene_id}.png"
        if not path.exists():
            continue
        img = Image.open(path).convert("RGB")
        x = (i % COLS) * TILE_W
        y = (i // COLS) * (TILE_H + LABEL_H)
        board.paste(img, (x, y))
        draw.rectangle([x, y + TILE_H, x + TILE_W, y + TILE_H + LABEL_H], fill=(24, 24, 30))
        draw.text((x + 8, y + TILE_H + 6), f"{scene_id} - {label}", fill=(232, 228, 216))

    strip_y = rows * (TILE_H + LABEL_H)
    draw.rectangle([0, strip_y, COLS * TILE_W, strip_y + SWATCH_H], fill=(18, 18, 22))
    draw.text((8, strip_y + 6), "Completion-card quality edges (G-grammar):", fill=(232, 228, 216))
    sw_w = (COLS * TILE_W - 16) // len(SWATCHES)
    for i, (rgb, label) in enumerate(SWATCHES):
        x = 8 + i * sw_w
        draw.rectangle([x, strip_y + 24, x + 26, strip_y + 38], outline=rgb, width=3)
        draw.text((x + 32, strip_y + 25), label, fill=(200, 196, 186))

    board.save(SAMPLES / "board-crafting.png")
    print(f"board board-crafting: {len(TILES)} tiles + {len(SWATCHES)} swatches")


if __name__ == "__main__":
    main()
