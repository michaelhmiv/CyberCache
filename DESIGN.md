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

- **The Strip** — one single-row resource bar: credits · scrap · keys ·
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
  Endless panels' combat-resolution playback does not live in the panels
  at all: both publish the Chef's returned result to this Stage (boss:
  the 2026-11-06 stage-home fix; endless: Motion Reboot M3), where the
  playback IS the Stage's state — the panels keep prep, controls, and
  result only. Playback animates the Chef's returned result
  (ARCHITECTURE.md); it never produces one.*
- **The Rail** — one compact chip rail for modes and sections (Home modes, Gear
  stops, Market stops), current state lit. The rail is a screen's
  table of contents: every stop is a destination, not a scroll position.
- **The Menu** — Hunter's table of contents (owner pick, 2026-11-05): a hero
  plate over live-status doors in the Arena Plates register (§3). Every door
  prints its stop's live status on the menu itself — the menu is the tab's
  summary, not a list of labels — and every stop is a destination behind its
  door, headed by the plate back row. This tab has no rail.
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
- **No paragraphs on screens (owner, 2026-11-05).** A screen carries NO
  explanatory sentences or paragraphs — mobile space is too precious. A
  section gets its label, its controls, and a small **?** icon beside the
  label; any explanation lives in the pop-up that icon opens (the HelpHint
  sheet, `src/components/common/HelpHint.tsx`). This generalizes the
  2026-11-03 card-face rule (Detail behind inspect, below) from cards to
  every screen and retires the in-flow page-explainer exception that rule
  carried. State words and labeled numbers are not paragraphs (NO FUEL,
  "250 tank") — a state prints as a word, a fact as a labeled number,
  never as a sentence.
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
  and the full gate/material detail. Page-level explainers follow the
  same rule since the no-paragraphs law (2026-11-05, Standing laws
  above): they sit behind the section's **?** hint, never in flow —
  the in-flow explainer exception this paragraph once carried is
  retired.

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

### Dismiss-on-confirm for bulk salvage (owner, 2026-11-05)

Bulk salvage confirms and dismisses in the same tap: the rarity
sheet closes immediately, the chosen items leave the grid at once,
and the settlement completes in the background — the player is
never held on a busy sheet while a big inventory settles. Awards
(scrap, cores, materials, and the ONE summary card) come only
from the server's response, never from a client projection. A
failed settlement restores the items and reports through the
salvage feed: nothing silently vanishes.

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
| **Hunter** | Menu (Arena Plates): `Skill Trees · Research · Cache Rank · Standings · Collections · Wardrobe · Account · Profile & Record` | The hunter's record behind live-status doors: trees first, with the build itself printed on the door (per-tree ladders, unspent gauge), courses, ranks, the weekly races behind the badged Standings door, collections and cores, the wardrobe at the tail, account/settings/manual, and the profile record (identity + Trophy Shelf + lifetime stats) as the wide closing door. |

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
  on Home; its full status lives in the Garage (and, at a glance, on
  the Loadout panel's vehicle button, 2026-11-05). Research state is NOT
  on Home: the education track's chip and completion card left with the
  consolidation — enrollment state lives on Hunter → Research, and a
  finished course reads completed there.
- **Resurrection** is an event-driven overlay on the Home stage (0 taps; it has no
  door and gets none). **Action skills** are contextual controls inside the active
  workspace.
- **Return Sheet:** the level chip reopens it (§10 covers its motion). The level
  pop-up holds level specifics only — the recap lives on the Return Sheet, nowhere
  else.
- **Login streak:** the calendar chip in the claim row opens the streak sheet. The
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
  accessories as a 2×2 band beneath, and the belt under the zone —
  its label (Consumable Belt), the slot chips, and a **?** hint, and
  nothing else (no-paragraphs law, 2026-11-05: where empty slots
  load, auto-activation, and the server-side/no-Save facts live in
  the hint's pop-up) — then the Garage section, § Inventory,
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
- **The Inventory LIST is a true list** (owner ruling 2026-11-04;
  row anatomy revised 2026-11-05): ONE line per item on a 46px row —
  the LEVEL leads as its own column (LV caption over the number),
  then the thumb (weapons composed at the §8 stage density, the
  detail-level-0 grid; other kinds at thumb density) carrying
  NOTHING on it, the element as a badge beside the thumb in open
  space (element-color field, sheet glyph — never the element word;
  the corner-badge era ended when the badge covered the gun, and the
  level's brief stay as a chip on the art ended the same day — the
  art stays bare for the future sprite pass), the name in its rarity
  color WRAPPING TO TWO LINES rather than truncating (the end of a
  name carries what the item is), the equipped slot chip and lock
  glyph, and ONE headline stat per kind (weapon DPS · shield HP ·
  ordnance DMG · class-mod Boost · relic top affix). Rarity rides
  color (the name and the row's spine), never the rarity word. Text
  is only what earns it; affixes, maker, type, source and secondary
  stats live behind inspect. The GRID keeps the full card face —
  stats, badges, and the instance's real affix lines.
- **The row's compare button** (owner ruling 2026-11-05): the ⇄
  button keeps its small visual size but its hit area reaches
  ~45px — a tap anywhere near it is compare intent. Tapping it
  COMPLETES a pair: first tap arms the item (amber button + a
  "Comparing X — tap another item" bar, so the state is said out
  loud), a tap on a second item's button opens the comparison, a
  second tap on the armed item disarms. (The shipped bug this
  replaced: the button only ever re-armed the first pick, so
  button→button looped forever and nothing showed the state.)
- **Inventory sort** (owner ruling 2026-11-05) — ONE dropdown in the
  § Inventory toolbar, structured as the player thinks: the **General**
  group first (Best Overall is the default; rarity, item level,
  newest, name, activity value, affix count, salvage value — keys
  that mean something for every item), then one labeled group per
  kind (**Weapon Stats · Shield Stats · Ordnance Stats · Class Mod
  Stats · Relic Stats**), each built ONLY from stats that kind really
  carries — weapon DPS is the dpsChain number itself, never a proxy
  score wearing its label. **Scoping:** picking a kind-group key
  scopes the list to that kind (it drives the kind filter — sorting
  by Shield HP means "show me shields, best first"); the scope is
  always said out loud (scope bar naming the kind and the sort, the
  kind rail, the count) with a one-tap **All gear** return, and
  General keys never scope — one clears a sort-driven scope back to
  All but never touches a kind filter the player set themselves.
  Stats read highest-first by default (names A–Z); a direction
  toggle flips the active sort. The chosen key + direction persist
  across sessions; the scope derives from the key's group. Sorting
  is ordering only — rows, cards, and art never change shape under
  a sort.
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
  slot is a **button in the Loadout panel's header**, in the top-right
  gap above the primary weapon row (owner ruling 2026-11-05): the
  equipped vehicle's name, its effective yield factor, the labeled
  tank, and its condition — state words when the bonus is dead (NO
  FUEL / WORN OUT), never sentences; on foot it reads "On foot". The
  button expands the full Garage in place under the panel: vehicles,
  fuel cells + refuel, condition + self-repair with patch kits. The
  full-width status strip that used to head this section (status
  sentence + out-of-fuel/worn paragraphs + its own Open Garage
  button) is **deleted** under the no-paragraphs law. Not a rail
  stop (owner ruling 2026-11-02, §11 F1).

### Market

- **Buy** — player listings, filters in one sheet, price history/guidance; the
  seller prints as a hunter name.
- **The Buy/Mine lists are true lists** (owner ruling 2026-11-04, the
  Inventory list's sibling): ONE line per listing on a 46px row — the
  same anatomy as the Gear list (rarity spine, thumb with the element
  corner badge, rarity-colored name — but NO level column: price +
  the lane action own a listing row's right side, and at phone width
  the column starved the name and the counterparty facts; the level
  lives in inspect and the lane's level filter/sort) with the market
  substitutions. The headline slot carries the listing PRICE (the
  number rows are compared by); the item's own stat headline leads a
  fact line under the name, which also carries what a listing has
  and an owned item does not: the seller (a hunter name, labelled)
  and the listing's AGE — listings never expire, so age is the only
  time fact a row can print. The recent-sales median + trend print
  as text UNDER the price (the price's own anchor; no sparkline
  drawing at row size). Mine rows print "Listed {age}" + the
  net-proceeds line instead. Stat pills, badge lines
  and the compare block live behind inspect (the poster, The Trade,
  Market Intelligence). The Sell desk's candidate cards keep their
  form (price input, guidance, fee line) under the same compact
  identity line.
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

The tab opens on the **menu** in the **Arena Plates** register (owner pick
A, 2026-11-05): clipped-corner plates with machined frames, corner bolts,
bone-white scrim type, foot strips, and numbers as gauges — the boss-arena
plate language promoted to a menu. A **hero plate** carries the identity
(level well, name, handle, XP line) over a real arena painting, plus the
announcements row — unspent skill points (amber fill), banked race rewards,
the active research course — each announcement a door, printed only while
it exists. Below it, the doors in menu order; every door prints its stop's
live status, so progression substance reads at a glance and cosmetics sit
demoted at the tail. Every stop is one door tap in, and the **plate back
row** ("Hunter Menu" + the stop's name) heads each stop — every header
prints exactly once. Zero colored side bars anywhere in this register:
color lives in numerals, chips, foot strips, and light. There is no rail
on this tab.

- **Skill Trees** — the lead door, full width: a segment ladder per tree
  (spent pips + count) and the unspent-points gauge print on the door
  itself. Behind it, the four trees + keystones in the same plate register
  (points as gauge wells; a tree's color rides its label and foot strip,
  never a side bar); **Respec lives on this stop** (where the points are
  visible); **Mastery is a segment of this stop**.
- **Research** — the course catalog and enrollment (the parallel education
  track). The door heroes the active course's progress % and names the
  course; idle, it prints the catalog line.
- **Cache Rank** — the tracks and token spend.
- **Standings** — the leaderboards door (8 weekly races + rewards + drop-luck
  buff), carrying a **live badge**: the unseen-earnings count, printed on
  the menu door itself (the full pill set — unseen earnings, ends-soon,
  active buff — rides the Profile & Record stop's secondary Standings door
  ◦). A plain unbadged button is a defect — the badge is what replaces the
  ambient visibility the retired Rank tab carried. Race rewards are NOT
  claimable — settlement pays them automatically — so the earnings pill is
  a past-tense notice ("race rewards earned", no claim pulse), and its
  destination is the **Your Weekly Earnings** panel at the top of
  Standings, which prints each settled week's races, finishes, and rewards
  and states the auto-pay plainly. Viewing the panel clears the notice; a
  newly settled week raises it again.
- **Collections** — the 81 proofs as a poster-grid shelf; legendary cores
  print in the stop header (cores are spent from Gear → inspect). The door
  heroes the legendary-core count while the player holds any.
- **Wardrobe** — its own stop behind its own door, at the menu's tail: the
  skin-part showcase + wear/remove surface (pure cosmetic, zero stats).
  The door prints worn/owned counts once the player owns parts. The Gear
  page's figure-stage door ◦ lands here too.
- **Account** — guest→Google link, identity/username, sign-out; **Settings**
  row and **Field Manual** row live on this stop (their canonical home).
  The door prints the account status (verified / guest / pending).
- **Profile & Record** — the wide closing door: profile + Trophy Shelf +
  lifetime stats. The Trophy Shelf tile **opens Collections** (today it
  opens nothing — a defect the redesign fixes, not a behavior to preserve).
  The **Totals & Sources door** on this stop opens the full all-metrics
  source breakdown (the canonical home of the totals view since the deck's
  Hunter Totals panel retired, 2026-11-03; Home's rundown heroes open the
  same sheet focused per-stat). The stop also carries the secondary
  Standings door ◦ (full pill set) and the Activity Log door ◦.

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
| `frag` | Cache key shard (loot-moment visual only — fragments are no longer a currency, 0082) |
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
| `flame` | Fire element · hot-area marker · loadout presets |
| `calendar` | Login streak |
| `orders` | Contracts |
| `crate` | Parts Crate |
| `signal` | Dispatch |
| `gift` | Cache box (the daily free box was abolished, 0082 — every opening is key- or ad-paid) |

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
| `help` | Help hints (the ? beside a section label; its pop-up carries the explanation) |

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
  weapons 240×88 (card; the stage renders the same grid in held
  mode, §8.1) / 120×44 (detail-level-0 small grid for list rows);
  gear plates 240×140 (shield, relic) / 240×120 (class mod,
  ordnance) at card, with a quarter-grid thumb.
- **Author AT the grid.** No oversampling, no sub-texel features;
  the minimum feature is 1 texel.
- **Five-tone ramp per hue** — hue-shifted steps anchored to the
  base hex: darker steps rotate toward blue-violet, lighter steps
  toward warm yellow (the pxl manner, §8.1); the base tone itself
  is always the game's exact hex. Warm near-black outline (the
  duotone manner of §7 applied to item bodies).
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

### 8.1 The pxl craft standard (owner-approved sweep, 2026-11-06)

Composited item art follows the pxl craft discipline (hue-shifted
ramps, selective outline, cluster discipline), adopted under the
owner's five rulings: training slices before authored bases;
densities stay per-surface (§8); the payload ceiling is held —
craft grows in code, never in baked bytes; and **palette law:
the game's hexes are the identity — pxl supplies the shift
method only, every ramp's base tone stays byte-exact.**

**S1 (2026-11-06) — ramp root + weapon selout + dead lift
deleted.** The shared tone derivation (`hueLerp`, beside
`hexLerp` in `weaponCardCompositor.ts`) keeps the straight
lerp's lightness path and rotates hue while it travels —
shadows toward 250°, highlights toward 55°, max ~24° scaled by
the step's fraction of the lightness range; achromatic bases
stay on the straight lerp. It feeds the weapon card palette,
the gear five-tone ramp, consumable and material art. The loot
FX kit (PixelFx) deliberately keeps the legacy straight ramp:
it is flat-by-law (§7 register) and its tones do not move. Both
weapon outlines are selective now — a silhouette cell takes the
shade two ramp steps darker than the form cell it borders
(pxl selout), ink remaining against dark faces. The mint/
godroll top-edge lift is DELETED on both weapon paths: measured
dead — the outline pass caps every column first, so the lift
converted zero cells (card path md5-verified identical with it
disabled, 2026-11-06). Wear and godroll sparkles are live and
stay. Remaining sweep slices (lint gate, gear-engine pass,
small-item unification, authored-base pilot) land separately.

**S2 (2026-11-06) — the lint gate.** The standard above now has
teeth in CI: `src/test/pxlCraftLintGate.test.ts` runs the ported
pxl lint (orphan / jaggy / pillow / colors / near-duplicate —
upstream semantics, `src/test/pixelLint.ts`) plus the homegrown
banding rule over a seeded corpus of 366 real generated items
spanning every composited system at every shipped density
(weapons stage + card; shields, ordnance, class mods, relics at
plate + thumb; all consumables and materials at object + thumb).
Banding — the one rule upstream pxl lacks — is defined in the
lint source and checks both faces of the defect: marching strips
whose tones step in lightness only, and the latent form, a ramp
whose used tones travel < 4° of hue (a straight lerp travels
exactly 0°). Calibrated honestly, not absolutely: banding
asserts ZERO and demonstrably bites — the identical corpus
rendered by pre-S1 code (master `a49d9e5`) produces 386 banding
findings and fails 7 of the gate's 8 system suites. Orphan and
jaggy assert per-system budgets pinned at the S1-trained
baseline's per-render maxima, because §8's own detail language
(single-texel rivets, vents, stripes; the relic SALVAGE scatter)
sanctions the single cells an absolute-zero rule would condemn —
the gate freezes the trained noise ceiling instead, and any new
stray cell beyond it fails. Pillow and near-duplicate assert
zero with a short named allowlist (the Shock Legendary conduit
cores are emissive by design; two identity-hex pairs sit within
the metric's distance and palette law forbids moving either
side). The weapon pixel path answers to the pxl rules but sits
out banding: its palette is the master mapping S1 pinned
byte-exact, and its forms retire with One Grammar (§10), which
moves the stage onto the card grammar this gate already covers.

**S3 (2026-11-07) — the gear-engine craft pass.** The four gear
grammars (shield, ordnance, class mod, relic) now answer to the
standard the weapons met in S1. The gear core owns: selective
outline (the §8.1 weapon rule ported — an outline cell takes the
shade two ramp steps darker than the form cell it borders,
neighbor preference below/above/right/left, ink only at the ramp
floor and off-ramp faces); the broken-edge toolkit modeled on
the relic SALVAGE pass (jittered tone-boundary bands, broken-tone
region shading, cluster wear, broken vents) as shared core code,
never per-grammar copies; protected zones — a grammar declares
its data surfaces and every wear operation refuses them; and the
manufactured-gear wear ladder (owner-ruled: half the relic
budget, card density only — Common 7 chips / 0.28 grime down to
Legendary 1 / 0.05). Absorb was rewritten inside its ring-of-
plates silhouette (owner-ruled latitude): seeded uneven sectors,
per-side shell stacks, a seated core in a dark socket. Ordnance
cores are seated, pods/fins diverge per side, grooves and body
bands jitter. Class-mod casings shade broken; the node deck is a
protected zone and its origin is declared data
(`NODE_DECK_ORIGINS`). Relics were audited only (S3-7): renders
changed solely through the core outline (measured silhouette
delta 0 across the 64-item corpus); no row reads pristine — the
nearest, Neural Key and Circuit Totem, are named in the slice PR
with the evidence. The rarity invariant was re-argued, not
relaxed: thumbs are byte-identical across rarities (the ladder
never runs at detail 0), card form deltas are bounded by the
finish's own footprint with measured maxima stated in the tests,
and the deck is pinned byte-identical across all five rarities.
The S2 gate re-trained on this slice: banding stayed at zero;
orphan budgets for the three manufactured systems rose to the
wear texture's measured maxima (shield 152, under the relic
SALVAGE scale of 185). Acceptance evidence (157-item corpus,
before/after sheets, form-diff report) lives in the prep folder
`pxl-craft-sweep/s3-evidence/`.

**Hero Pass H1 (2026-11-06) — head-system unification.** The
hero adopts the same discipline under the Hero Pass brief (all
12 grill items ruled as recommended, plus the flexibility law:
shapes are data — anchors, picks, and part definitions are
declared data keyed by id; a future custom shape plugs in by
adding data, never by editing engine code). Three rulings land
here. (1) **One lane for the maker helms (Q2):** the six crafted
manufacturer head parts are DELISTED — no new crafts, no new
listings — and the look lives in the Standing rank-3 head pick.
Grandfathering is absolute: owned copies keep rendering,
wearing, and equipping forever; listings already live trade as
normal; jobs in flight settle. Availability is a `delisted`
flag in the skins catalog, read through one helper by every
gate (Workshop shelf, both craft-enqueue seams, both
market-create seams, the Wardrobe craft queue) — no id lists in
engine or UI code. The SQL recipe catalog still carries the six
recipes (in-flight jobs resolve from it); retiring the rows at
that layer is a separate parent-run migration, rehearsed on
staging first. (2) **Tier labels tell the measured truth:** the
maker helms were catalogued 'shaped' but measure as palette
re-skins of the stock head (alpha IoU ≈ 1.00 vs the visor, the
AUDIT method) — they and their set are 'palette' now, and a
test pins the rule: any part labeled 'shaped' must measure
IoU < 0.90 against the stock part for its slot. (3) **The Hood
pick is re-authored (Q3)** as a shaped cowl under the pxl-craft
standard (scripts/author-hood-sprite.py — the art is declared
span/fold data over the stock head, baked to the same sprite
id and 86×88 canvas): 3,109 drape cells in 8 tones where the
old slab had 1,783 cells in 2, and the payload went DOWN
(hood sprite 9,220 → 7,485 bytes; no ceiling raise).

**One Grammar (2026-11-06) — ruling (5) superseded for
weapons.** The card-held proof put the S1-trained card grammar in
the hunter's hands on the Home stage: the stage world is already
mixed-fidelity (painted backdrop, detailed enemies, coarse
hunter), the card gun reads as the premium object rather than a
pasted sticker, and the grip lands correctly at the pixel path's
held length. The owner ruled the unification in ("This looks
sick. Proceed" — sweep brief Amendment 1). The stage — DOM
diorama and Pixi boss stage alike — now renders the equipped
weapon from the CARD grammar in a first-class HELD MODE
(`composeWeaponCard` with `held: true`): the presentation
furniture (sniper bipod, Legendary halo ring, pooled glow,
floating sparkles) is omitted as a compositor pass, never masked
out of a finished card image; on-body finishes stay. The card
(inspect) render is byte-identical with held mode off. Grip
seating is data: `WEAPON_CARD_GRIP_FRACTIONS` declares a measured
grip anchor per weapon type (grip-cluster centroids across all
six manufacturers), and the parts actor seats the held render
grip-to-grip on the skeleton joint from it. The 26 bespoke
legendary sprites keep their existing path untouched —
superseded 2026-11-08 by the V4 entry at the end of this
section: the painted sprites are retired and the legendaries
render from hand-authored sets through this same grammar. The
120×44 compositor no longer renders on any stage; it remains
the detail-level-0 density for compact list rows and feed
thumbs, where the card compose is too heavy to run per row
(the 2026-11-04 Gear freeze law) — other surfaces keep their
densities, per Amendment 1.

**S4 (2026-11-07) — small items unified, thumbs get form.**
Consumables and materials were one system written twice:
`consumableArt.ts` was a parallel copy of `materialArt.ts`, not
a sibling on shared code (~400 lines of duplicated machinery —
the five-tone ramp, the plate class, the shade alphabet, the
seeded helpers, toneNoise/finishPass, the thumb ground-row, the
run-length painter). All of it now lives once in
`smallItemCore.ts`; both systems keep only their art tables,
painters, and treatments (frame treatments + motif for
consumables, band finishes for materials). The divergences were
parameterized, not unified away (tone-noise density resolves
frame-keyed vs band-keyed before the shared loop), seed prefixes
are preserved verbatim (`cons:` / bare), and the unification is
proven render-identical: the full-set signature manifest (all
69 icons × both densities, rows + colors) matched master
byte-for-byte at the phase boundary. One real defect died in
the move: consumableArt's cache was signature-keyed — it
composed in full before every lookup and never hit; both
systems now share the core's input-keyed cache (compose-counter
pinned). On top of the unified core, a thumb-led FORM pass
(owner-authorized at the S4 grill: the audit's weak reads were
form failures, not ramp failures) — every grenade and scanner
now carries its object form's silhouette at 12×12 instead of
one variant-blind stamp per chassis; the patch family's cross
survives at thumb (white-hot on the tin, carried on both
bottles); the Helix ticket wears its calibration dial; Prism
keeps its fleck clusters; AdrenalineShot takes the wide-barrel
injector form; CompositePlating stacks as four thin offset
seamed slabs against RefinedAlloy's three thick aligned ones,
and Voidweave weaves in horizontal courses against
WovenCircuits' checker. Object renders are byte-identical to
before; the named confusion pairs are pinned pairwise-distinct
BY FORM at thumb density in the art suites. The Field Manual's
consumable plates re-pointed in the same slice from the retired
PX_ICONS glyphs to the consumable compositor — the Manual now
shows the formed objects the game itself draws.

**S5 (2026-11-07) — authored bases pilot: the sniper.** The
first authored-bases slice. For the SNIPER only, the card
compositor's procedural form passes are replaced by 17
authored pieces (1 layout piece + 16 slot-variant grids; the
Sight slot ships one coded scope — scope 6) drawn in pxl under
this standard and checked in as grid data
(`src/lib/pixel/sniperAuthoredData.ts`), generated from the
archived authoring sources by a deterministic converter
(`scripts/convert-sniper-authored-bases.mjs` — re-running it
reproduces the data byte-for-byte; the .px.js sources live
with the sweep evidence, the One Grammar pattern). Assembly
is untouched: `partVariant()` still selects each slot's
variant from the part's full modifier map, and palette
resolution, the maker detail pass, element current/finish,
wear, rarity finish, selout, decals, and condition all run
over the authored forms exactly as they ran over procedural
ones. The chamber and magazine part-anchors are data in the
same module; the barrel's current-bed row is derived from the
stamped piece. Five grill rulings land here. (1)
**Maker-neutral authorship:** one form language for all six
makers; maker identity rides palette plus the detail pass.
Ironwood reaches the wood ramp by a stamp-time remap (metal
D/d/P/p/L → v/v/w/w/u) — a test pins that no metal body cells
survive on an Ironwood card. Two procedural shape behaviors
are superseded for the sniper and recorded here: Prismatek's
crystal chamber form, and the Wasteland-bone theme's shape
overrides (its palette law still applies; its cracks draw
over the authored stock). (2) **The Kinetic window rule is
production law:** Kinetic has no element color in game data,
so the authored chamber window's element keys resolve onto
the body ramp's light steps at stamp time (base step → 'p',
the game's own Kinetic chamber fill; glint → 'L'; dark step →
'd') and the window reads as warm glass in the maker's tones.
The scope lens keeps its glass glints — the production lens
behavior, unchanged. (3) **Rarity geometry is overlay data,**
not baked grids: the three tier-gated shapes (magazine
stripe, Uncommon+; receiver line, Rare+; chamber line, Epic+)
stamp from cell lists in the rarity trim shade; Common
carries none of the three. (4) **Checked-in grid data plus a
deterministic converter,** never build-time compilation. (5)
**Element-ramp steps stay derived** (the S1 hueLerp
precedent), never hand-pinned. Held mode and grip seating are
unchanged — the authored grip cluster satisfies the declared
sniper grip fraction, and the held-mode census re-measured on
the authored form (godroll fixture: opaque 5,383 → 3,543
held; gold 850 → 10). Containment is pinned by test: 792
render signatures (every non-sniper card render, every
pixel-path render) byte-identical to the pre-S5 sweep, and
the payload delta is 0. Whether authored bases scale to the
remaining five weapon types (~89 further pieces) is the
owner's call on this slice's judgment package; S5 does not
pre-decide it.

**Hero ship (2026-11-07) — the character converts to pxl,
whole.** The Pxl Everything program's character phase lands:
all three part sets (Standard Issue, Bulwark, Dreadplate) and
the head lane replace their baked AI paintings with renders
authored in the pxl tool — palette ramps as swap keys, parts on
the shared anchors, shapes as data — under the owner's ruling
that the whole character converts as ONE build (no per-family
gates, no converted pieces judged on the old art). Same sprite
ids, same canvases, same PartDef anchors; the composed rig was
proven whole before shipping (the integration pass: 18/18 set
definitions — 3 sets, 5 cross-set mixes, 10 head swaps —
lint-clean through the repo compositor, all 8 PART_POSES
executing on pure and mixed rigs). Mix-and-match is the point:
parts were never set-locked, and the conversion keeps every
cross-set combination legal. **The Hood is excluded by owner
ruling** — the pxl-authored cowl read wrong to the owner, so
the hood slot keeps the H1 production cowl byte-for-byte (its
md5 is unchanged in this slice's diff); the other 38 sprites
ship. **Ink/emitter unification folds in:** one blue-black ink
`#070b14` for SI, Bulwark, and the head lane; the emitter hot
steps unified on the SI values (`V #3ce9f5`, `W #c8fcfb`, base
`v #0397b2` already shared); the glint key `G #fdf394` declared
in all three palettes. Dreadplate is exempt — its warm ink and
red family are its approved identity. Two craft notes, both
recorded in the sources: Bulwark's shades()-generated steel
floor is pinned darker (`#06060f` → `#02030a`) because it sits
inside the pxl lint's near-duplicate distance of the unified
ink — the lint's own push-apart remedy, ramp order unchanged,
alpha untouched (the Bulwark head still measures IoU 0.9641
against the shipped helm) — and one valve-wheel hub pixel on
the Bulwark back settles to the wheel tone for the same
contrast reason. **Payload:** character art 413,061 B →
34,483 B on this tree (−378,578 B; against the pre-H1 census
frame, 414,796 B → 27,846 B for all 39 conversions); the
ceiling stays 11,620,000 B by owner ruling — the dividend is
headroom, not a raise. **Rider: the 10 baked death-pose
sprites are deleted** (244,492 B) — nothing ever rendered them
(stage death is the rig's `death` pose; the bestiary census
proved the only reference was a test asserting existence, and
that assertion is retired with the reason recorded in the
test). Post-ship sprite payload: 10,971,493 B, ~649 KB of
headroom for the bestiary conversion (enemies, then the 13
bosses), which lands with its own accounting. The ranked
polish list (Bulwark helm dome first, now that the Hood item
is moot) runs as its own slice after this ship. The `.px.js`
authoring sources live with the program record in the
prep archive (`cybercache-prep/hero-pass/`, batches H2d/H2e/
H2f/H2g + integration) — the game ships the renders, exactly
as it shipped the previous generation's bakes.

**V5 (2026-11-07) — the SVG ban's enforcement surface.** The
total-SVG ban (sole exception: the Google "G" sign-in glyph)
now holds on the stage itself: the LiveTurfDiorama's dormant
inline-SVG fallback diorama — the vector scene that rendered
for areas with no pixel background, owner-ruled killed
2026-11-07 — is deleted, together with its only-serving
silhouette component and the consumer-less procedural-SVG
`AreaBackground`. The DOM pixel stage is the only ambient
stage; an area with no pixel background renders the stage
shell and its overlays only, and `pixelDiorama.test.tsx` pins
exactly that. The loot-rise material glyph keeps its small
inline SVG inside the pixel scene — that is the pixel
stage's own FX vocabulary, not a fallback scene.
**SVG closure (2026-11-07) — the vector exceptions are
closed; the fallback diorama is deleted.** The owner's ruling:
the three live SVG exceptions the full-asset census found
(SkillKeystoneArt, Sparkline, ConsumableRing) convert to
pixel; the dormant inline-SVG fallback diorama inside
LiveTurfDiorama is killed; no named SVG exceptions survive.
Conversions, same component APIs, sizes, and information —
form only: keystone nodes are authored 30×30 texel grids
(edge cells take the form's own border color — selout; the
tree sigil and lock mark stay PX_ICONS rect data, composited
on canvas where the SVG embedded them); the profile /
progression sparkline is a stepped texel line on canvas over
its unchanged geometry lib (the MARKET sparkline chart stays
retired per the owner's 2026-11-05 ruling — it was never
this component's surface); the consumable ring is a 28×28
texel raster (slice accents, ink seams, a dash-block pulse,
a 3×5 texel count digit); the BenchFx spark burst's
vector form is closed (authored here as a 20×20 texel
grid; in the merged tree the bench slice's canvas FX
vehicle, PR #447, carries the burst and supersedes the
grid — M1's specs and timing are untouched either way);
the loadout star
connectors are rasterized dashed texel lines on a canvas
reproducing the old viewBox meet geometry; the diorama's
loot-rise drop icons are authored 15×15 grids shaded per
drop through the shared hueLerp ramp root. The fallback
diorama was verified dormant before deletion — every
roaming area resolves a pixel background (CI-asserted in
pixelWave1.test) and both mounts pass registry areas — and
is DELETED with its fallback-only overlays; an unmapped
area id renders no scene at all — the stage shell and its
overlays only — per the V5 slice's kill semantics
(PR #446), which this merge keeps over this slice's
Dustwaste-default variant. Orphaned by
the kill and deleted with it: the enemy silhouettes, the
resource silhouettes, ELEMENT_PROJECTILE, PxIconGlyph.
The same census's dead code went too: AreaBackground (zero
consumers), the SharedDefs filter mount (zero references
to any of its filter ids remained), and common/WeaponCard
(zero production importers). What remains, stated exactly:
the only vector-drawn graphic in the app is the Google "G"
sign-in glyph on the auth screen — a brand mark, not game
art. `<PxIcon>` is not an exception: it renders 16×16
rect-grid data, the pixel icon system itself (§7). The
converted grids lint at zero findings in CI
(`svgPixelConversions.test.ts`) beside the S2 gate.

**S5 scale-up batch 2 (2026-11-07) — authored bases: the
launcher and the beam.** The pilot scales to the last two of
the five remaining weapon types in declaration order (Pistol,
SMG, and Shotgun are the sibling batch). For the LAUNCHER and
the BEAM, the card compositor's procedural form passes are
replaced by authored pieces drawn in pxl under this standard
and checked in as grid data
(`src/lib/pixel/launcherAuthoredData.ts`,
`src/lib/pixel/beamAuthoredData.ts`), generated from the
archived authoring sources by deterministic converters
(`scripts/convert-launcher-authored-bases.mjs`,
`scripts/convert-beam-authored-bases.mjs` — re-running each
reproduces its data byte-for-byte; the .px.js sources live
with the batch evidence). The launcher ships 17 piece slots;
the beam ships 19 pieces. Assembly is untouched, exactly as
in the pilot, and every living pass runs over the authored
forms as it ran over procedural ones. The type rulings, each
forced by the type's own shipped code. (1) **Collapses follow
production's effective forms:** the launcher's Magazine data
is [drum, box, drum] — production draws two effective forms
across the three rolls (variant 1 the box; variants 0 and 2
the feed drum) — and its Sight is a single piece, the carry
handle the procedural barrel pass draws over the body (its
sight pass draws nothing for this type). The beam collapses
nothing: its Sight is authored ×3 (iron posts / reflex box /
aperture tower), the one slot where it needs more grids than
the sniper did. (2) **The Kinetic window rule extends by the
type's own current path:** the launcher's chamber window
remaps exactly as the sniper's; for the beam the element
current IS the form (the current pass skips it — "the core
is the current"), so the remap covers the whole path — the
layout's spine-channel row, the chamber window, and the
power cell's charge gauge — and a Kinetic beam carries no
element texels at all, its channel reading as warm conduit
in the maker's tones. (3) **The beam's Prismatek crystal
chamber is superseded**, as the sniper's was: one authored
chamber family serves all makers. (4) **Brass is a form key
for these two types** — collar rings, channel ticks, the
drum hub, cell bolts; the procedural passes draw them in the
form — admitted by their converters on top of the pilot's
key set. The launcher's warhead tip is likewise form, drawn
in the glow key; its converter disambiguates the pxl tool's
G/g ascii collision (the two keys share the reference hex)
so the tip can never resolve to the rarity trim color.
(5) **Anchors and muzzle seats keep production's values:**
the launcher's muzzle keeps the warhead's reach (bodyFront +
barrelLen + 9), its current bed derives from the shipped
radius profile exactly as the procedural barrel pass
computes it, and the beam's muzzle keeps the emitter tip's
front edge (tipX + 3). Held mode and grip seating are
unchanged — both authored grip families satisfy their
declared grip fractions under the held-mode audit, all
makers. Containment is pinned by test: of 864 swept renders
(every type × maker × element × rarity at both densities),
exactly the 144 launcher and beam card renders move; every
other render is byte-identical to the pre-batch sweep, and
the payload delta is 0.
**Batch 1 (2026-11-07) — authored bases scale-up: pistol,
SMG, shotgun.** The owner ruled the scale-up ("everything
done", 2026-11-07), and the S5 pattern is replicated for the
first three of the five remaining types (declaration order;
the sniper is done, a sibling batch takes Launcher and
Beam): 19 authored pieces per type — a layout piece plus
three variants for each of Barrel, Grip, Core, Magazine,
Chamber, and Sight — checked in as grid data
(`src/lib/pixel/{pistol,smg,shotgun}AuthoredData.ts`) and
generated from the archived .px.js sources by the
generalized deterministic converter
(`scripts/convert-authored-bases.mjs`; re-running it
reproduces each module byte-for-byte). Three batch-1 facts
differ from the pilot. (1) **The Sight slot carries three
authored forms** — these types' procedural sight pass read
the rolled variant, where the sniper's collapsed to one
coded scope (its scope-6 ruling stays the sniper's own).
(2) **The shotgun's Magazine slot authors its pump and
magazine tube**: the pump stamps before the barrel (the
barrel overdraws the tube row near the root, as the
procedural pass order did), the type seats no Magazine
anchor (procedural parity), and its bead and barrel heat
holes stay drawn in code exactly where the procedural
barrel pass put them, in both modes. (3) **Form robustness
against the living passes is designed, not lucky**: the
pistol suppressor's end wears a dark scorch collar because
BlastForge's deterministic muzzle scorch (a K lattice over
the muzzle's last ten columns) shreds any bright field it
lands on, and the shotgun's under-receiver rail reads solid
D on its underside because element drips hang off that edge
and the outline pass shades their flanks from the row
above. The shotgun receiver's belly shade likewise steps
in broken clusters rather than a straight band: remapped
to the near-hue-flat wood ramp, six uniform full-width
belly rows trip the banding gate's tone march, and the
broken step splits the stack. The SMG suppressor can also stands one row
slimmer than the procedural can: Ironwood's brass barrel
bands ride one cell proud of the tube profile, a
band-height can would swallow them, and with maker
furniture shapes superseded the bands are what keep
Ironwood's SMG silhouette distinct from BlastForge's —
the 36-identity silhouette law is pinned by test and was
the deciding audit for the can's height. Supersessions for these types, under grill ruling 1
(maker-neutral authorship): Prismatek's crystal chamber
form (all three types), ThrowTech's canister magazine
(pistol and SMG — the canister becomes palette, not form),
BlastForge's procedural barrel shroud (absorbed as an
authored barrel variant), and the Wasteland-bone theme's
shape overrides (its palette law still applies; its cracks
draw over the authored forms). Assembly is untouched,
every living pass runs as before, and containment is
pinned by test: 648 render signatures outside the batch
byte-identical to the pre-batch-1 sweep, the S5 containment
sweep re-based in this slice to the complementary 576, and
the payload delta is 0. Each batch-1 type yields 131,220
combinations (3⁶ part-variant combos × 6 makers × 6
elements × 5 rarities) from its 19 pieces; authored
coverage across the library is now 437,400 of 787,320
combinations from 74 pieces. At the reconciliation merge with batch 2 (PR #450), the registry absorbed batch 2's per-type forms as data (per-set stamp order, Kinetic-remap slots, current-bed mode, muzzle overhang, single-piece slots), the batch-1 containment pin was re-scoped to the 504 signatures it shares with batch 2's suite (pin 868d8adf), and the S5 sweep was jointly re-based to the 432 pixel-only renders (pin ae034c1d) — no render moved in any of it.

**Pistol form swap (2026-11-07, parent audit).** The
pistol's authored form is not batch 1's own authoring: it
is the owner-approved package from the S5 scale-up final
batch (cybercache-prep/pxl-craft-sweep/s5-scaleup/pistol/),
approved by the owner from that package's matrix sheet the
same day. Its source is archived byte-for-byte at
scaleup-batch1/sources/pistol-authored.px.js (batch 1's own
pistol source is superseded, kept as
pistol-authored-batch1-superseded.px.js) and converted by
the same generalized converter — extended to normalize the
scale-up batches' index-keyed ANCHORS dialect — and the
resulting module's pieces, overlays, and anchors are
byte-identical to the approved package's own converter
output. The pistol-specific form facts recorded above for
batch 1's authoring (the suppressor's scorch collar) no
longer apply; the SMG and shotgun facts stand. The approved
form's anchors are the procedural pass's exact chamber
window centers (fractional texels), superseding batch 1's
rounded values, and its matrix composition is the package's
evidence roll (Barrel 1 / Grip 1 / Core 1 / Magazine 1 /
Sight 1 / Chamber 2), pinned in the batch-1 suite with its
one documented downstream jaggy cell (the Shock current
thread at (120, 28); the S2 gate budgets weapon-card jaggy
at 6 per render, and the suppressed barrel's composed
outline measures 2 cells at its can shoulder — both
recorded in the suite, neither re-authored: the owner
approved the form as authored).

**V4 — the 26 bespoke legendaries join the grammar
(2026-11-08).** The One Grammar carve-out above is retired:
the 26 painted legendary sprites (1,478,328 B) are deleted,
and every named legendary is now a hand-authored pxl piece
set in `legendaryAuthoredData.ts` — one bespoke set per
legendary id, authored as a single full-canvas form on the
240×88 card grid (sources in the V4 evidence folder,
converted by `scripts/convert-legendary-authored.mjs`),
with a derived 120×44 stage piece and declared grip/muzzle
anchors per legendary. Resolution is data, not engine
branches (Flexibility Law): `legendaryArt.ts` holds the
name/effect → art-id map, and both compositors take a
bespoke branch that stamps the set with its own full
identity palette — manufacturer, element, theme, wear, and
seeded-detail passes do not touch a bespoke identity; the
shared presentation furniture (selective outline, the
Legendary halo on card renders) still applies, so a
legendary reads as itself on every surface and as a
Legendary everywhere. The stage density keeps its own
authored derivation (a documented deterministic 2×2
downsample of the card form), because the held path and
the list path are different densities by law, not by
exception. Identities, names, effects, and stats are
unchanged — art only; no procedural render moved by a
single cell (the S5 goldens pass unchanged). Silhouette
fidelity against the retired paintings: IoU 0.385–0.721,
mean 0.573, measured per weapon in the V4 evidence NOTES
(Borrowed Time, Bad Decision, and Salvage Rights named
there as the weakest translations, with the detail the
texel grid cannot carry — engraved filigree, tally counts,
receipt print — named per weapon rather than flattened
silently). Wiki legendary plates now render from the
compositor on the same representative instances. Payload:
manifest total 8,260,959 B → 6,782,631 B; the 11,620,000 B
ceiling is held, not lowered, per the standing owner
ruling.

**Hero polish (2026-11-08) — the ranked list, executed.** The
polish slice the hero ship entry promised runs the integration
pass's ranked list against the shipped conversion, in rank
order, interior detail only: every silhouette measures IoU
1.0 against the shipped sprite (alpha masks identical, cell
for cell), anchors and pose maps untouched, palette identities
unchanged, payload +166 B across eight sprites. (1) The Hood
item is moot — the hood was excluded from the ship by owner
ruling and keeps the H1 cowl. (2) **Bulwark helm dome** — the
dome's mid-right was the broadest single-tone field in the rig
(306 connected cells, measured): an arc seam with a lit lip
now divides it into plates, with broken lip-shadow dashes
under the seam; the flange collar's right end steps down on a
diagonal and gains a mid seam, so the gorget reads as a curve,
not a shelf. A filled floor-tone falloff was tried first and
rejected on the composed figures — the pinned steel floor
(`#02030a`) is a value cliff on the dome face and read as a
black slot; the seam-and-shadow form carries the modeling
instead (recorded in the polish evidence NOTES). (3)
**Dreadplate thighB** — the front plate gains a modeled lit
patch on its upper-left, lifting it a full step off the shaded
mass it used to merge into. (4) **SI far-side leg pair** — the
same treatment one severity lower on thighB, plus the
lowerLegB shin plate's matching lit patch. (5) **Fin crest** —
interior only: each spike's shade face gains a mid-rust facet
(`m #954421`, hand-derived midpoint of the probed rust
endpoints, the same derivation precedent as the hot edge),
mounting tabs and band bolts seat the root band on the crown
plate; crest density via silhouette is NOT taken — the
crest's alpha is frozen with every other silhouette, and a
denser crest is a separate owner ruling. (6) **Bulwark back
lower machinery** — junction box under the left vents, a
conduit run across the right panel, a brass maker's plate,
and the left panel split's rivet pair. (7) **Dreadplate back
tank face** — one vertical panel seam per band at its own x
(never a grid), a lit scuff cluster and a dark chip cluster
in band 2, band 3's right side stepping down toward the rail;
the rail and its red status dot are untouched. (8) **SI back
swept lower plate** — a lit shoulder band under the top seam
and a curved seam following the sweep. (9) **SI torso right
pec — deliberate no-change:** the list itself flags the plate
as a deliberate design choice, and measurement backs leaving
it: the plate is already modeled by two shade steps (the
right-chest step-down and the far-side turn-away), the cyan
slash, and its seam pixels; its single-tone area is a
function of plate size, not missing form. **D4 register note
(the integration drift item, recorded as called for):**
palette key letters are per-family vocabularies and are NOT
portable across families — `G` is the glint `#fdf394` in the
SI / Bulwark / head-lane files but hot red `#ff3d3d` in the
Dreadplate files, and `H` is Dreadplate's hot core `#ffd9d2`
but the Hood file's cloth mid `#423620`. Nothing collides at
runtime (palettes are per-file), but a palette block must
never be copied across families without re-keying; any fifth
batch authors its palette against this note. Evidence:
`cybercache-prep/hero-pass/polish-evidence/` (per-part
before/after renders at inspect + stage sizes, composed-rig
pairs through the production compositor, diff-confinement
audit — composed-figure diffs land only on the polished
parts; the 63 regenerated golden baselines diff at ≤0.04%
each, confined to the hunter's frame).

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
Unspent skill points are not a claimable either — they are an action
waiting — and they announce in both places a player looks: as the
amber chip on the Hunter hero plate and as a standing chip under
Home's claim row, quiet at zero, opening Hunter → Skill Trees
directly (0–1 taps). Neither chip pulses or says "claim".

**The Hunter menu (2026-11-05).** Hunter's stops sit at tab press +
door tap (2 from Home), inside the discipline; their statuses print
on the doors at 0 taps once the tab is open. The menu order is the
surfacing decision: Skill Trees lead because progression is the
tab's substance, and Wardrobe/Account/Profile & Record close the
menu because identity and cosmetics are the tail. The Standings
badge's canonical carrier is the menu door; the Profile & Record
stop's badged door is its secondary (◦) carrier with the full pill
set.

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

### The Pixi stage pilot (owner rulings, 2026-11-06)

The boss fight stage gains a second renderer: a PixiJS v8 (MIT)
WebGL stage that executes this section's law continuously instead of
through DOM layers. The rulings that govern it, from the approved
pilot brief (2026-11-06, "everything you recommend"):

- **Scope is the boss fight stage only.** The Home roam stage is a
  later slice, gated on this pilot's approval. Characters' look is
  settled — this is motion work only: same sprites, same compositor
  output, same placements, zero art changes, zero layout changes.
- **Hit-stop is absorbed inside the 1150ms phase.** A brief freeze
  of the phase clock at impact (60ms normal / 100ms crit / +120ms
  at the death beat) makes hits land with weight; total fight
  duration and `FIGHT_TOTAL_BUDGET_MS` are unchanged, and
  `movement.ts` itself is unmodified — the Pixi stage executes its
  values as written.
- **The DOM stage stays as the automatic fallback.** No WebGL
  context, reduced motion, or any Pixi failure renders the fight
  exactly as the DOM stage does today; it is deleted only in a
  later slice if the pilot earns it.
- **Approval is by video.** The pilot PR stays unmerged until the
  owner watches the before/after fixture-fight recordings and
  rules; a Changelog entry is owed at merge, not before.

### The boss fight's home is the main stage (owner ruling, 2026-11-06)

The pilot shipped into the encounter card — and the owner's first
device pass exposed why that was wrong: he launched a boss from
Roam and the main stage never changed. Diagnosis found the stage's
boss scene had been unreachable for far longer than the pilot:
`bossPhase` was dropped at two hops (the screen never passed it to
the diorama; the diorama's own mode call never passed it on), so
`boss_fight` always computed the prep picture — backdrop, idle
hunter, crate — and the stage's boss HP plate could never light.
That was tracked follow-up F5, one layer deeper than recorded;
**F5 is closed.**

The ruling (Option A, the One-Stage Law of §1 applied to fights):
**the animated boss fight plays on the main stage.** The encounter
panel keeps what is panel work — boss select and intel, prep,
stances, launch, and the resolved/result state — and no longer
mounts a fight stage of its own. While an attempt plays back, the
panel publishes each decided timeline snapshot to the boss store
(`fightPresentation`) and drives the store's live-fight read; the
diorama renders the fight (the §10 Pixi stage, DOM fallback kept)
from that presentation and the boss HP plate rides the stage as
§3 describes. Exactly one animated fight exists. In prep, the
challenged boss stands on the main stage — presence without
combat: no beats, no plates — while the player prepares below.

### The work cycle — Motion Reboot M1 (owner rulings, 2026-11-06)

The bench modes were the stage's statues: in crafting, salvaging,
and workshop service the hunter stood at idle holding his weapon
in front of a motionless set piece, and a finished craft produced
no beat on the stage at all. M1 — the first slice of the Motion
Reboot brief (approved 2026-11-06, all grill items as
recommended) — replaces the statue with work:

- **One engine, choreography as data.** A work cycle is a SPEC —
  declared data keyed by id in `src/lib/pixel/workCycle.ts`
  (`WORK_CYCLE_SPECS`), sampled by one pure engine and executed
  by the parts actor as pose deltas composed onto the `work`
  pose. Family feel is spec data, never code: forge (high lift,
  spark burst, warm glow), crush (deep press, long hold, debris),
  assembly (low lift, long fit pause, no sparks), calibration
  (small motions, a three-step sweep). Mode and panel-scene
  bindings are data rows beside the registry
  (`WORK_CYCLE_SPEC_BY_MODE` / `WORK_CYCLE_SPEC_BY_SCENE`).
  **Flexibility law (owner, 2026-11-06):** a future family,
  activity, or custom gear shape plugs in by adding data against
  these contracts — a slice that hard-codes a family's motion
  into the engine fails review.
- **The period is law.** Every cycle runs on
  `SEGMENT.WORK_CYCLE_MS` (900ms) read from movement.ts; specs
  carry no period field, and movement.ts is unmodified. The
  start beat is `SEGMENT.STEP_BOB_MS`: the pose transition into
  `work` plays first, then amplitude ramps up across one period;
  stopping ramps back down. DOM execution (the renderer-strategy
  ruling: Pixi where motion is dense, DOM where simple).
- **Tenants.** The Home stage's crafting / salvaging / workshop
  service modes and the three panel bay scenes (crafting bench,
  repair bay, shield-tech bay) share the same specs. At the
  bench the hunter is unarmed — weapon slung, the extraction
  precedent — and holds the `work` pose between jobs; the cycle
  runs while a job in the mode's lane is running in the workshop
  mirror (salvaging has no queue: the mode holding the stage is
  the work). Between bays the accents differ by data; the
  shield-tech bay runs calibration, not the repair bay's fit.
- **Completion beat.** A unit settling in the stage's lane earns
  the celebrate pose and the finished unit rising off the bench
  on the law's loot-rise duration (`LOOT_RISE_MS`), once per
  settled unit, never replayed from the mirror's existing
  contents. The panel scenes keep their existing result flash.
  (Salvaging joins this beat in M4b — see the next section.)
- **Reduced motion** collapses the bench to the held `work` pose
  with no cycle and no FX — the pre-M1 picture exactly. The
  animated-node accounting (parts + FX + embers + rise) stays
  inside `MAX_ANIMATED_NODES`, asserted in the M1 tests.

### The item on the bench — Motion M4b + the V2 bench re-author (2026-11-07)

M1 set the hunter working, but the bench itself stayed empty: the
item being crafted appeared in no scene, a finished unit of any
kind but a weapon rose as a generic gold disc, and salvaging —
whose completion beat was forced null — got no ceremony at all.
M4b finishes the bench:

- **The bench family is authored art now (V2).** The three bench
  tiers (`set-bench-basic` 61×60, `set-bench-forge` 67×60,
  `set-bench-lab` 63×60) were re-authored in the pxl tool under
  the pxl-craft standard (lint 0; sources archived with the
  slice's evidence): hue-shifted ramps, selout, cluster
  discipline, the forge family's glow in the work-cycle spec's
  own hexes. Same sprite ids, canvases, and manifest anchors —
  each tier's work surface sits at its own anchor point, so the
  M1 work point means the same place it always did. Together the
  family sheds ~23.7 KB of painterly sprite payload (25,117 B →
  1,395 B) and reads as a bench at stage scale instead of a dark
  glittery block.
- **The seat is truthful (benchSeat.ts).** While a job runs, its
  output picture sits AT the work point — the same anchor the
  set-piece FX burst from, so the sparks land on the work itself.
  Resolution is a pure function of state the client already
  holds: recipe-specified outputs (consumable, material,
  cosmetic part) render through their real compositors; a named
  relic renders its grammar form at its fixed rarity (name +
  rarity are set at enqueue — only the instance seed is minted
  at completion, and the seat never claims it); service jobs seat
  the target record itself. A generic gear job's item DOES NOT
  EXIST mid-job — the server rolls it at the completion instant —
  so its seat is the honest maximum: an empty frame in the
  snapshotted rarity's color with the slot's glyph. Fabricating
  an item render for that seat fails review.
- **Every completion rises as itself.** The rise resolves the
  settled unit's own output: consumable, material, cosmetic part,
  or the minted inventory item of any gear kind (weapons were the
  only kind that rose as themselves before). The glow disc
  remains only for completions with no picture of their own —
  service work, or an item already gone from the inventory.
- **Salvaging celebrates.** A recycle settling while salvaging
  holds the stage earns the same beat grammar — celebrate pose,
  work cycle held, and the yield rising off the crusher (Scrap,
  the one thing every recycle pays; the destroyed item never
  rises). The signal is the salvage feed every recycle result
  already pushes to; a failed batch settled nothing and earns
  no beat. Seen-set discipline matches the craft lanes: history
  never replays, reduced motion silences the beat.
- **BenchFx speaks texel now.** The set-piece FX vehicle is a
  quarter-resolution canvas in the loot light kit's grammar —
  stepped concentric glow ellipses, texel spark rays, flat
  five-tone ramps (the FX register is flat by law, §8) — sampled
  from the same work-cycle sampler on the same start delay, so
  timings are M1's exactly (movement.ts untouched). The SVG
  stroke burst and blurred gradient divs are gone; one canvas
  node replaces up to five DOM nodes in the animated count.

### The roam stage on Pixi — Motion Reboot M2 (2026-11-07)

The pilot's ruling was "Pixi where motion is dense" — M2 brings
the Home ROAM scene to the pilot standard, on the pilot's own
machinery:

- **One shared stage core.** The texture helpers, procedural FX
  textures, and parts-node machinery the boss stage grew are
  extracted verbatim into `pixi/stageCore.ts` — one implementation
  of the pilot's rendering contract (resolution 1.0, nearest
  sampling, the held-weapon texture from the One Grammar card
  render). The boss stage consumes the core unchanged in behavior;
  the roam stage is a sibling on the same patterns, not a second
  Pixi implementation.
- **The switch is the pilot's switch.** Roaming renders through
  Pixi when WebGL is available; reduced motion, no WebGL context,
  or any Pixi failure renders the DOM scene exactly as before —
  the existing roam tests are the contract, and every other mode
  (bench, extraction, camp, boss prep) keeps the DOM scene. The
  Pixi chunk stays lazy.
- **Pose blending includes position.** Where the pilot's parts
  snapped position and tweened rotation, the roam parts lerp
  their anchor points over the same SEGMENT slot durations — the
  brief's standard, applied to roam only; the boss stage's
  execution is untouched. Mounted gear rides its mount part's
  live transform; the held weapon sways on PixelSway's own track.
- **Beats are the DOM's tables, sampled.** The roam tick beats
  execute through pure samplers (`roamChoreography.ts`) carrying
  PixelSceneLayer's keyframe tables value-for-value — the dodge
  and lunge, the hit reaction, the kill collapse — durations from
  movement.ts where the DOM reads movement.ts, the DOM's own
  literals where it uses literals. No hit-stop in roam: the
  absorbed hit-stop ruling was scoped to the boss phase, and the
  DOM roam stage has none. movement.ts is unmodified.
- **The pilot's DOM split holds.** Damage numbers and the crit
  flash stay DOM; ALL loot stays DOM and untouched — the rises
  and the LootMoment render over the canvas on their own clocks,
  exactly as over the DOM stage. The vista stack renders in the
  canvas with the DOM's own drift tracks (the widened-band true
  pan is V1's slice, not this one); the near layer's mask fade is
  the same gradient, baked into its texture. Enemies keep their
  current shipped art — the band rigs with the area palette wash,
  the bespoke elite flats — the bestiary conversion is a separate
  track.
- **Node accounting, honestly.** On the pilot's formula the
  full-dress roam scene counts 53 animated nodes against the
  boss fight's 40 — because the DOM scene it replaces animates at
  least as many framer-driven elements. The count is reported,
  never trimmed: trimming it would drop scene elements the DOM
  shows, which is a behavior change, not an optimization. Pools
  are pre-allocated; nothing spawns per frame.

### Extraction works — Motion M4a (2026-11-07)

Extraction was the stage's last statue: the hunter tweened into
the `work` pose and held it for an entire 10-minute pass, and a
settled pass's finds died in the workspace panel as a text card —
nothing on the stage ever showed a find landing. M4a closes
both, with no server change (the settle response already itemizes
every pass by type and count):

- **The sift cycle.** Extraction joins the work-cycle registry as
  a data row (`WORK_CYCLE_SPEC_BY_MODE.extraction = 'sift'`): a
  two-handed lift of the sift screen, a late dig, the long settle
  while the screen works — grit off the screen at the dig, the
  site lamp's glow at the rig, executed by the same M1 engine on
  the same law period. There is no job mirror to read: the mode
  holding the stage IS the work (the salvaging precedent), so the
  cycle runs while the occupation holds the slot. The bench
  lanes' machinery (lane reads, the seat, completion rises) does
  not extend to it — the registry row is the only coupling.
- **Finds appear.** The settle's only client recipient is the
  panel's state read; the panel republishes each settled pass to
  the extraction feed (`extractionFeedSlice`), and the stage
  consumes it under the mirror's seen-set discipline — history
  never replays, passes settling under another mode are marked
  seen without a beat, a multi-pass settle sequences one beat
  per pass oldest-first. The beat is the bench grammar: celebrate
  pose, cycle held, and the pass's finds rising off the rig —
  one `PixelMaterial` rise per material/essence type at its exact
  settled count (largest six; the panel's "Just landed" card is
  the complete record), a pure function of the same payload the
  panel prints, so stage and card can never disagree. A pass
  with no finds earns no beat. `LootMoment` is not the vehicle —
  it is gear/rarity-typed and cannot consume material counts —
  and no per-draw replay exists: the server folds each pass's
  draws into per-type counts, so per-type appearance is the
  honest maximum. Rise timing is the existing `LOOT_RISE_MS`;
  the loot ladder appears nowhere in this slice, and
  movement.ts is unmodified.
- **Reduced motion** restores the pre-M4a picture exactly: held
  `work` pose, no cycle, no FX, no rises.

### Endless comes home — Motion Reboot M3 (2026-11-07)

Motion Reboot grill ruling 5, executed on the boss fight's
stage-home pattern: an endless fight's animated home is the MAIN
stage. The defect it closes is the PR #384 follow-up — the endless
kind had no stage mode at all, so `modeFromActivity` fell through
to the idle scene and the stage showed the CAMP VISTA for a run's
whole duration while the Chaos Chamber panel ran a second, private
fight stage inside its own card. Two animated stages during a
run's fight, and the wrong one on Home.

- **The publishing pattern, carried.** The Endless panel walks the
  Chef-decided encounter exactly as the boss panel walks its
  attempt, and publishes every snapshot to the boss store
  (`endlessPresentation`) alongside its own HP readout state; the
  diorama renders `BossFightStage embedded` under
  `data-testid="diorama-endless-fight"`. The presentation model is
  shared, not forked — one fight engine, one stage. The panel
  mounts no fight stage; it keeps depth, escrow, banking, the
  action-skill control, the result card, and both HP readouts.
- **The identity guard is the run id.** Migration 0028 pins the
  endless run into its activity slot (`active_actions.target_id =
  run id`, re-guarded on every advance), so the screen hands the
  diorama the record's `targetId` and the stage honors a
  presentation or presence only when its run id matches — a stale
  publication from a finished or abandoned run can never wear the
  stage. This is the boss path's `bossId === challenged boss`
  guard with the run as the identity.
- **Presence is the between-fights state — a deliberate choice,
  not camp-by-accident.** While a run is live, the panel publishes
  the run's presence: the NEXT encounter standing in its own arena
  on the main stage (boss depths: the kit's arena; pack depths:
  their rotation area's ground — the same backdrop derivation the
  fight stage uses, so presence and fight share one backdrop per
  encounter), hunter at armed standby, the boss-prep treatment.
  The camp crate never renders during a run. The depth band's
  tint stays a fight-stage property; presence carries no tint.
- **Defeat closes the run, unchanged.** The ladder, entry costs,
  rewards, and banking are untouched (zero server diff); a defeat
  still ends the run at the encounter, and the stage publications
  retire with it — the panel's ended card is the run's last word.
  The stage's boss HP plate overlay is deliberately NOT extended
  to endless: the panel owns both HP readouts. A run whose panel
  has not published yet (the loading transient) shows the hunter
  at standby on the roam ground with no crate and no enemy —
  presence replaces it the moment the panel loads.
- **Pinned by `src/test/endlessStageHome.test.tsx`**: presence on
  stage with no camp crate; the published fight on the main stage
  (exactly one fight stage in the document); the run-id guard
  (a foreign run's presentation never renders); a real advance
  driving the fight end to end; defeat closing the run with both
  publications cleared. `bossStageHome` passes unmodified — the
  boss path is untouched. movement.ts is unmodified.

### Vistas land — Full Visual Program V1 (2026-11-07)

The eight authored vista sets replace the zone paintings as the
home stage's backdrops: seven roaming areas (Dustwaste, Redline
Circuit, Ironwood Bastion, BlastForge Yards, Prismatek, ThrowTech,
HelixWorks) plus Camp. The paintings' JPG stacks (2,753,117 B)
leave the bundle; the authored sets total 66,305 B.

- **Bands display height-fit + pan, never object-cover.** Each
  scene's far/mid/near bands are 1440 design-px wide (1.5x the
  stage), authored tileable, and render wrapped — the DOM stage
  tiles with repeat-x, the Pixi stage runs wrap pairs — so the
  seam is invisible at any offset. While roaming, the scene PANS
  across the band field on the proof model's parallax ratios
  (far 0.25 / mid 0.55 / near 1.0, held as per-scene data in
  `src/lib/pixel/vistaScenes.ts`). At rest the band's center crop
  shows — the framing every set was composed for. The bg plate
  stays a full-bleed cover sprite underneath. Boss and endless
  ARENA backgrounds are not vista scenes and keep their own art;
  panel scenes that borrow an area plate (crafting, extraction,
  the cache stage) inherit the authored plate through the same
  sprite swap, unchanged code.
- **Ambient life instances from data, on both renderers.**
  Each set's `ambient-motion.json` contract is normalized into
  data rows next to the scene spec; a deterministic sampler
  (`vistaAmbient.ts`) and ONE canvas painter serve the DOM stage
  (one canvas per paint layer) and the Pixi stage (the same
  canvases as textures), so parity is structural. Elements
  anchored to a band structure — a reactor core, a gate pulse, a
  furnace mouth — ride the pan glued to their hero; free elements
  keep their own clocks (Layered-Motion Law: nothing is baked
  into a band, elements move independently of the pan and of each
  other). The authored sets supersede the aprop drift system and
  the generic ember spans on vista scenes (the Dustwaste ember
  row IS the ember spec, drawn from its authored sprites).
  Reduced motion holds the pan and paints one static frame;
  fallbacks follow the existing stage rules.
- **Camp is the idle backdrop.** Idle no longer shows the current
  area behind a lone crate: the authored camp scene serves, the
  hunter takes the fire seat, and the camp props (fireglow,
  crate, firepit, supply) stand at their seat-record positions as
  separate sprites — flame, smoke, embers, and fireflies are
  ambient-canvas life over them.
- **Budgets hold.** DOM full dress counts 40 animated nodes
  (bands 3 + ambient canvases 4 replacing re-cuts 3 + aprops 2 in
  the §4.9 formula) — at, not over, the MAX_ANIMATED_NODES
  budget. The Pixi roam count drops 53 → 43 (ember pool stands
  down; ambient canvases join). Sprite payload: 8,260,959 B
  manifest-sum after landing; the 11,620,000 ceiling is unmoved.
- **Pinned by `src/test/vistaScenes.test.tsx`**: scene/sprite
  resolution, painting removal, scene selection (arenas null),
  wrap math, instancing from data, band-anchored pan riding,
  blink duty, and the DOM stage's vista DOM shape. Golden
  baselines regenerated — every changed scene is background-
  driven (the renderer composites scenes over the zone plate).
  movement.ts is unmodified; gameplay and economics untouched.

### Presence — Full Visual Program M4c (2026-11-08)

The stage came alive slice by slice (roam in Pixi, the work and
extraction cycles, the endless fight's home, the V1 vistas) — but
the places the PANELS show stayed postcards: the workshop and
market-board bay scenes rendered their area as a single static
plate, and on the Home stage itself the hunter stood at armed
idle aiming his weapon at his own vendor stall while a market
listing ran. M4c closes both, on the data the game already owns:

- **Panel scenes inherit their vista.** The shared panel shell
  resolves the plate's authored vista scene
  (`vistaSceneForBackground`) and the stage paints its bands and
  ambient life from the SAME scene data the Home stage consumes
  — one source, consumed never forked. The crafting bench stands
  in BlastForge, the repair and shield-tech bays stand in
  ThrowTech, the (panel-unmounted, one-stage law) extraction
  scene stands in Dustwaste. The pan stays held — a workplace
  doesn't travel — while the ambient elements move on their own
  specs. A plate with no vista scene (an arena) keeps the plain
  plate. The ambient life is canvas paint: no new DOM nodes, the
  composition budgets hold.
- **The stall is a work-cycle tenant.** `marketListing` joins
  the registry as `stall` — the lowest amplitude in the registry,
  no strike, no sparks, long holds between small handling
  gestures: the hunter tends his stall, weapon slung, while the
  listing holds the stage. The bench lanes' job-mirror machinery
  does not apply (a listing is not a workshop job), so the
  diorama resolves the stall separately, on the M4a extraction
  pattern: the mode holding the stage IS the work. No BenchFx —
  nothing is struck at a stall. Reduced motion holds the work
  pose, exactly the bench contract.
- **The Market tab is a deliberate no-change.** The tab has no
  scene surface — pitch, doors, rows — and §3's law is compact:
  price is the hero. Presence lands where the market's scene
  actually is (the Home stage's stall, above); no scene, header,
  or copy is added to the tab.
- **Deliberately not duplicated:** boss-prep presence is the
  main stage's (#431/M3), panel scenes gain no fight or activity
  rendering (One-Stage Law untouched), and the camp fidget is
  sampler-family work that pairs with the M2a leg program, not
  this slice.
- **Pinned by `src/test/panelPresence.test.tsx`** (every panel
  scene's bands + ambient canvases instanced from its vista
  spec, data identity on the layer sprites, the arena null path,
  canvas-not-nodes) and the stall rows in `workCycle.test.ts` /
  `workCycleStage.test.tsx` — the M1-era pins that market
  listing never cycles were superseded deliberately, in place.
  movement.ts is unmodified; gameplay and economics untouched.

### Set dressing lands — Full Visual Program V2 (2026-11-08)

The V2 authoring pass (2026-11-07) drew ten set pieces in the
pxl register and measured a seat for every work surface, but only
the benches ever reached the game — and those by #447's own
build, not the authored canvases. This slice closes the strand:
an inspect-first inventory against master, then the landing of
everything still missing that still had a living seat.

- **The inventory verdicts (per piece).** LANDED here:
  `set-refinery-crusher`, `set-refinery-furnace`,
  `set-bay-lift`, `set-calibration-rig`, `set-bay-tray`,
  `set-bay-wall-listing`, `set-vendor-stall` — all seven were
  still the retired paintings on master (byte-identical to the
  authoring pass's "current" captures) and are now the authored
  sprites at their authored canvases. SUPERSEDED: the three
  benches (`set-bench-forge/basic/lab`) — PR #447 re-authored
  them at the legacy canvas sizes with the item-on-the-bench
  wiring; the V2-authored bench canvases stay evidence, and the
  shipped benches keep the work points #447 tuned. DELIBERATE
  NO-LAND (a record, not an omission): the furnace gains no
  renderer — it was grammar data only (`ACTION_SETS.craftingLab`
  names it; no scene ever mounted it, and the bench tiers have
  since collapsed to one), so its authored art lands as the
  registered sprite the golden lab composition and any future
  station can consume, with no scene invented for it.
- **Seats are data now.** `src/lib/pixel/setSeats.ts` carries
  the authoring record for all ten pieces — seat point, anchor,
  clear zone, max item, and the named reasons for the two
  seatless pieces (the furnace is a heat source, the wall
  listing is an information surface) — keyed by sprite id, so a
  future set piece plugs in by adding a row. The bench rows
  describe the superseded authored benches and are marked as
  such in the module: geometry derives only from rows whose art
  actually shipped.
- **The two named wiring deltas are wired.** In the repair bay
  the vehicle stands ON the lift's deck line
  (`seatPointBottomPct` from the lift's seat) instead of floating
  at the retired painting's +4%, and the bay's work FX burst
  from the deck. In the shield-tech bay the behavior glyph
  renders as a child of the calibration rig's own actor box,
  centered on the ring seat and sized to its disc, and the
  calibration sweep walks that same center. On the Home stage
  the work point derives per mode from the mode's piece: the
  salvage FX and any seated picture ride the crusher's mouth
  rim, the service lane's ride the lift's deck; the crafting
  lane keeps #447's tuned point for #447's bench.
- **The stall verdict was earned, not assumed.** The evidence
  pass's side-by-side and this slice's live captures agree: the
  retired painting read as a dark glitter mass at stage size,
  the authored stall reads as a stall — canopy, open counter,
  scale, crate — in the vista's own rust register. It lands.
- **Manifest truth + payload.** The seven sprites' manifest
  entries carry their authored dimensions and anchors recomputed
  from the new alpha masks by `pixel-key.py`'s own formulas.
  Payload: −61,308 B on the swap (64,101 B of paintings out,
  2,793 B of authored sprites in); manifest-sum total
  6,721,489 B, the 11,620,000 B ceiling unmoved.
- **Golden boxes are aspect-true for the dressed pieces** (the
  authoring record's explicit wiring note): the bay, shield-tech,
  bench-lab, and rep-desk compositions keep their heights and
  centers and take the authored aspects; the eight regenerated
  baselines were audited pixel-by-pixel — every diff confined to
  the dressed pieces' old∪new boxes.
- **Pinned by `src/test/setSeats.test.tsx`** (record coverage,
  seat sanity, authored canvas sizes, the deck-line vehicle, the
  ring-centered glyph) plus the golden suite. movement.ts is
  unmodified; gameplay and economics untouched; the One-Stage
  Law holds — dressing changed inside the scenes that exist.

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
  (Follow-on, 2026-11-05: the section's header — the full-width
  vehicle status line carrying the status sentence and the
  out-of-fuel / worn-out paragraphs — is deleted under the
  no-paragraphs law; the vehicle slot is a button in the Loadout
  panel's header and the button toggles the same in-place
  expansion. §3 carries the current state.)
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