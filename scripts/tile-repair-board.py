#!/usr/bin/env python3
"""Tile the repair-bay samples into one review board.

Inputs: docs/pixel-samples/<scene>.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-repair.png — the bay at rest (idle,
no job), mid-job (0025 wires RepairBayScene to the board's server
state), and at delivery (full track, celebrate pose). Review artifact
for the mechanics & repair slice; baselines are Claude-reviewed per
Michael's golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

TILES = [
    ("bay-idle", "Bay idle - no job posted"),
    ("bay", "Job running - mechanic at work"),
    ("bay-complete", "Delivered - job complete"),
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

    board.save(SAMPLES / "board-repair.png")
    print(f"board board-repair: {len(TILES)} tiles")


if __name__ == "__main__":
    main()
