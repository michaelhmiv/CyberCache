#!/usr/bin/env python3
"""Tile the action-skill samples into one review board.

Inputs: docs/pixel-samples/<scene>.png (from
scripts/render-overhaul-samples.ts — the golden baselines' twins).
Output: docs/pixel-samples/board-action-skill.png — the two new
golden scenes of the action-skill slice (0030): bench-overdrive,
the Fixer signature's workshop fire (Fixer brief §3.7: G-3 charge
track full in Fixer teal, G-1 beam at the bench), and
boss-signature-fire, the Gunslinger's Deadeye Salvo landing on the
boss stage (tree-color beam, charge track spent). The third tile is
reforge-bench (0027), the composition template bench-overdrive
follows, for side-by-side review. Baselines are Claude-reviewed per
Michael's golden ruling.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

TILES = [
    ("bench-overdrive", "Overclock fires - teal beam, G-3 track full"),
    ("boss-signature-fire", "Deadeye Salvo lands - red beam, track spent"),
    ("reforge-bench", "Composition template (0027)"),
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

    board.save(SAMPLES / "board-action-skill.png")
    print(f"board board-action-skill: {len(TILES)} tiles")


if __name__ == "__main__":
    main()
