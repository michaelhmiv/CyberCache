#!/usr/bin/env python3
"""Tile the shield-tech bay samples into one review board.

Inputs: docs/pixel-samples/<scene>.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-shieldtech.png — the calibration
rig mid-job (ring lit with the target behavior's sigil, second core
on the tray, track at half) and at the flip (full track, the beam in
the new behavior's color, celebrate pose). Review artifact for the
shield-tech services slice; baselines are Claude-reviewed per
Michael's golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

TILES = [
    ("shieldtech-progress", "Calibrating - rig lit, track at half"),
    ("shieldtech-complete", "Flip landed - behavior recalibrated"),
]

TILE_W = 384
TILE_H = 256
LABEL_H = 22
COLS = 2


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

    board.save(SAMPLES / "board-shieldtech.png")
    print(f"board board-shieldtech: {len(TILES)} tiles")


if __name__ == "__main__":
    main()
