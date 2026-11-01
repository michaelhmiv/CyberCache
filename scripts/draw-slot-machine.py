#!/usr/bin/env python3
"""Draw the Data Slots machine prop sprite (prop-slot-machine.png).

Hand-authored pixel art for the slot-machine slice (0049): a vendor
cabinet with a starred marquee, three reel windows carrying the
game's own glyph language (credit stack / cache fragment / cache
key — never card suits or fruit, brief §2.9), a side lever, a light
strip, and a coin tray. Deterministic: run it, get the same PNG.

    python3 scripts/draw-slot-machine.py
"""
import struct
import zlib
from pathlib import Path

W, H = 48, 64

# Palette (RGBA).
K = (20, 22, 28, 255)      # outline near-black
D = (35, 39, 51, 255)      # cabinet dark metal
M = (57, 65, 90, 255)      # mid metal
L = (91, 106, 140, 255)    # light metal
A = (242, 192, 99, 255)    # amber
a = (185, 127, 46, 255)    # amber shade
W_ = (16, 22, 35, 255)     # reel glass
G = (159, 216, 232, 255)   # glass glint / key highlight
C = (87, 230, 217, 255)    # fragment cyan
R = (226, 72, 61, 255)     # lever knob red
S = (255, 233, 163, 255)   # marquee star
T = (44, 50, 71, 255)      # tray inset
CLEAR = (0, 0, 0, 0)

px = [[CLEAR for _ in range(W)] for _ in range(H)]


def put(x, y, color):
    if 0 <= x < W and 0 <= y < H:
        px[y][x] = color


def rect(x, y, w, h, color):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            put(xx, yy, color)


def frame(x, y, w, h, color):
    rect(x, y, w, 1, color)
    rect(x, y + h - 1, w, 1, color)
    rect(x, y, 1, h, color)
    rect(x + w - 1, y, 1, h, color)


def disc(cx, cy, r, color):
    for yy in range(cy - r, cy + r + 1):
        for xx in range(cx - r, cx + r + 1):
            if (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r:
                put(xx, yy, color)


# Lever (behind the cabinet's right edge): rod + red knob.
rect(43, 12, 2, 20, L)
rect(43, 12, 1, 20, M)
disc(44, 8, 4, K)
disc(44, 8, 3, R)
put(43, 7, S)

# Cabinet body + plinth.
rect(1, 58, 40, 4, K)
rect(2, 58, 38, 3, M)
rect(3, 4, 36, 55, K)
rect(4, 5, 34, 53, D)
rect(4, 5, 34, 1, M)

# Marquee: amber frame, dark face, bright star, corner bolts.
rect(5, 5, 32, 10, A)
rect(6, 6, 30, 8, D)
for bx, by in ((7, 7), (34, 7), (7, 12), (34, 12)):
    put(bx, by, a)
star = [(20, 7), (19, 8), (20, 8), (21, 8), (18, 9), (19, 9), (20, 9), (21, 9), (22, 9),
        (19, 10), (20, 10), (21, 10), (18, 11), (22, 11)]
for sx, sy in star:
    put(sx, sy, S)
put(20, 8, A)

# Reel band: glass with three windows.
rect(5, 16, 32, 16, K)
rect(6, 17, 30, 14, W_)
for wx in (7, 17, 27):
    frame(wx, 18, 7, 12, L)
    rect(wx + 1, 19, 5, 1, G)  # glass glint along the top

# Window 1 — credit stack (amber bars, narrowing upward).
rect(8, 27, 5, 2, a)
rect(8, 26, 5, 1, A)
rect(9, 24, 4, 2, A)
rect(9, 23, 4, 1, S)
rect(10, 21, 3, 2, A)

# Window 2 — cache fragment (cyan diamond).
frag = [(20, 20), (19, 21), (20, 21), (21, 21), (18, 22), (19, 22), (20, 22), (21, 22),
        (22, 22), (19, 23), (20, 23), (21, 23), (20, 24)]
for fx, fy in frag:
    put(fx, fy, C)
put(19, 21, G)
rect(18, 26, 5, 1, T)

# Window 3 — cache key (gold ring + shaft + teeth).
for kx, ky in ((29, 20), (30, 20), (31, 20), (29, 21), (31, 21), (29, 22), (30, 22), (31, 22)):
    put(kx, ky, S)
put(30, 21, W_)
for kx, ky in ((32, 23), (32, 24), (33, 24), (33, 25), (34, 25), (34, 26)):
    put(kx, ky, A)
put(34, 27, A)
put(32, 26, A)

# Light strip: alternating lamps under the reels.
for i, color in enumerate((A, R, C, A, R)):
    rect(8 + i * 6, 34, 3, 2, color)
rect(5, 33, 32, 1, K)
rect(5, 37, 32, 1, K)

# Pay plate: the printed-table plate (three ruled lines).
rect(7, 40, 28, 6, M)
rect(9, 41, 24, 1, D)
rect(9, 43, 24, 1, D)
rect(9, 45, 16, 1, D)

# Coin tray with coins.
rect(7, 48, 28, 8, K)
rect(8, 49, 26, 6, T)
disc(14, 52, 2, A)
disc(21, 52, 2, A)
disc(28, 52, 2, A)
put(13, 51, S)
put(20, 51, S)
put(27, 51, S)

# Cabinet feet shading.
rect(4, 56, 34, 1, K)


def encode_png(rows):
    raw = b""
    for row in rows:
        raw += b"\x00" + b"".join(struct.pack("BBBB", *c) for c in row)

    def chunk(kind, data):
        out = struct.pack(">I", len(data)) + kind + data
        out += struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        return out

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


dest = Path(__file__).resolve().parent.parent / "src/assets/pixel/sprites/prop-slot-machine.png"
dest.write_bytes(encode_png(px))
print(f"wrote {dest} ({W}x{H})")
