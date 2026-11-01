#!/usr/bin/env python3
"""Merge per-segment screen-inventory manifests into the final inventory.

The crawl runs as one `am instrument` invocation per area segment
(scripts/crawl-screen-inventory.sh), and the workflow pulls the
on-device output dir after EVERY segment into:

    screen-inventory-out/segments/<segment>/screen-inventory/

Each segment's manifest.json contains only that segment's stops. This
script merges them into the ONE final manifest the design review (and
the workflow's MIN_REACHED_STOPS verify step) consumes:

    screen-inventory-final/manifest.json   (exactly 32 entries,
                                             canonical visit order)
    screen-inventory-final/NN-<screen>.png / .xml
    screen-inventory-final/diagnostics-<segment>.txt  (when present)

Merge rules:
  - Entries appear in canonical order (SEGMENTS below). This list is
    the merge-side copy of the crawl map — keep it in sync with
    ScreenInventoryTest's segment methods and docs/SCREEN_INVENTORY.md.
  - A stop present in its segment's manifest keeps its recorded
    reached/note. Its screenshot (+ hierarchy XML) is copied into the
    final dir and renumbered in merged visit order; the entry's
    `file` is rewritten to the new name. A "reached" entry whose
    screenshot exists in NO pull is downgraded to missed — a reached
    claim without evidence is the false-positive class this harness
    exists to prevent.
  - A stop missing from a LIVE segment's manifest (the segment ended
    before attempting it, e.g. the instrument was timeout-killed) is
    synthesized as missed saying exactly that.
  - Every stop of a DEAD segment (listed in dead-segments.txt — the
    segment produced no manifest even after one emulator restart +
    retry) is synthesized as missed with reason "emulator died".
  - A segment with no manifest that was never marked dead (the crawl
    step itself ended early) gets the same treatment with a note
    saying the segment never reported.

Usage: merge-screen-inventory.py [out-dir] [final-dir]
Defaults: screen-inventory-out screen-inventory-final
Always exits 0 — coverage judgement belongs to the verify step.
"""

import json
import os
import shutil
import sys

# Canonical crawl map: segment -> stops in visit order.
SEGMENTS = [
    ("board", ["auth", "starter-bundle-reveal", "board-home",
               "board-area-picker", "board-panels", "settings",
               "crack-cache", "dispatch"]),
    ("action", ["action-main", "action-roaming", "action-switcher",
                "action-extraction", "action-crafting", "boss-select",
                "boss-prep"]),
    ("gear", ["gear-loadout", "gear-garage", "gear-grid", "gear-inspect",
              "gear-items", "gear-workshop"]),
    ("market", ["market-vendor", "market-buy", "market-repair",
                "market-shield-tech"]),
    ("rank", ["rank-leaderboards"]),
    ("hunter", ["hunter-profile", "hunter-cache-rank", "hunter-research",
                "hunter-skill-trees", "hunter-account-tools",
                "collections"]),
]


def load_segment_entries(out_dir, segment):
    """Return {screen: entry} for one segment, or None if no manifest."""
    path = os.path.join(out_dir, "segments", segment,
                        "screen-inventory", "manifest.json")
    if not os.path.isfile(path):
        return None
    try:
        with open(path) as f:
            entries = json.load(f).get("entries", [])
    except (ValueError, OSError) as e:
        print(f"WARNING: segment '{segment}' manifest unreadable ({e}); "
              "treating the segment as unreported.")
        return None
    by_screen = {}
    for e in entries:
        screen = e.get("screen", "")
        if screen in by_screen:
            print(f"WARNING: duplicate entry for '{screen}' in segment "
                  f"'{segment}'; keeping the last.")
        by_screen[screen] = e
    return by_screen


def find_pulled_file(out_dir, owner_segment, filename):
    """Locate a pulled file: the owning segment's pull first, then every
    other segment's pull (later pulls are supersets while the device
    lives, but a dead segment's own pull is the only copy of its files
    if the emulator died before the next segment ran)."""
    order = [owner_segment] + [s for s, _ in SEGMENTS if s != owner_segment]
    for seg in order:
        candidate = os.path.join(out_dir, "segments", seg,
                                 "screen-inventory", filename)
        if os.path.isfile(candidate):
            return candidate
    return None


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "screen-inventory-out"
    final_dir = sys.argv[2] if len(sys.argv) > 2 else "screen-inventory-final"
    os.makedirs(final_dir, exist_ok=True)

    dead = set()
    dead_path = os.path.join(out_dir, "dead-segments.txt")
    if os.path.isfile(dead_path):
        with open(dead_path) as f:
            dead = {line.strip() for line in f if line.strip()}

    merged = []
    seq = 0
    for segment, stops in SEGMENTS:
        entries = load_segment_entries(out_dir, segment)
        known = set(stops)
        if entries:
            for screen in entries:
                if screen not in known:
                    print(f"WARNING: segment '{segment}' reported unknown "
                          f"stop '{screen}' (not in the canonical map); "
                          "ignoring it. Update the map in all three places.")
        for screen in stops:
            entry = entries.get(screen) if entries else None
            if entry is None:
                if segment in dead:
                    note = (f"emulator died — segment '{segment}' produced no "
                            f"manifest after one emulator restart + retry "
                            f"(see diagnostics-{segment}.txt).")
                elif entries is None:
                    note = (f"segment '{segment}' produced no manifest "
                            "(the crawl step ended before the segment "
                            "reported).")
                else:
                    note = (f"segment '{segment}' ended before this stop "
                            "was attempted (no entry in the segment "
                            "manifest).")
                merged.append({"file": "", "screen": screen,
                               "reached": False, "note": note})
                continue
            note = entry.get("note", "")
            filename = entry.get("file", "")
            reached = bool(entry.get("reached"))
            if reached and filename:
                src = find_pulled_file(out_dir, segment, filename)
                if src is None:
                    merged.append({
                        "file": "", "screen": screen, "reached": False,
                        "note": note + " [screenshot file missing from "
                                "every pull — recorded as missed: a "
                                "reached claim without evidence is not "
                                "counted]"})
                    continue
                seq += 1
                new_base = f"{seq:02d}-{screen}"
                new_name = new_base + ".png"
                shutil.copyfile(src, os.path.join(final_dir, new_name))
                xml_src = find_pulled_file(
                    out_dir, segment,
                    os.path.splitext(filename)[0] + ".xml")
                if xml_src is not None:
                    shutil.copyfile(xml_src,
                                    os.path.join(final_dir, new_base + ".xml"))
                merged.append({"file": new_name, "screen": screen,
                               "reached": True, "note": note})
            else:
                merged.append({"file": "", "screen": screen,
                               "reached": reached, "note": note})

    manifest = {
        "generatedBy": "ScreenInventoryTest (segmented crawl, merged by "
                       "scripts/merge-screen-inventory.py)",
        "package": "com.michaelhmiv.cybercache",
        "entries": merged,
    }
    with open(os.path.join(final_dir, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    # Diagnostics ride along in the artifact — they are the evidence
    # for any dead segment's synthesized misses.
    if os.path.isdir(out_dir):
        for name in sorted(os.listdir(out_dir)):
            if name.startswith("diagnostics-") and name.endswith(".txt"):
                shutil.copyfile(os.path.join(out_dir, name),
                                os.path.join(final_dir, name))

    reached = sum(1 for e in merged if e["reached"])
    print(f"Merged manifest: {reached}/{len(merged)} stops reached "
          f"across {len(SEGMENTS)} segments "
          f"(dead segments: {', '.join(sorted(dead)) or 'none'}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
