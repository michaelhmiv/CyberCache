#!/usr/bin/env python3
"""Tile the overhaul gate samples into labeled review boards (G0–G4).

Inputs: docs/pixel-samples/<scene>.png (from
scripts/render-overhaul-samples.ts). Outputs: docs/pixel-samples/
board-g0-grammar.png ... board-g4-scenes.png plus board-areas.png and
board-arenas.png. Boards are review artifacts for the art-direction
gates; the per-scene PNGs are the golden baselines' twins.
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "docs" / "pixel-samples"

BOARDS = {
    "board-g0-grammar": [
        ("loot-legendary", "G-1/G-2 beam + card"),
        ("loot-rare", "G-2 card, rare"),
        ("bench", "G-3/G-4/G-5 bench"),
        ("bay", "G-3/G-4/G-5 repair bay"),
    ],
    "board-g1-rig": [
        ("roam-dustwaste", "rig at aim"),
        ("fx-shock", "rig at recoil"),
        ("loot-legendary", "celebrate + enemy death"),
        ("elite-dustwaste", "bespoke elite"),
    ],
    "board-g2-dustwaste": [
        ("roam-dustwaste", "Dustwaste complete"),
        ("roam-hot", "hot-area treatment"),
        ("elite-dustwaste", "Silt Marshal"),
        ("vehicle-roam", "vehicle parked (Q4)"),
    ],
    "board-g3-elements": [
        ("fx-kinetic", "Kinetic"),
        ("fx-fire", "Fire"),
        ("fx-shock", "Shock"),
        ("fx-corrosive", "Corrosive"),
        ("fx-cryo", "Cryo"),
        ("fx-void", "Void"),
    ],
    "board-g4-scenes": [
        ("bench", "crafting bench"),
        ("bay", "repair bay"),
        ("loot-epic", "loot moment, epic"),
        ("vehicle-roam", "roaming with vehicle"),
    ],
    "board-areas": [
        ("roam-dustwaste", "Dustwaste"),
        ("roam-redline", "Redline"),
        ("roam-ironwood", "Ironwood"),
        ("roam-blastforge", "BlastForge"),
        ("roam-prismatek", "Prismatek"),
        ("roam-throwtech", "ThrowTech"),
        ("roam-helixworks", "HelixWorks"),
    ],
    "board-arenas": [
        ("arena-dune-tyrant", "Dune Tyrant"),
        ("arena-siltstalker", "Siltstalker"),
        ("arena-heap-guard", "Heap Guard"),
        ("arena-ashgut", "Ashgut"),
        ("arena-mirage-duster", "Mirage Duster"),
        ("arena-rust-prophet", "Rust Prophet"),
        ("arena-scrap-bishop", "Scrap Bishop"),
    ],
}

TILE_W = 384
TILE_H = 256
LABEL_H = 22
COLS = 3


def build_board(name: str, tiles: list[tuple[str, str]]) -> None:
    cols = min(COLS, len(tiles))
    rows = (len(tiles) + cols - 1) // cols
    board = Image.new("RGB", (cols * TILE_W, rows * (TILE_H + LABEL_H)), (12, 12, 16))
    draw = ImageDraw.Draw(board)
    for i, (scene_id, label) in enumerate(tiles):
        path = SAMPLES / f"{scene_id}.png"
        if not path.exists():
            continue
        img = Image.open(path).convert("RGB")
        x = (i % cols) * TILE_W
        y = (i // cols) * (TILE_H + LABEL_H)
        board.paste(img, (x, y))
        draw.rectangle([x, y + TILE_H, x + TILE_W, y + TILE_H + LABEL_H], fill=(24, 24, 30))
        draw.text((x + 8, y + TILE_H + 6), f"{scene_id} - {label}", fill=(232, 228, 216))
    board.save(SAMPLES / f"{name}.png")
    print(f"board {name}: {len(tiles)} tiles")


if __name__ == "__main__":
    for board_name, board_tiles in BOARDS.items():
        build_board(board_name, board_tiles)
