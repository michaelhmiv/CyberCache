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
- **The Stage** — the pixel diorama art, unobstructed: one count plate, the
  combat HP plates at the actors' bases, and the action controls. Per-mode art
  (vista / arena / bench / site). The loot feed never prints on the art;
  nothing overlays the stage except its plates and the action controls.
  Attached to the stage's foot — below the art, never over it — is the **hero
  rundown**: TWO rows of four at the Door type step — DPS · Dmg/tick · Crit %
  · Crit × over HP · Shield · Mit · Shield Break — effective values as
  heroes, each stat tappable into its source breakdown sheet. Where the
  model carries a true base→effective pair (DPS, HP) the delta rides beside
  the hero AS A PERCENTAGE OF BASE — the same figure the breakdown sheet
  prints — green for gains, red for losses; stats with no base pair (crit,
  shield, mitigation, shield break) print plain, and no baseline is
  invented. A slim buff line rides under the heroes while any buff or
  activity modifier is active, and renders nothing otherwise.
  *Owner ruling 2026-11-03 (device review): the rundown stacks to two rows
  at the Door step so more real numbers ride the stage's foot; shield and
  mitigation leave the HP cell's microline — as their own cells, a second
  printing would be redundant state.*
  *Owner ruling 2026-11-02: one more resident — the action controls (Switch
  Action · Stop) float on the stage itself as chips in the plates' language,
  and no dedicated controls row exists under the rail. The Switch Action
  door rides the stage in every state (it is the Switch sheet's only door,
  and Salvage's path home); Stop joins it while an action runs.*
  *Owner ruling 2026-11-03 (Home consolidation): the status ribbon is
  RETIRED — there is no ribbon on the stage, and the mode word ("ROAMING")
  prints nowhere: the scene, the rail, and the workspace already say it.
  The ribbon's stats band is replaced by the hero rundown above. The action
  controls are ICON-ONLY: 44px square buttons carrying the §7 swap / stop
  pixel glyphs and no visible text (the words live in their aria-labels) —
  the text made them way larger than they needed to be. Position stays
  top-left; only the footprint shrank.*
  *Owner ruling 2026-11-02 (later, from the device): the area/target plate
  is REMOVED from the stage — no banner rides the art; area switching lives
  in the rail's AREA stop and the workspace panels' Change Area buttons,
  and a boss's name rides its HP plate. The action controls move to the
  top-left corner the plate vacated (the count plate keeps the top-right).
  Combat HP plates anchor at the actors' bases, never across a face: the
  enemy/boss HP plate sits under the enemy on the ground line, and the
  hunter's HP plate rides at his lower body on his own column, thick and
  backed, numbers whole.*
  *Owner ruling 2026-11-03 (from the device): the ROAMING enemy's plate
  lifts off the ground line into the stage — at the ground line it read
  as part of the stats row below the animation. It now rides as a
  translucent overlay on the enemy's column, its top edge lifted by the
  hunter plate's own offset (one shared lift, so the two plates read as
  a matched pair at one height on their respective sides), over the
  enemy's lower body — never its face. The BOSS plate does not move: its
  under-the-boss ground-line anchor stays exactly as ruled in 2026-11-02.*
  *Owner rework 2026-11-04 (from the device, superseding the stage-controls
  and area-door parts of the 2026-11-02 rulings above): the "arrows" on
  the stage — the Switch Action chip's swap glyph — are REMOVED, and Stop
  moves left into the vacated corner: the stage carries Stop alone, only
  while an action runs, and no controls at all at standby. The Switch
  sheet survives (it is Salvage's door from Home); its opener moves into
  the standby and roaming workspace panels. Area switching leaves the
  rail: there is no AREA stop — Roam is the area door (§2/§3). And the
  ONE-STAGE LAW: Home has exactly one animated stage — this Stage. Every
  activity's scene renders here while that activity is the active action
  (Extraction's scene included — it fell through to the camp vista while
  its workspace duplicated the scene below); workspaces and panels carry
  controls and information only, never a second animated scene. A still
  poster header is acceptable where a panel needs a visual. The Boss and
  Endless panels' combat-resolution playback is not a scene in this
  sense: it animates the Chef's returned result (ARCHITECTURE.md), it
  does not duplicate the Stage.*
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

### Do on Home, own in Gear (owner, 2026-11-04)

Everything the player DOES lives on Home; everything the player OWNS
lives in Gear. The crafting bench is the ruling case: the Workshop —
recipes, the job queue, the bench-time bank, and the repair/service
jobs — is Home's Craft workspace, because working the bench is an
action, and the bench runs only while Craft holds the action slot.
Gear keeps the owned side: loadout, inventory, belt & stacks, and the
Garage (which starts repairs; managing them is the bench's service
section on Home). A surface that makes the player travel to another
tab to operate what they started is a defect against this principle.

### Every "no" carries its remedy (owner-approved 2026-11-02)

When a surface refuses, locks, disables, or comes up empty, the same surface
names what resolves it and doors to it in one tap: a disabled control prints
its reason as visible text (never only in a hover title), a shortage names
the missing thing *and where it comes from*, and a counter never shows a
denominator the player hasn't been taught. One line is enough room for a
remedy and a door — this law extends the one-line empty-state rule above,
it does not repeal it.

### No redundant state; detail behind inspect (owner, 2026-11-03)

Two corollaries, ruled on the Workshop's recipe cards and binding
everywhere:

- **No redundant state banners.** A fact stated on its own line is never
  re-narrated in a summary banner below it. A material shortage prints
  once — on its material line, with its count and its source — and no
  "Missing X and Y" banner repeats it, and the disabled primary button
  does not narrate either: it keeps its action label (QUEUE JOB),
  disabled; the lines above it are the reason. Non-material blockers
  (bench, level, mastery, research, standing) still print their own
  lock lines, because those facts live nowhere else on the card.
- **Detail behind inspect.** A card's face is identity (icon, name,
  category, time) + numbers (have/need, totals) + actions. Per-item
  prose — the description/purpose paragraph, the quality-range line,
  effect detail — lives one tap away in the item's inspect sheet,
  opened by the info button beside its name, carrying the full text
  and the full gate/material detail. A single page-level explainer
  (e.g. the Workshop's quality band key) may stay in flow: it teaches
  once per page, it is not per-item prose.

### Quotes are hard ceilings (QB-1, 2026-11-03)

Quick-buy pattern: a shortfall goods line carries one small **+**; everything
else — pricing on Market · Vendor tabs, the quantity stepper, the buy — lives
in the pop-up sheet the + opens. The reusable rule: **a displayed quote is a
hard ceiling** — the purchase re-quotes atomically at tap time and charges
min(quote, current), never more; if the fresh total exceeds the quote, nothing
is charged and the sheet re-renders from the fresh quote saying so.

### Auto-salvage scope law (owner-approved 2026-11-04; migration 0080)

The Auto-Salvage Rules (Settings: on/off, max rarity, max roll quality,
yield Scrap-or-Materials) are profile-owned and enforced by the Chef at
settlement — never by the client, never from the runtime snapshot. The
scope is a law, not a default: the rule reaches **roaming claim drops
and offline-settlement drops only** — the items that settlement just
stored, checked before they land. It never touches **boss loot, cache
contents, market deliveries, or crafted items** (the settlement
function itself refuses any other source), it never sweeps the
existing bag retroactively, and its rarity ceiling stops at **Epic**
at every layer — legendaries are salvaged one at a time, deliberately,
or not at all. The payout is the manual salvage path's own
(cc_recycle_item, skill bonuses included), and every conversion is
visible: a feed line per item, a summary in the claim response and
the offline recap, and an Activity Log record marked as an
auto-salvage. Nothing about the rule may happen silently.

---

## 2. Navigation — four tabs

The structure is decided (owner, 2026-11-01): **Home · Gear · Market · Hunter.**
The six-tab structure (Board / Action / Gear / Market / Rank / Hunter) is retired:
Board + Action merge into Home; Rank folds into Hunter as the Standings door.

| Tab | Rail / composition | Holds |
|---|---|---|
| **Home** | Rail, then Stage: `Roam · Boss · Endless · Extract · Craft` | The hunt and everything the Board used to hold. The rail leads the screen (owner ruling 2026-11-04); the belt sits in the rail's vacated slot under the stage, and the lit mode's workspace under the belt; the deck (below the fold, fixed order — §4) carries launchers, weekly claimables, the Now feed, and Hunter Totals. There is no Area stop (owner rework 2026-11-04): Roam is the area door — entering roam auto-opens the area picker, and tapping Roam while roaming opens it alone. |
| **Gear** | No rail — one page | ONE merged Loadout page (owner layout "Exec C, the Split", 2026-11-03): the doll, vehicles (inside the page — §11 F1, owner ruling 2026-11-02), the Inventory grid and Belt & Stacks as the page's sections, and a Workshop status strip at its foot (◦ door to the bench on Home — crafting consolidated onto Home, owner ruling 2026-11-04; the Workshop stop is retired). |
| **Market** | Rail: `Buy · Sell · Vendor · Repair · Shield Tech · Rep Desk` | Player market, NPC storefront, the two service boards as separate stops, and manufacturer standing at its own desk. |
| **Hunter** | Rail: `Profile · Collections · Cache Rank · Research · Skill Trees · Standings · Account` | The hunter's record: profile + Trophy Shelf, collections and cores, ranks, courses, trees, the weekly races behind the Standings door, and account/settings/manual. |

Rules:

- **Repair and Shield Tech are separate rail stops** — same component family, two
  accents. Do not merge them into a single "Services" stop with an internal switch
  (v1 proposed this; the surfacing spec reversed it).
- **Salvage is not a Home rail stop.** Salvage is a transaction on an item: it lives
  on the inspect sheet and in Gear. Home's rail is exactly the five modes above.
  From Home it is reached through the Switch Action sheet, whose door rides
  the standby and roaming workspace panels (owner rework 2026-11-04 — the
  door's swap-arrow chip left the stage; Stop took the corner).
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

- **Stage + rail modes:** Roam (hero rundown + workspace; Roam is also the
  area door — one picker sheet, two openers: rail Roam, which auto-opens it
  on entry and opens it alone while roaming, and the workspace panels'
  Change Area buttons; the rail's separate Area stop was removed by owner
  ruling 2026-11-04) · Boss (select sheet → prep poster sheet) · Endless
  (rail stop) · Extract (rail stop; its scene rides the Stage while it is
  the active action — the workspace panel carries a still poster header
  and its controls only, per the one-stage law, §1) · Craft (rail stop;
  opens the **Workshop** workspace on Home — the whole bench: recipes, the job
  queue, the bench-time bank, and a Repairs & Service section for the
  service-lane jobs; owner consolidation ruling 2026-11-04. Opening the bench
  never switches the action by itself: the workspace's own "Work the Bench"
  control claims the slot, and while anything else holds the slot the bench
  prints its paused state with the reason and that remedy in place. The
  workspace adds no animated scene of its own — the main stage carries the
  activity scene (one-stage law). The action is **Craft**, the bench is the
  **Workshop**; never label both "Crafting").
- **The hero rundown** is attached to the stage's foot (§1): the hunter's
  eight hero stats in two rows of four, each opening its source breakdown.
  The full all-metrics breakdown lives behind **Hunter → Profile's
  "Totals & Sources" door** — the deck's Hunter Totals panel is retired
  (2026-11-03).
- **The Next Move card is REMOVED** (owner device review, 2026-11-03): it
  shipped in the consolidation and the owner rejected the surface on
  device. Nothing replaces it — every wait keeps its own door: a finished
  craft reads on the Workshop's benches, the away settlement behind the
  level chip's Return Sheet, contracts and weekly earnings in the claim
  chips' sheets, the free daily cache at the Chest, a finished course on
  Hunter → Research.
- **Under the stage, first viewport:** the belt consumable quick slots in the
  rail's vacated slot, directly under the rundown (owner ruling, 2026-11-04 —
  the belt sat under the workspace until the swap), then the lit mode's
  workspace (Session panel +
  Loot Feed while roaming; boss/endless/extract/craft workspaces in their modes).
  Belt slots are use-in-loop; the full stacks live at Gear →
  Belt & Stacks, the Loadout page's belt section — do not consolidate them
  into Gear. The belt row also carries the **vehicle chip** (owner
  correction, 2026-11-03): the equipped vehicle's fuel readout in the belt
  chips' grammar — quiet while fueled, carrying its remedy door (Garage /
  Vendor) when out of fuel or worn out. The vehicle gets no row of its own
  on Home; its full status line lives in the Garage. Research state is NOT
  on Home: the education track's chip and completion card left with the
  consolidation — enrollment state lives on Hunter → Research, and a
  finished course reads completed there.
- **Resurrection** is an event-driven overlay on the Home stage (0 taps; it has no
  door and gets none). **Action skills** are contextual controls inside the active
  workspace.
- **Return Sheet:** the level chip reopens it (§10 covers its motion). The level
  pop-up holds level specifics only — the recap lives on the Return Sheet, nowhere
  else.
- **Login streak:** the flame chip in the claim row opens the streak sheet. The
  check-in is the day's first state read — it records the day server-side and
  holds the reward UNPAID (migration 0079, the true claim — owner decision
  2026-11-04, overruling this section's earlier announcement model). While
  the reward waits, the chip is a real claimable — pulse + amber CLAIM badge
  — and the sheet shows the reward face-up behind its one primary action,
  the Claim button; claiming pays it and the landing celebration plays in
  the sheet (§10) as the wallet answers. An unclaimed reward expires at the
  00:00 UTC rollover (the streak day still counts); the claimed state
  renders quiet — "Claimed …", no pulse, no badge (§9).
- **The deck** (below the fold, fixed order — §4): launcher cards (Dispatch ·
  Crack Cache), Now feed. (The Slots launcher, the Loadout shortcut, the
  Weekly panel, and Hunter Totals all left the deck in the 2026-11-03
  consolidation — rehoused per §4's notes, not deleted. The Slots
  launcher's destination is gone entirely: Data Slots was removed,
  migration 0074.)
- **Field Manual and Settings are NOT on Home.** Their canonical home is
  Hunter → Account; the Strip's gear icon is a Settings shortcut only.

### Gear

- **Loadout (the merged page)** — ONE scroll (owner layout "Exec C, the
  Split", 2026-11-03): the doll zone — a compact figure stage sized to the
  hunter, frame-filling its column: the figure's frame (not the armed
  extent) sets the size, so the hunter stands at most of the stage's
  height and a long gun crops at the stage's right edge like a portrait,
  receiver and grip in view (the doll fit, 2026-11-04; wide stages keep
  the armed width law) (◦ Wardrobe door on the stage, canonical home
  Hunter → Profile; the DPS/HP hero plate at the stage's foot), the
  three gun slots as full
  rows down the right column (Primary as a poster row), the four
  accessories as a 2×2 band beneath — then the Garage section, § Inventory,
  § Belt & Stacks, and the Workshop status strip at the foot (◦, printing
  the bench at a glance — jobs running / queued / ready, Craft active or
  paused; the bench's canonical home is Home's Craft workspace since the
  2026-11-04 consolidation). Slot
  blocks print the item's name in its rarity color — in full, wrapping
  when it needs the room (names never truncate on the gun rows) — and a
  PERK line —
  headline stat + the item's next real perks; rarity and element never
  print as words (rarity rides the name's color, element the icon tint
  and the item's own render — owner ruling 2026-11-03). The Slot Picker
  is the one equip surface; the 7 gear slots + vehicle slot equip/
  unequip there and in the Garage. (Home's old Loadout shortcut card is
  retired — 2026-11-03: the stage's count plate carries the n/7 signal,
  and this page is the loadout's only Home-adjacent door.)
- **§ Inventory** (section of the Loadout page; the Grid stop retired into
  it, 2026-11-03) — the item grid + salvage/recycle, its header and
  toolbar sticky at the page's scroll top.
- **The Inventory LIST is a true list** (owner ruling 2026-11-04): ONE
  line per item on a 46px row — the thumb (weapons composed at the §8
  stage density, the detail-level-0 grid; other kinds at thumb
  density), the element as a corner badge on the thumb (element-color
  field, sheet glyph — never the element word), level, the name in
  its rarity color, the equipped slot chip and lock glyph, and ONE
  headline stat per kind (weapon DPS · shield HP · ordnance DMG ·
  class-mod Boost · relic top affix). Rarity rides color (the name
  and the row's spine), never the rarity word. Text is only what
  earns it; affixes, maker, type, source and secondary stats live
  behind inspect. The GRID keeps the full card face — stats, badges,
  and the instance's real affix lines.
- **Inspect sheet** — tap any item card: stats, compare, equip, reforge/reroll
  action row, and the ◦ deep link to Market → Shield Tech. The compare is
  **The Trade** tape (2026-11-04): candidate vs the equipped piece it would
  replace, gains/losses groups, changed lines only, the resulting value as
  hero with the signed delta beside it (§9), non-numeric consequences
  (legendary effects with descriptions, affixes and class-mod node boosts
  by name, action-skill qualification crossings) as first-class lines, an
  honest "No build change" state, and boss-context DPS when a boss is
  selected. The same sheet serves the Market inspect, so the trade is the
  buy decision too. Picker and market ROWS carry only the item-layer strip
  (dpsChain DPS, signed-text deltas, 11px floor) — build-layer summary math
  runs once per opened sheet, never per row (the freeze rule, pinned by
  test). Displayed build numbers everywhere price class-mod skill boosts
  (the one assembly, `assembleStatSummaryInput` — screens show what the
  Chef pays).
- **§ Belt & Stacks** (section of the Loadout page; the Items stop retired
  into it, 2026-11-03) — the belt slots + consumables/materials stacks,
  quality % printed.
- **Workshop** — RETIRED as a Gear stop (owner consolidation ruling,
  2026-11-04): the bench's canonical home is Home's Craft workspace (§3
  Home). The Loadout page's foot keeps the ◦ status strip.
- **Garage (vehicle section of the Loadout page)** — the page's vehicle
  slot expands in place into the full Garage: vehicles, fuel cells +
  refuel, condition + self-repair with patch kits. Not a rail stop (owner
  ruling 2026-11-02, §11 F1).

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
  surface (◦ claim chip on Home when ready — the deck's Weekly panel
  retired into it, 2026-11-03).
  The Vendor's hidden `rep` mode toggle is deleted and must not return.
### Hunter

- **Profile** — profile + Trophy Shelf + lifetime stats, top of the tab. The
  Trophy Shelf tile **opens Collections** (today it opens nothing — a defect the
  redesign fixes, not a behavior to preserve). The **Totals & Sources door**
  on this stop opens the full all-metrics source breakdown (the canonical
  home of the totals view since the deck's Hunter Totals panel retired,
  2026-11-03; Home's rundown heroes open the same sheet focused per-stat).
- **Collections** — the 81 proofs as a poster-grid shelf; legendary cores print
  in the stop header (cores are spent from Gear → inspect).
- **Cache Rank** — the tracks and token spend.
- **Research** — the course catalog and enrollment (the parallel education track).
- **Skill Trees** — the four trees + keystones; **Respec lives on this stop**
  (where the points are visible); **Mastery is a segment of this stop**.
- **Standings** — the leaderboards door (8 weekly races + rewards + drop-luck
  buff), carrying a **live badge**: an unseen-earnings pill + ends-soon pill,
  printed on the door itself. A plain unbadged button is a defect — the badge
  is what replaces the ambient visibility the retired Rank tab carried. Race
  rewards are NOT claimable — settlement pays them automatically — so the
  earnings pill is a past-tense notice ("race rewards earned", no claim
  pulse), and its destination is the **Your Weekly Earnings** panel at the
  top of Standings, which prints each settled week's races, finishes, and
  rewards and states the auto-pay plainly. Viewing the panel clears the
  notice; a newly settled week raises it again.
- **Account** — guest→Google link, identity/username, sign-out; **Settings**
  row and **Field Manual** row live on this stop (their canonical home).

---

## 4. Home composition order

Home's layout is a rule, not a suggestion. It is sorted by how often a returning
player needs each block.

**Above the fold, always, in this order:**

1. **The Strip** (wallet + fused XP hairline + level chip + settings gear).
2. **Claim chips row** — every claimable: new contract offers, the weekly
   Parts Crate / Signature Orders when ready, and the login streak — a true
   claimable since 0079: its chip pulses with a CLAIM badge while the day's
   recorded reward waits unpaid, and goes plain the moment it is claimed
   (§9). Announcement chips (sold, bench-ready) ride this row's mechanism
   without being claimables. (Absences under 5 minutes still settle
   silently; the Return Sheet is §10.)
3. **The mode rail** — `Roam · Boss · Endless · Extract · Craft`
   (owner ruling 2026-11-04: the rail leads the Stage; it sat at step 4,
   under the stage, until the swap; the same day's rework removed the
   Area stop — Roam is the area door, §3).
4. **The Stage** — count plate, combat HP plates, the icon-only Stop
   control (44px stop glyph square, top-left, only while an action runs —
   the swap-arrow Switch chip left the stage in the 2026-11-04 rework;
   its sheet's door rides the workspace panels). Attached to its foot: **the hero
   rundown** (two rows — DPS · Dmg/tick · Crit % · Crit × over HP · Shield ·
   Mit · Shield Break — each tappable into its source breakdown; the buff
   line under it while anything is active).
5. **Belt quick slots** — the consumable quick-slot row in the rail's
   vacated position, directly under the stage block, with the vehicle
   chip riding it (fuel readout / remedy door; §3).
6. **The lit mode's workspace** — session/loot panels and the mode's primary
   actions (Start Roam, Choose Boss).

**Never above the Stage:** no panel, card, feed, header, or banner other
than the Strip and the claim chips may sit above the Stage, and — since
the owner's device ruling of 2026-11-04 — the mode rail, the one
navigation resident the owner placed there himself. The Stage
is **never below the fold in any state** (standby, roaming, boss, death). The
Stage is the emotional core of the game; bookkeeping never colonizes it.

**Below the fold — the deck, in fixed order:**

1. **Launcher deck** — Dispatch and Crack Cache (they are Board orphans:
   when the Board tab died they lost their only door, so they inherit named,
   stateful cards at the top).
2. **Now** — the single merged feed (World Pulse + player activity). Named
   "Now"; one panel, no duplicates. (Merging World Pulse into Now keeps the
   panel's name and place — a merge that deletes both is a cut, and cuts need
   the owner's sign-off.)

*Retired from the deck in the 2026-11-03 consolidation: the Slots launcher
card (the rail stop it pointed at was deleted with Data Slots,
migration 0074), the Loadout shortcut card (the
count plate carries the signal; Gear → Loadout is canonical), the Weekly
claimables panel (weekly earnings announce via the claim chip and the Next
Move card; the claim list itself is unchanged), and Hunter Totals (the hero
rundown + Hunter → Profile's Totals & Sources door carry its jobs).*

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
| Rare | `--rare` | `#5AA7FF` |
| Epic | `--epic` | `#FF9DF5` |
| Legendary | `--leg` | `#FFEA3A` |

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
ICONOGRAPHY anywhere in the UI.** Not as decoration, not as shorthand,
not in badges, locks, or chevrons — every icon is a drawing from the one
sheet below. If a concept has no glyph on the sheet, the sheet grows a
drawing; the UI never borrows one from the keyboard. Chevron, lock, and
check are drawings too — the three glyphs UIs most often borrow from text
fonts.

**Why one sheet:** the rule only holds if drawing an icon is easier than
typing one. One sheet, one drawing hand, one tint table — a new icon is a
short drawing task, not a design meeting.

**Construction.** Every icon is hard rects on a 16×16 grid in the game's
duotone manner: the mass renders in the icon's tint (`currentColor`);
shade is black at 35%, highlight is white at 45%, paper is white at 22%,
and the knockout tone is near-black. A new icon that cannot be drawn in
that hand does not ship.

**The 52 icons** (canonical names — the registry key is the name):

*Wallet — the Strip*

| Icon | Primary use |
|---|---|
| `coin` | Credits |
| `scrap` | Scrap |
| `key` | Cache keys |
| `frag` | Cache key fragment |
| `core` | Legendary cores |
| `loot` | Loot / cache count |
| `cog` | Settings (the Strip's gear shortcut) |
| `chevD` | Open / expand |

*Home — modes, claims, launchers*

| Icon | Primary use |
|---|---|
| `home` | Home tab |
| `crosshair` | Roam |
| `skull` | Boss |
| `infinity` | Endless |
| `pick` | Extract |
| `hammer` | Craft |
| `pin` | Area |
| `flame` | Login streak |
| `orders` | Contracts |
| `crate` | Parts Crate |
| `signal` | Dispatch |
| `gift` | Free Box (daily cache) |

*Gear & Market*

| Icon | Primary use |
|---|---|
| `pack` | Gear tab |
| `armor` | Loadout |
| `grid` | Item Grid |
| `vial` | Items (consumables / stacks) |
| `anvil` | Workshop |
| `wheel` | Garage |
| `tag` | Market / Sell |
| `basket` | Buy |
| `vendor` | Vendor |
| `wrench` | Repair |
| `shield` | Shield Tech |
| `badge` | Rep Desk (manufacturer standing) |
| `bolt` | Ordnance |
| `lock` | Locked (sign-in locks on transacting actions) |
| `check` | Met / done |
| `chevR` | Go (row navigation) |

*Hunter & combat data*

| Icon | Primary use |
|---|---|
| `person` | Hunter / Profile |
| `trophy` | Standings |
| `shelf` | Collections |
| `chevs` | Cache Rank |
| `flask` | Research |
| `nodes` | Skill Trees |
| `book` | Field Manual |
| `heart` | HP |
| `gun` | Weapon |
| `cross` | Med |
| `snow` | Cryo (effect family) |
| `burst` | Burst (effect family) |
| `drop` | Ripsteal (effect family) |
| `blob` | Contagion (effect family) |
| `star` | Elite / event |
| `gem` | Gem Drop |

**The size ramp.** Four sizes only: **13px** inline, **17px** on rails
and tabs, **26px** on doors and rows, **40px** heroes. 64px and up is
stage art, not an icon size. Pixel art blurs at in-between sizes; the
ramp is the discipline that keeps it crisp — never render an icon
off-ramp.

**Tint is role, not decoration.** Wallet icons take the shipped resource
tints (§5). Amber is the interactive tint. A rarity color tints an icon
only when the thing it labels is that rarity (§5) — never as button
paint. Count badges and pills are drawn elements in this same discipline,
not text glyphs; any count that matters also prints at ≥ 11px at its
destination (§5).

**In code:** the sheet is the single registry at `src/lib/pixel/icons.ts`,
rendered by `<PxIcon>` and tinted via `currentColor`;
`src/test/noEmojiIcons.test.ts` fails CI if an emoji-range character
re-enters shipped screen or component sources. Icons drawn after the v2
sheet — for shipped glyphs it had no counterpart for — live in the same
registry, in the same hand, after its additions marker; the 52 above are
the canonical set the redesign approved.

---

## 8. Pixel density law — item art (owner-ruled 2026-11-03)

**The game has ONE established pixel density. Every renderer
matches it; none exceeds it.** Two directions are equally
rejected: plates so flat they read as rasterized SVG, and plates
so fine they miss the aesthetic of everything else. If a choice
trades register-match for richness, register wins.

- **texel = 4** — the manifest law for every sprite, and the grid
  every compositor authors on. Fixed texel grids per density:
  weapons 120×44 (stage) / 240×88 (card); gear plates 240×140
  (shield, relic) / 240×120 (class mod, ordnance) at card, with a
  quarter-grid thumb.
- **Author AT the grid.** No oversampling, no sub-texel features;
  the minimum feature is 1 texel.
- **Five-tone ramp per hue** — shade toward black, highlight
  toward white, warm near-black outline (the duotone manner of §7
  applied to item bodies).
- **Identity comes from silhouette + saturated colorway.** Detail
  is silhouette breaks, panel blocks, and single-texel rivets,
  vents, and stripes; wear happens at texel scale; glow is
  hard-edged texel shapes, never gradients.
- **Thumb is detail level 0** — a composed bold silhouette +
  core + colorway on its own small grid, never a raw downscale
  of the card render.

In code: weapons compose through `weaponCompositor.ts` /
`weaponCardCompositor.ts`; the other gear kinds compose through
the shared plate engine `gearCardCompositor.ts` (+ `PixelGear`),
whose detail kit enforces the thumb discipline structurally.

---

## 9. Surfacing — one canonical door per feature

The coverage audit's closing rule, and this system's: **every feature has
exactly one canonical door.** Secondary doors exist (marked ◦ in §3's
maps) and never replace the canonical one. Anything not reachable per
this spec in a build is, by definition, buried.

**Tap discipline.** Depths count from Home: a tab press, a door tap, a
rail stop, or a sheet open costs 1; scrolling is free; 0 means the
feature is already on Home. Every feature sits at ≤ 2 taps except one:
**vendor buyback, at 3** — the model's single justified exception.
Buyback is a low-frequency sell-side flow sharing the Vendor's stock
screen, and it stays deep on purpose: a fat-finger sale of a legendary
should never be two taps from anywhere.

**Claimables announce themselves.** Everything claimable, weekly, or
time-boxed — contract offers, the weekly Parts Crate and Signature
Orders, and the login streak — carries a visible surface
on Home itself at 0–1 taps: a claim chip under the Strip, and the Next
Move card under the stage (the deck's Weekly panel retired into it in
the 2026-11-03 consolidation).
Settled race rewards are not claimables (settlement pays them
automatically); they announce through the live badge on Hunter's
Standings door and resolve on the Standings earnings panel (§3).
The login streak joined the claimables in 0079 (owner decision
2026-11-04): its reward no longer banks at the check-in read — the
read records the day and holds the reward unpaid, so its pulse is a
true **claim signal** at last: CLAIM badge on the chip, the reward
face-up in the sheet, **Banked** tags only once the claim has paid
them, and the claimed state quiet with no pulse at all. An unclaimed
reward expires at the 00:00 UTC rollover; the streak day still counts.
Consolidation must never silently demote any of them; the chips and
badges exist to prevent exactly that, and their languages stay
distinct — a pulse and the word "claim" belong only to rewards the
player actually claims.

**The two placements.** Slots' canonical door is the Market → Slots rail
stop — its only door since the 2026-11-03 consolidation retired the
deck's launcher card (Market tab press + rail stop: 2 taps, inside the
discipline). Manufacturer standing's canonical door is the Market → Rep
Desk rail stop; the Vendor's hidden `rep` toggle is deleted and must
not return (§3).

The full checkable list — all 54 audit rows, each feature's door and
depth — is the feature-coverage audit's surfacing spec §8; §3 of this
document is its per-tab expression, and the v2 summary's coverage
checklist verifies every row against it.

---

## 10. Motion — the mandate under Sample B

Motion in this game has a constitution and a mandate, in that order.

### The Sample-B law (do not touch)

The loot moment and fight pacing are Sample B, approved from proof
renders and owned in code by `src/lib/pixel/movement.ts` — every
duration a pixel scene or fight card animates with comes from that
module, and its values outrank any redesign instruction, including the
mandate below:

- Boss phase interval: **1150ms** (~1.15s between phase beats).
- Hit reactions: **420ms**, inside the 350–500ms window.
- Ghost HP drain: **480ms** behind the real bar.
- The loot ladder, per drop: Common **900ms** · Uncommon **1000ms** ·
  Rare **1100ms** · Epic **1400ms** · Legendary **2600ms** — with the
  legendary treatment intact (beam grow-in 420ms, card spring-in 380ms,
  weapon rise 950ms, world dimmed to ~40%, shockwave 900ms).

Changing any of these is a tuning decision for the owner, not a design
cleanup. Motion is presentation only: scenes and cards read decided
state; they never produce gameplay outcomes.

### The animation mandate

Everywhere else, animate (owner's mandate): claim chips pulse and
settle, cards and sheets enter with weight, feeds tick, tabs and rail
stops transition, claimable badges draw the eye. Animation is how the
game feels alive between loot moments; a static claimable is a missed
hook. **Reduced motion is respected** by collapsing this UI motion —
never by retiming the loot moment or the fight beats.

### The streak claim moment

The daily reward's ceremony belongs to the CLAIM, not the check-in
(0079): the check-in itself is silent — the day records, the chip
takes its CLAIM badge, nothing moves. When the player taps Claim in
the streak sheet, the moment plays at the instant it describes —
deliberately a tier below the loot moment (no beam, no world dim):
the poster plate stamps the day, the reward rows stamp **Banked**
one at a time (~120ms apart) with the cache-key row flaring once,
and the wallet answers as the claim's profile sync lands (the
Strip's pulse-on-increase; the legacy credits count-up never fires
for a held reward). The whole beat runs about 1.2 seconds and
settles. It plays once per claim: acknowledging the sheet,
remounting, or re-reading the same day never replays it, and an
already-claimed day opens the quiet sheet with no motion at all.
**Reduced motion** collapses the moment to its settled frame —
rows simply present, balance already final.

### The Return Sheet

The Return Sheet (§3, §4) presents in the loot language: a totals row,
the absence's best drop as a poster card on the ladder's timings, one
Collect button. Absences under 5 minutes settle silently — no sheet at
all. The push-notification primer rides the sheet's footer once. The
level chip reopens the sheet on demand; the level pop-up itself holds
level specifics only.

### Verification — scenes are golden, screens are walked

The golden suite (`src/test/goldenImages.test.ts`) renders pixel
**scenes** — arenas, dioramas, rigs, loot moments — through the pure-TS
reference renderer. When a slice changes a scene's rendering, its golden
diffs in CI and the baseline is re-struck under review. The suite
renders **no React screens**: no golden can catch a misaligned filter
bar, a shrunken rail label, or a broken deck order. React screens are
therefore verified the standing way: **phone-width capture of the real
flow plus a real flow tap-through**, with alignment audited against §6.
A screen-level visual harness, if ever wanted, is its own slice with its
own brief — it does not ride along in other work.

---

## 11. Known mock defects — correct, don't copy

The v2 mocks are the language's presentation, not its law (this document
wins — see the header). Three defects in them are recorded here so
implementation corrects them instead of copying them:

- **F1 · Garage's framing — OVERRULED by the owner, 2026-11-02.** The
  original F1 decision promoted the Garage to a Gear **rail stop**. The
  owner overruled it after reviewing the built result (voice call,
  2026-11-02), ruling that we follow the approved mock after all: **the
  Garage folds into Loadout** — the Loadout's vehicle section expands
  in place and carries the full Garage content (the m07-loadout
  lineage), and **the rail stop is retired** (the Gear rail carries
  four stops: Loadout · Grid · Items · Workshop). A split of vehicle
  maintenance to another tab was considered and rejected — no split.
  (Follow-on, 2026-11-03: the owner's merged-page layout retired the
  Grid and Items stops into the Loadout page as sections — the rail
  now carries two stops, Loadout · Workshop; §2/§3 carry the current
  state.)
  The v1 garage *content* design — sprite drawn from the actual
  vehicle instance, fuel and condition gauges, patch-kit repair —
  stands unchanged as what the in-Loadout vehicle section contains.
  The pre-ruling F1 text is preserved in git history (pre-2026-11-02
  revisions of this file).
- **F2 · Buyback's form.** Buyback renders as a named dashed **row** on
  the Vendor stop's first viewport (§3) — not the Sell segment the audit
  counted it under, and never the deleted 3-mode toggle. The form differs
  from the audit's assumption; the depth does not: still 3 taps, still
  the justified exception (§9).
- **F3 · Sub-floor rail labels.** The v2 mocks set the seven-stop rails'
  labels at 9.5px — below the §5 floor — and shortened three labels on
  the Hunter rail only (Collections → Collect, Cache Rank → Ranks, Skill
  Trees → Trees). Both are mock cosmetics: builds render rails at honest
  sizes and let them scroll (§6), and the full names print on the stops
  themselves, as they do throughout the PDFs. Doors, order, and tap
  counts in the mocks are exactly the spec's; only the type size is
  wrong.