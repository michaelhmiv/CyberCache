---
version: 1
slug: "src-screens-profilescreen-tsx"
primary_target: "src/screens/ProfileScreen.tsx"
related_targets: []
---

# Hunter menu — look round (pass 2, 2026-11-04)

Scope: Hunter tab landing (ProfileScreen hub stop) + the hub back-row header.
Mode: Operate. Path: code-led. Audience: the hunter checking in for a short
session; the tab's job is "what's waiting for me, and where do I stand."

Pinned by the owner/brief (not up for redesign): Hub skeleton from pass 1 —
identity hero with announcements, then live-status doors in progression
order (Skill Trees first and full-width, Research, Cache Rank, Standings,
Collections, Wardrobe + Account at the tail, Profile & Record last);
cosmetics demoted, never deleted. Hard floors: four tabs unchanged, PxIcon
only (no emoji/unicode icons), 11px type floor, ≥44dp targets, numbers as
heroes, unspent points must catch the eye. Pass 1's failure, owner-verbatim:
the shipped card grammar (dark card + rarity-colored LEFT BAR) is "ai slop";
pass 1 restrained the design to existing grammar and only rearranged it.
This round designs the LOOK. The colored side bar is banned in all three
languages; rarity/system color may live only as numerals, chips, foot
strips, or light — never as a vertical side stripe.

## Direction contract — three languages, one skeleton

THESIS: the menu's information architecture was never the problem; its
visual language was a template. Each language below is a complete chrome
system (hero, door, status row, back-row) drawn from the game's own
register, so the owner picks a world, not a layout.

OWN-WORLD A — ARENA PLATES. Doors are boss-arena plates: clipped corners,
2px machined frame with a steel inset line, corner bolt squares, hard
scrim text (fitted heavy uppercase), foot strips instead of side bars,
hero plate carries a real arena painting band behind the scrim. Numbers
are inset gauges. Amber appears as the points chip + foot strip only.
OWN-WORLD B — THE MANIFEST. No containers at all: a stamped field ledger
on the bare ground. Bebas Neue display names, hairline rules with column
ticks, tabular data lines, hero numerals right-aligned in bone white.
Color is meaning only (amber = action waiting). The points announcement
is a rotated rubber-stamp tag — the one loud object on the page.
OWN-WORLD C — LID & LATCH. The menu is the inside of the cache lid: warm
rust-brown ground, doors as banded crate faces with stenciled Bebas
labels, contents lines like packing lists, latch blocks on the right
edge. The Skill Trees crate's lid is ajar — an amber-glow seam — because
points are waiting; every other crate sits dark and shut.

STORY: whichever language wins, the first screen answers "what's waiting"
(points, research, earnings) before any tap, and cosmetics read as cargo
at the tail, not the cargo's owner.

FIRST VIEWPORT: hub order unchanged in all three; hero ~150–190px, trees
door directly under it, paired doors below, wardrobe/account/profile at
the tail; the whole menu aims to fit or near-fit 412×915.

FORM: replacement chrome inside an established surface; pass-1 Hub IA is
the brief-pinned skeleton (seed: none (unavailable)).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
