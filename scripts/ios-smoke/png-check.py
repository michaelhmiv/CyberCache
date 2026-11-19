#!/usr/bin/env python3
"""Assert that a simulator screenshot shows a rendered game screen.

Stdlib-only PNG decode (no PIL on the runner image we can rely on). The
failure this guards against is a blank WebView: a white or solid-color
frame where the game should be. CyberCache's first screen is a dark,
pixel-dense game screen (splash background #08090d), so a rendered frame
has many distinct colors and a low mean luminance; a failed load has
~1 color at luminance ~1.0.

Usage: png-check.py <screenshot.png>
Thresholds can be overridden by env: SMOKE_MIN_DISTINCT_COLORS,
SMOKE_MAX_DOMINANT_SHARE, SMOKE_MAX_MEAN_LUMINANCE.
Prints a JSON stats line; exit 0 = rendered, 1 = violation, 2 = unreadable.
"""

import json
import os
import struct
import sys
import zlib
from collections import Counter


def decode_png(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    pos = 8
    idat = bytearray()
    plte = None
    width = height = bit_depth = color_type = None
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk[:10])
        elif ctype == b"PLTE":
            plte = chunk
        elif ctype == b"IDAT":
            idat.extend(chunk)
        elif ctype == b"IEND":
            break
        pos += 12 + length
    if bit_depth != 8 or color_type not in (2, 3, 6):
        raise ValueError(f"unsupported PNG: bit_depth={bit_depth} color_type={color_type}")
    channels = {2: 3, 3: 1, 6: 4}[color_type]
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    pixels = bytearray(width * height * channels)
    prev = bytearray(stride)
    src = 0
    for y in range(height):
        filt = raw[src]
        src += 1
        line = bytearray(raw[src:src + stride])
        src += stride
        if filt == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif filt == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif filt == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif filt == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        pixels[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, plte, pixels


def main():
    path = sys.argv[1]
    try:
        width, height, channels, plte, pixels = decode_png(path)
    except Exception as error:  # noqa: BLE001 — any decode failure is a failed check
        print(json.dumps({"file": path, "error": f"unreadable PNG: {error}"}))
        return 2

    step = 7  # sample every 7th pixel: plenty for distribution stats
    colors = Counter()
    luminance_sum = 0.0
    sampled = 0
    total_px = width * height
    for idx in range(0, total_px, step):
        off = idx * channels
        if channels == 1:
            entry = pixels[off]
            r, g, b = plte[entry * 3:entry * 3 + 3]
        else:
            r, g, b = pixels[off], pixels[off + 1], pixels[off + 2]
        colors[(r >> 3, g >> 3, b >> 3)] += 1
        luminance_sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
        sampled += 1

    distinct = len(colors)
    dominant_share = colors.most_common(1)[0][1] / sampled
    mean_luminance = luminance_sum / sampled
    stats = {
        "file": path,
        "width": width,
        "height": height,
        "sampled": sampled,
        "distinctColors": distinct,
        "dominantColorShare": round(dominant_share, 4),
        "meanLuminance": round(mean_luminance, 4),
    }
    print(json.dumps(stats))

    min_distinct = int(os.environ.get("SMOKE_MIN_DISTINCT_COLORS", "400"))
    max_dominant = float(os.environ.get("SMOKE_MAX_DOMINANT_SHARE", "0.92"))
    max_luminance = float(os.environ.get("SMOKE_MAX_MEAN_LUMINANCE", "0.90"))
    problems = []
    if distinct < min_distinct:
        problems.append(f"only {distinct} distinct colors (< {min_distinct}): frame looks blank/flat")
    if dominant_share > max_dominant:
        problems.append(f"one color covers {dominant_share:.1%} of the frame (> {max_dominant:.0%}): frame looks blank")
    if mean_luminance > max_luminance:
        problems.append(f"mean luminance {mean_luminance:.2f} (> {max_luminance}): frame looks like a white error page")
    for problem in problems:
        print(f"::error::{problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
