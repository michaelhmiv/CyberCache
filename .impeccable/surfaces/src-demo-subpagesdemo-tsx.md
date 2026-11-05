---
version: 1
slug: "src-demo-subpagesdemo-tsx"
primary_target: "src/demo/SubpagesDemo.tsx"
related_targets: ["src/components/profile/WardrobePanel.tsx","src/screens/HelpScreen.tsx"]
---

# Surface brief — Hunter subpages prototype (Wardrobe + Field Manual)

Scope: prototype-only redesign of two Hunter-tab destinations on branch
`design/hunter-subpages-wardrobe-manual` (demo route `/subpages-demo`,
never merged). Visual world is PINNED by the owner: Arena Plates
(approved anchor: hunter-menu-captures-2/look-plates/01-first-screen.png).
Direction pinned by the owner's brief — no concept roll run; structures
derived from each page's content and task. Code-led (Operate + Read are
code-led). Modes: Wardrobe = Operate (Experience hero), Manual = Read.

## Direction contract

THESIS: One plate family, two compositions that could never be mistaken
for each other: Wardrobe is a fitting stand you handle — the hunter on a
plinth, his mounts mapped around him; the Manual is a bound book you
read — a cover with a contents index, then calm long-form pages. Both
refuse the incumbent grammar (one MobileCard + rarity side bar,
accordion rows) outright.

OWN-WORLD: Arena Plates — clipped-corner iron plates, 2px black frame,
steel inset hairline, corner bolts, bone ink #F5EFE6 on near-black
scrim, numbers in inset gauge wells, 4px foot strips (never side bars),
amber #FF9000 only where an action waits. Bebas Neue for fitted plate
type, Chakra Petch for data and reading. PxIcon only.

STORY: In Wardrobe the player sees his hunter wearing the real rig,
taps a mount, previews a part on the figure, and commits with Wear —
the look changes on the stand, not in a list. In the Manual the player
lands on a cover, reads the contents like a book's, and opens a section
as a page: stamped opener, calm entries, a door to the next section.

FIRST VIEWPORT: Wardrobe — the stand plate fills the first viewport:
figure at ~94% height on a steel plinth, name/level gauge top-left,
worn-count gauge top-right, mount rail beginning below. Manual — the
masthead plate, search plate, amber Orientation entry, and the first
contents rows; the book's cover IS the first viewport.

FORM: brief-pinned compositions (fitting stand / bound book) inside the
owner-pinned Arena Plates world. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with
the finish review, the verdict, DESIGN.md, and every shipping raster
carrying its provenance

## Constraints

Hard floors: no emojis, 11px type floor, tap targets ≥44dp, zero
colored side bars, PxIcon only, scroll-don't-shrink, real-item
invariant (the stand renders the real rig via resolveOwnLook +
HunterPortrait over fixture payloads shaped like CosmeticsStateView).
Wardrobe covers: showcase, head-variant pick (+ override note),
owned parts by slot with Wear/Remove, locked state, craftable catalog
with real recipe cost lines, guest lock at the action. Manual covers:
guided tour (7 steps, jump CTAs, Back/Restart/Next), search with
filtering, all 8 sections with verbatim shipped copy (container study
only — stale tour text is the papercut batch's job, not this pass).
