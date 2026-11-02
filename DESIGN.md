# DESIGN.md — CyberCache Design System

**Status: ratified.** This document locks the design language the owner approved in the
redesign v2 pass (2026-11-01). It governs every future UI change in this repo. The
conformance rule lives in `AGENTS.md`: UI work conforms to this document, deviations
need the owner's sign-off first, and every UI slice brief names this document.

Sources: redesign v1 + v2 recommendation sets and summaries
(`redesign-00-global-language-v2.pdf` is the language's canonical presentation) and the
feature-coverage audit, whose surfacing spec §8 is summarized in §9 below. Where this
document and a mock disagree, this document wins — three known mock defects are listed
in §11 so they are corrected, not copied, at implementation time.

The product direction behind this system lives in `PRODUCT.md`.

---

## 1. The language — One Strip, One Stage, One Rail, One Sheet

Every screen in the game is assembled from the same four parts. This grammar replaces
the pre-redesign accretion of per-screen chrome; no screen invents a fifth part.

- **The Strip** — one single-row resource bar: credits · scrap · keys/fragments ·
  cores · loot, with the XP bar fused as a hairline on its bottom edge and the level
  chip at its right. The wallet prints exactly once anywhere in the app. One resident
  besides the wallet is allowed: the settings gear icon at the Strip's right edge
  (a shortcut; Settings' canonical home is Hunter → Account — see §3).
- **The Stage** — the pixel diorama art, unobstructed: one area/target plate (only
  when a target exists), one count plate, and ONE status ribbon along the bottom
  edge. Per-mode art (vista / arena / bench / site). The loot feed never prints on
  the art; nothing overlays the stage except its plates and ribbon.
- **The Rail** — one compact chip rail for modes and sections (Home modes, Gear
  stops, Market stops, Hunter stops), current state lit. The rail is a screen's
  table of contents: every stop is a destination, not a scroll position.
- **The Sheet** — the inspect poster's format (sprite stage, rarity name, fact
  chips, stat bars, action row) generalized to every detail view: boss intel,
  market listings, course detail, job cards. If a thing needs detail, it gets a
  sheet in this format — not a bespoke panel.

### Standing laws

- **Amber = the primary action only.** Amber/CTA color marks the one primary action
  in a view. It is never decoration, never a second button's color.
- **Rarity colors are data, never buttons.** A rarity color appears only when the
  thing it labels is that rarity (see §5).
- **Green = positive deltas only.**
- **Every header prints once.** Duplicated section headers are a defect (the
  pre-redesign Board printed HUNTER TOTALS twice; that class of bug is what this
  rule exists to prevent).
- **Empty states are one line.** No empty-state illustrations, paragraphs, or
  placeholder cards: one line of text, in place.
- **Concise data.** Show what the player needs to decide, nothing else. Rules prose
  sits behind a disclosure after first read. No raw identifiers in player text
  (no scene ids, camelCase trigger tags, or hex seller ids — sellers print as
  hunter names).
- **Claims never hide.** Claimable things live as chips directly under the Strip
  or as badged doors (see §9).

---

## 2. Navigation — four tabs

The structure is decided (owner, 2026-11-01): **Home · Gear · Market · Hunter.**
The six-tab structure (Board / Action / Gear / Market / Rank / Hunter) is retired:
Board + Action merge into Home; Rank folds into Hunter as the Standings door.

| Tab | Rail / composition | Holds |
|---|---|---|
| **Home** | Stage, then rail: `Area · Roam · Boss · Endless · Extract · Craft` | The hunt and everything the Board used to hold. The lit mode's workspace sits under the stage; the deck (below the fold, fixed order — §4) carries launchers, weekly claimables, the Now feed, and Hunter Totals. |
| **Gear** | Rail: `Loadout · Grid · Items · Workshop · Garage` | The doll, the inventory, consumables, the bench, vehicles. |
| **Market** | Rail: `Buy · Sell · Vendor · Repair · Shield Tech · Rep Desk · Slots` | Player market, NPC storefront, the two service boards as separate stops, manufacturer standing at its own desk, and the slot machine's canonical home. |
| **Hunter** | Rail: `Profile · Collections · Cache Rank · Research · Skill Trees · Standings · Account` | The hunter's record: profile + Trophy Shelf, collections and cores, ranks, courses, trees, the weekly races behind the Standings door, and account/settings/manual. |

Rules:

- **Repair and Shield Tech are separate rail stops** — same component family, two
  accents. Do not merge them into a single "Services" stop with an internal switch
  (v1 proposed this; the surfacing spec reversed it).
- **Salvage is not a Home rail stop.** Salvage is a transaction on an item: it lives
  on the inspect sheet and in Gear. Home's rail is exactly the six modes above.
- **Market opens on Buy.** Sell, My Listings ("Mine" segment) and History
  ("History" segment) live on the Sell stop.
- A tab's rail stops are destinations with stable order. Adding a stop requires
  the same justification as adding a Home deck block (§4): it displaces or
  out-ranks something, or it does not ship.

---

## 3. Per-tab content maps

The canonical home of every feature. Secondary doors are marked ◦ and never
replace the canonical one. (Tap depths are governed by §9.)

### Home

- **Stage + rail modes:** Roam (stage ribbon + workspace) · Area (one picker sheet,
  three openers: stage plate, rail Area, Change Area) · Boss (select sheet → prep
  poster sheet) · Endless (rail stop) · Extract (rail stop) · Craft (the action;
  its panel prints an "Open Workshop" door to the Gear bench — the action is
  **Craft** here, the bench is **Workshop** there; never label both "Crafting").
- **Under the stage, first viewport:** the lit mode's workspace (Session panel +
  Loot Feed while roaming; boss/endless/extract/craft workspaces in their modes),
  belt consumable quick slots (use-in-loop; the full stacks live at Gear → Items —
  do not consolidate them into Gear).
- **Resurrection** is an event-driven overlay on the Home stage (0 taps; it has no
  door and gets none). **Action skills** are contextual controls inside the active
  workspace.
- **Return Sheet:** the level chip reopens it (§10 covers its motion). The level
  pop-up holds level specifics only — the recap lives on the Return Sheet, nowhere
  else.
- **The deck** (below the fold, fixed order — §4): launcher cards (Dispatch ·
  Crack Cache · Slots ◦ · Loadout shortcut ◦ while a loadout is incomplete),
  Weekly claimables panel, Now feed, Hunter Totals.
- **Field Manual and Settings are NOT on Home.** Their canonical home is
  Hunter → Account; the Strip's gear icon is a Settings shortcut only.

### Gear

- **Loadout** — the 7 gear slots + vehicle slot; equip/unequip. (◦ Home keeps a
  Loadout shortcut card while a loadout is incomplete.)
- **Grid** — the item grid + salvage/recycle.
- **Inspect sheet** — tap any item card: stats, compare, equip, reforge/reroll
  action row, and the ◦ deep link to Market → Shield Tech.
- **Items** — consumables/materials stacks, quality % printed.
- **Workshop** — the bench: recipes + job queue.
- **Garage** — a rail stop in its own right (promoted from a Loadout section):
  vehicles, fuel cells + refuel, condition + self-repair with patch kits.

### Market

- **Buy** — player listings, filters in one sheet, price history/guidance; the
  seller prints as a hunter name.
- **Sell** — list an item; "Mine" segment = My Listings; "History" segment =
  Market History.
- **Vendor** — NPC storefront: staples at flat 100%, rotation + Item of the Day
  on a banner row. Buyback (0.4×) renders as a named dashed **row** on the Vendor
  stop's first viewport — the old buy/sell/rep 3-mode toggle is deleted.
- **Repair** — the repair board (post / accept / deliver; patch-kit jobs).
- **Shield Tech** — recalibration board lane + self-lane.
- **Rep Desk** — manufacturer standing as a place: makers, ladder, turn-ins,
  rank tributes, Rep Shelf + the standing-exclusive recipe, and the weekly
  **Parts Crate + Signature Orders** — this stop is their home and first claim
  surface (◦ claim chip on Home when ready, ◦ Weekly panel in Home's deck).
  The Vendor's hidden `rep` mode toggle is deleted and must not return.
- **Slots** — Data Slots, the slot machine's canonical home: reels, bet tiers,
  full payout table. (◦ exactly one secondary door: the labeled launcher card
  in Home's deck.)

### Hunter

- **Profile** — profile + Trophy Shelf + lifetime stats, top of the tab. The
  Trophy Shelf tile **opens Collections** (today it opens nothing — a defect the
  redesign fixes, not a behavior to preserve).
- **Collections** — the 81 proofs as a poster-grid shelf; legendary cores print
  in the stop header (cores are spent from Gear → inspect).
- **Cache Rank** — the tracks and token spend.
- **Research** — the course catalog and enrollment (the parallel education track).
- **Skill Trees** — the four trees + keystones; **Respec lives on this stop**
  (where the points are visible); **Mastery is a segment of this stop**.
- **Standings** — the leaderboards door (8 weekly races + rewards + drop-luck
  buff), carrying a **live badge**: claimable-count pill + ends-soon pill,
  printed on the door itself. A plain unbadged button is a defect — the badge
  is what replaces the ambient visibility the retired Rank tab carried.
- **Account** — guest→Google link, identity/username, sign-out; **Settings**
  row and **Field Manual** row live on this stop (their canonical home).

---

## 4. Home composition order

Home's layout is a rule, not a suggestion. It is sorted by how often a returning
player needs each block.

**Above the fold, always, in this order:**

1. **The Strip** (wallet + fused XP hairline + level chip + settings gear).
2. **Claim chips row** — every claimable: login streak, new contract offers,
   the weekly Parts Crate / Signature Orders when ready. (Absences under
   5 minutes still settle silently; the Return Sheet is §10.)
3. **The Stage** — area plate, count plate, status ribbon.
4. **The mode rail** — `Area · Roam · Boss · Endless · Extract · Craft`.
5. **The lit mode's workspace** — session/loot panels and the mode's primary
   actions (Start Roam, Choose Boss).
6. **Belt quick slots** — the consumable quick-slot row.

**Never above the Stage:** no panel, card, feed, header, banner, or navigation
other than the Strip and the claim chips may sit above the Stage, and the Stage
is **never below the fold in any state** (standby, roaming, boss, death). The
Stage is the emotional core of the game; bookkeeping never colonizes it.

**Below the fold — the deck, in fixed order:**

1. **Launcher deck** — Dispatch and Crack Cache first (they are Board orphans:
   when the Board tab died they lost their only door, so they inherit named,
   stateful cards at the top), then the Slots launcher card and the Loadout
   shortcut card.
2. **Weekly claimables** — the Parts Crate + Signature Orders panel. Renders
   only in its claimable/offered states.
3. **Now** — the single merged feed (World Pulse + player activity). Named
   "Now"; one panel, no duplicates. (Merging World Pulse into Now keeps the
   panel's name and place — a merge that deletes both is a cut, and cuts need
   the owner's sign-off.)
4. **Hunter Totals** — last: reference data, not errands. One header, with its
   Sources disclosure.

**Scarcity rule:** nothing joins Home — above or below the fold — without
displacing a block or winning the argument that it is checked more often than
what it displaces. That scarcity is what keeps Home from becoming the Board
again.

---

## 5. Tokens

### Palette (bronze-and-amber identity — the shipped game's palette)

| Token | Value | Role |
|---|---|---|
| `--ground` | `#171008` | App ground |
| `--well` | `#120c06` | Deepest wells, stage backing |
| `--panel` | `#241a10` | Panel surface |
| `--panel2` | `#2e2113` | Raised panel / chip surface |
| `--line` | `#453218` | Hairlines, panel borders |
| `--ink` | `#f5ecda` | Primary text |
| `--mut` | `#c2b096` | Secondary text |
| `--dim` | `#9a8a6e` | Tertiary text, unit tags |
| `--amber` | `#ffa01f` | Amber — primary action marker, level/accents |
| `--cta` | `#ff8a00` | Primary action fill |
| `--red` | `#ff5566` | Danger, ends-soon, death |
| `--green` | `#5fd95f` | Positive deltas only |
| `--cyan` | `#3fd6e8` | Keys/teal accents, info |

### Rarity colors (data, never decoration)

| Rarity | Token | Value |
|---|---|---|
| Common | ink (neutral) | `#f5ecda` family |
| Uncommon | `--uncom` | `#57d93d` |
| Rare | `--rare` | `#57b6ff` |
| Epic | `--epic` | `#f07df2` |
| Legendary | `--leg` | `#ffd21f` |

A rarity color is used only when the item/fact it labels is that rarity —
including icon tints (§7). Rarity is never a button color (the pre-redesign
green Buy Now wall is the canonical violation).

### Resource tints (the Strip)

The wallet tints are the shipped resource colors: credits gold, scrap orange,
keys teal, cores amber, loot green. The Strip must read identically in value
to the live build everywhere it appears.

### Type scale (at the 412px reference width)

| Step | Size | Use |
|---|---|---|
| Poster | 23px / 900 | Sheet poster names (item, boss) |
| Door | 15px / 900 | Door titles, primary CTA labels |
| Base | 13px | Body text, section headers (900, uppercase), row titles |
| Feed | 12px | Feed rows, Strip values |
| Label | 11px | Secondary labels, chips, stat labels, rail labels |

**THE FLOOR: 11px.** No text a player must read renders below 11px at the
reference width — labels, rail stops, chips, buttons, rows, all of it. This is
a hard minimum, not a target (see §6 for the only permitted remedy when
content does not fit). Count badges and pills are drawn elements governed by
§7, and any count that matters also prints at ≥ 11px at its destination.

---

## 6. The scroll-don't-shrink rule + alignment law

**Scroll-don't-shrink (owner's rule).** Any chip bar, filter bar, rail, or
tab bar that cannot fit its labels at the §5 type floor becomes a
**horizontally scrolling bar** with a visible scroll affordance (edge fade or
partial next chip). Shrinking type below the floor to force a fit is a
defect — full stop. Shortening a label is permitted only where the full name
prints on the destination the label leads to (and is the second choice, not
the first). The Market filter bar is the motivating case: on the live build
its buttons sit cramped and off-center at shrunken sizes; the compliant
fix is a scrolling bar at honest sizes.

**Alignment law.** Controls center on their axes — horizontally within their
bar, vertically against their label/icon companions. Baselines align across a
row; icon + label pairs share one optical center line. A control group that
renders off-center, baseline-shifted, or optically misaligned against its
siblings is a defect of the same severity as a wrong number, not a style
preference. Where a group cannot be centered because it scrolls (§6, first
rule), it starts flush at the bar's inline start with the scroll affordance
visible — left-anchored by design reads as intentional; near-centered by
accident reads as broken.

Together these two rules replace "make it fit somehow": **fit at full size,
scroll what overflows, center what doesn't.**

---

## 7. The pixel icon system

**The rule (owner's hard rule): NO EMOJIS AND NO UNICODE GLYPHS AS
ICONOGRAPHY anywhere in the UI.** Not
...[truncated 15100 chars]