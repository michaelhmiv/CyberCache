#!/usr/bin/env python3
"""Runner-side pixel verdicts for Lane 2 (emulator that plays).

Reads the PlaySessionTest output dir (play-result.json + the pulled
screenshots) and asserts the two things UiAutomator cannot see from
the view hierarchy — the same "rendered pixels or it didn't happen"
rule as Lane 1 (scripts/e2e/pixels.mjs):

  1. STAGE IS ALIVE: the stage band's pixels CHANGE between the
     first and last roam captures (a frozen stage — the X-01/A-07
     context-loss shape — produces near-identical frames).
  2. ENEMY IS THERE: in the last roam capture, the enemy region of
     the stage carries actor mass (non-background pixel share above
     threshold), not bare vista.

Also folds in play-result.json: every recorded assertion must be
true. Exit code 0 = the session played and the stage lived; 1 with
a printed verdict table otherwise. Thresholds are the calibration
starting points (see scripts/e2e/README.md); the stage band geometry
is expressed in fractions of the full screenshot because the
emulator profile is fixed (Pixel 7, 1080x2400) but the app strip
layout is not pixel-addressed from outside the WebView.
"""
import json
import sys
from pathlib import Path

from PIL import Image

# Stage band within the full screenshot (fractions of W/H). The Home
# stage sits directly under the top strip; calibration may tighten.
STAGE = (0.00, 0.06, 1.00, 0.36)
# Enemy region within the STAGE band (right side, ground line up).
ENEMY = (0.52, 0.15, 0.44, 0.70)

CHANGE_MIN = 2.0  # mean abs luma distance, 48x48 grid — a live stage clears this easily
NONBG_MIN = 0.05  # enemy-region non-background mass floor (mirrors Lane 1)


def crop_frac(img, frac):
    w, h = img.size
    x, y, fw, fh = frac
    return img.crop((int(x * w), int(y * h), int((x + fw) * w), int((y + fh) * h)))


def luma_grid(img, n=48):
    small = img.convert("L").resize((n, n))
    return list(small.getdata())


def grid_distance(a, b):
    return sum(abs(x - y) for x, y in zip(a, b)) / len(a)


def nonbg_mass(img):
    """Fraction of sampled pixels far from the region's modal colour."""
    small = img.convert("RGB").resize((72, 72))
    px = list(small.getdata())
    counts = {}
    for r, g, b in px:
        key = (r >> 4, g >> 4, b >> 4)
        counts[key] = counts.get(key, 0) + 1
    (mr, mg, mb), _ = max(counts.items(), key=lambda kv: kv[1])
    modal = ((mr << 4) + 8, (mg << 4) + 8, (mb << 4) + 8)
    far = sum(
        1
        for r, g, b in px
        if abs(r - modal[0]) + abs(g - modal[1]) + abs(b - modal[2]) > 90
    )
    return far / len(px), len(counts)


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "play-out/play-session")
    verdicts = []

    def check(name, ok, detail=""):
        verdicts.append((name, ok, detail))
        print(f"[{'PASS' if ok else 'FAIL'}] {name} — {detail}")

    result_file = out_dir / "play-result.json"
    if not result_file.exists():
        check("play-result.json pulled", False, f"missing at {result_file}")
        return finish(verdicts)
    check("play-result.json pulled", True, str(result_file))
    result = json.loads(result_file.read_text())
    for name, ok in result.get("assertions", {}).items():
        check(f"session: {name}", bool(ok), str(result.get("notes", {}).get(name, "")))

    shots = [out_dir / f"play-roam-{i}.png" for i in (1, 2, 3)]
    present = [p for p in shots if p.exists()]
    check("roam screenshots pulled", len(present) == 3, f"{len(present)}/3")
    if len(present) == 3:
        first = Image.open(shots[0])
        last = Image.open(shots[2])
        d = grid_distance(
            luma_grid(crop_frac(first, STAGE)), luma_grid(crop_frac(last, STAGE))
        )
        check("stage pixels change across the roam (stage is alive)", d > CHANGE_MIN, f"distance={d:.2f} (min {CHANGE_MIN})")
        mass, distinct = nonbg_mass(crop_frac(crop_frac(last, STAGE), ENEMY))
        check("enemy pixel mass present in the enemy region", mass > NONBG_MIN and distinct > 30, f"nonBgMass={mass:.3f} distinct={distinct}")

    return finish(verdicts)


def finish(verdicts):
    failed = [n for n, ok, _ in verdicts if not ok]
    print(f"\n{len(verdicts) - len(failed)}/{len(verdicts)} verdicts passed")
    if failed:
        print("FAILING:", ", ".join(failed))
        return 1
    print("emulator play session: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
