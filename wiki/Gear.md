# Gear

Gear is your hunter. Everything you equip is a real item instance with its
own level, rarity, roll quality, affixes, and history — and what you see
rendered on your hunter is that actual item, never a generic stand-in.

## Your loadout: 7 gear slots + a vehicle

Your loadout has eight slots. Seven are gear:

- **Primary, Secondary, and Heavy** — three weapon slots. Your Secondary
  contributes a reduced share of its passive stats (30% instead of full),
  so it supports the Primary rather than duplicating it.
- **Ordnance** — your heavy hitter: flat damage plus shield and armor
  damage, with its own effect.
- **Shield** — hit points, recharge rate, and damage mitigation, plus a
  behavior archetype on newer shields (Standard, and types such as Nova,
  Absorb, Amp, and Turtle). The recharge rate is live: on any tick where
  you take no damage, the shield refills at that rate, up to full (the
  Combat page carries the full rule). A shield's art shows its behavior: each
  archetype has its own form (Standard's finned housing, Nova's shutter
  ring, Absorb's shelled orb, Amp's capacitor towers, Turtle's bulwark
  slab), the body wears its element's colors, and the frame carries its
  rarity.
- **Class Mod** — boosts one skill tree and specific nodes in it. Its
  artwork is a different device per tree (a Gunslinger core, a
  Demolition drive, a Scavenger chip, a Fixer relay rig), and the
  nodes it boosts light up as pips on the device face — position is
  the node, brightness is how hard it boosts.
- **Relic** — a pure affix piece: no base stats of its own, all rolled
  bonuses. Four **named craft relics** break the rolled pattern on
  purpose: their workshop effects are fixed (never rolled, never
  reforgeable) — see [[Crafting]] § Craft relics. A relic's picture is the object its name names — a Neural
  Key looks like a key, a Void Prism like a prism — and where it
  dropped only changes the base it rests on, never its shape.

The eighth slot is your **vehicle**, which works differently enough to
have its own page: [[Vehicles and the Garage]].

## Saved builds

You can save up to **5 builds** — free, no unlocks. A build captures
all eight slots (vehicle included) plus your belt assignments, so one
tap swaps your whole kit: boss build, farming build, market-day
build.

Every build also wears a **glyph** next to its name — a gun for the
combat kit, an anvil for the crafting kit, a truck for the courier
set. Pick one in **Manage** with the **Icon** control; the glyph
rides the build's chip and the Loadout header, so your kits read
apart at a glance. A new build starts with the gun.

Applying a build is one checked operation, not a best-effort shuffle.
Every slot either equips or tells you exactly why it didn't:

- **Gone** — the saved item was sold, salvaged, or traded away. Pick
  a replacement for that slot right from the report.
- **Listed** — the item is up on the market. One tap delists it and
  finishes the apply.
- **Out on dispatch** — the item is away on a mission; the report
  shows when it returns, or you can recall the mission and apply.
- **Committed to a job** — the item is in a repair or shield-tech
  job; it frees up when the job finishes.

Whatever can equip, equips — a partial apply still lands the rest of
the build and names the slots that need attention. A build only
shows as your active build once every slot actually landed, so the
label never claims a kit you aren't wearing.

## Weapons: type × manufacturer × element

Every weapon is built from three choices the roll makes for you:

**6 weapon types.** Pistol (balanced all-rounder), SMG (fast, ramping,
status-friendly), Shotgun (burst and multi-hit wave clearing), Sniper
(high crit, built for boss killing), Launcher (slow, huge hits, armor
break and stagger), and Beam (the elemental/status specialist).

**6 manufacturers**, each with a baked-in identity. Redline bakes in
attack speed and ramping damage. Ironwood is crits, precision, and boss
killing. BlastForge is explosions, splash, and armor cracking.
Prismatek specializes in elements, with status chance and status damage
baked into every roll. ThrowTech builds deployable tech with extra wave
damage. HelixWorks is modular and flexible, with a better roll-quality
floor on every roll.

**6 elements.** Kinetic is the neutral baseline. Fire burns flesh and
organic targets over time but struggles against shields. Shock breaks
shields and struggles against heavy armor. Corrosive eats armor and
mechanical targets. Cryo slows and staggers, helping against fast and
enraging enemies. Void is high-variance power aimed at elites and
bosses. Matching an element to a target's weakness pays a ×1.3
multiplier; hitting a resistance pays ×0.7.

### How a weapon looks

Every weapon picture in the game is drawn from the actual item — its
type, manufacturer, element, rarity, rolled parts, affixes, and roll
quality — never a generic icon. One drawing serves every surface:
the gun in your hunter's hands on the stage is the same full-detail
picture as its card (inventory, market, loot, inspect, collections),
with the card's display furniture folded away — no halo ring, no
pooled glow, and a sniper's bipod stays folded in hand. Compact
list rows and feed thumbnails use a smaller, lighter drawing of
the same item.

Each manufacturer owns a signature silhouette, readable by shape
before color: Redline is a swept **wedge** with a skeleton stock,
Ironwood a wooden **longbow**, BlastForge a bolted **anvil** slab,
Prismatek a faceted **prism**, ThrowTech a bolted-together **kit**,
and HelixWorks a rounded **coil** wrapped in brass rings. Within a
maker and type, the rolled parts still vary the gun — chambers,
magazines, sights, and barrels differ from item to item.

Snipers, pistols, SMGs, shotguns, launchers, and beam rifles are
drawn from hand-authored part art: every chamber, magazine,
sight, barrel, grip, and receiver variant is a drawn piece,
assembled by the same rules — the rolled parts still pick which
pieces your gun is built from, and maker, element, and rarity
dress them exactly as described here. A launcher's magazine is
its feed drum or box and its sight the carry handle over the
receiver; a beam rifle's element runs in the lit channel along
its spine — on a Kinetic beam the channel stays dark, warm
conduit in the maker's tones.

All of the game's art renders as pixels on canvas — item art,
icons, and interface marks alike. No vector-drawn art remains in
the game; the only vector mark anywhere is the Google "G" on the
sign-in button, which is Google's brand glyph, not game art.

The element shows as a lit current that runs from the chamber along
the barrel to the muzzle, in the element's color. Kinetic has no
current at all — plain machined metal, honestly unlit. Rarity
changes the finish, never the shape: trim lines that arrive as
rarity climbs (on a sniper: a magazine stripe at Uncommon, a
receiver line at Rare, a chamber line at Epic), an edge glow on Epic, and a gold halo on Legendary (in hand,
a Legendary keeps its gold trim; the halo ring itself is card
display only). Named legendaries keep their own bespoke art on
every surface — since the V4 pass, that art is hand-authored pixel
data (one authored piece set per legendary) rendered by the same
weapon compositor as every procedural gun, not a painted sprite.

## Rarity and affixes

Gear rolls in **5 rarities**, and rarity sets how many affixes (rolled
bonus lines) the item carries:

- **Common** — 0–1 affixes
- **Uncommon** — 1 affix
- **Rare** — 2 affixes
- **Epic** — 3 affixes
- **Legendary** — 4–5 affixes

Higher rarity also rolls better on average: each tier adds a roll-quality
bias (Uncommon +5, Rare +10, Epic +15, Legendary +20). **Roll quality**
itself runs 0–100 and is labeled Poor, Low, Standard, Strong, Excellent,
and — at 96 or better — God Roll. Two items with the same name and rarity
can be very different items; the affixes and the roll quality are why.

Legendary weapons can additionally carry one named
[[Legendary Effects|legendary effect]] — see that page for how they work.

## The one gear home

Everything gear lives on the **Gear tab**, as one merged page — the
Loadout page. Everything below is on it, in one scroll:

[[images/ui/gear-loadout.png]]

*The Loadout page on day one: your hunter on the doll stage, the three gun rows down the right, the accessory band beneath, and the inventory below.*

- **The doll zone** — the equip surface: your hunter stands on a
  compact stage wearing your actual equipped gear — your primary
  weapon in his hands, shield, relic, and belt mounted on the
  figure. The stage carries a **Wardrobe** door (its home is on
  your Hunter profile; the door here is a shortcut) and, at its
  foot, your **DPS and HP** plate. Down the right side, the three
  gun slots are full rows — Primary biggest, with the rolled gun
  itself drawn wide — and the four accessories (Shield, Class Mod,
  Relic, Ordnance) sit in a band beneath. Each slot block prints
  the item's name in its rarity color and a **perk line**: the
  headline stat (DPS for a weapon, HP for a shield, payload for
  ordnance, node count for a class mod, the lead bonus for a
  relic) followed by the item's next real perks — status chance
  and crit on a weapon, mitigation and recharge on a shield, and
  so on. Rarity and element are read by color — the name's color
  is the rarity, the icon's tint is the element — never spelled
  out in the line. Tap any block to open the **slot picker** for
  that slot. Your vehicle slot lives here too: it is the
  **button** in the panel's top-right corner — equipped vehicle,
  yield, tank, condition — and it opens the **Garage**, which
  expands in place under the panel with everything vehicle:
  equip, refuel, and repair (see [[Vehicles and the Garage]]).
  (Your credits, scrap, keys, and item count print once, in the
  strip at the top of the tab.)
- **Inventory** — everything you own, with salvage/recycle. Its
  header and toolbar stick to the top while you scroll. Two views:
  the **Grid** shows each item as a card — headline stats and the
  item's own rolled affix lines — while the **List** is one line
  per item for fast scanning: its level in a small LV column, the
  item's picture (kept bare), its element as a small badge beside
  the picture (the badge's color and symbol are the element; it is
  never spelled out), its full name in its rarity color — long
  names wrap onto a second line rather than cutting off — and the
  one number that kind is judged by (a weapon's DPS, a shield's
  HP, ordnance damage, a class mod's boost, a relic's top affix).
  Equipped items carry their slot chip; locked items carry the
  lock. Everything else about an item — affixes, maker, source,
  the rest of its stats — is on its inspect sheet, one tap away.
  The ⇄ button on a row starts a comparison: tap it on one item,
  then on another, and the two open side by side (tap it again on
  the same item to cancel).
- **Sorting** — one dropdown at the top of the inventory. The
  **General** group comes first — Best Overall, Rarity, Item
  Level, Newest, Name, Activity Value, Affix Count, Salvage
  Value — and applies to everything you own. Below it, one
  labeled group per kind carries that kind's real stats: weapon
  DPS, damage, crit chance and crit damage, status, attack
  speed, boss and farm power; shield HP, mitigation, recharge;
  ordnance payload, shield damage, armor damage; class mod node
  boosts; relic idle, drop, and scrap values. Picking a kind's
  stat also narrows the list to that kind — sorting by shield
  HP means you are looking at shields — and a banner under the
  toolbar says so, with a one-tap **All gear** return. General
  sorts always cover the full list again. Sorts run highest
  first (names run A–Z), with a direction toggle beside the
  menu, and your choice is remembered between sessions.
  Equipped items stay pinned at the top either way.
- **Belt & Stacks** — your belt, plus every stack you carry:
  consumable batches with their quality % printed, materials,
  and essences. (Up in the Loadout panel, the belt's three slots
  print under a **Consumable Belt** label with a **?** beside it —
  the ? carries the belt's explanation: slots load at the Loadout
  Bench, all owned consumables auto-activate while roaming, and
  changes verify server-side with no Save button.)
- **The Workshop status strip** — at the page's foot, printing the
  bench at a glance (jobs running / queued / ready, and whether
  Craft holds your action slot); it opens the **Workshop** on the
  Home tab's Craft workspace, where the bench lives (see
  [[Crafting]]).

Tap any item to open its **inspect sheet**: full stats, affixes, source,
and your options — equip or unequip it, lock it (locked items are
protected from salvage), or salvage it. The stat deck is one shared
rendering everywhere it appears: the inspect sheet and the
[[Caches|cache reveal]] print the same numbers the same way — DPS,
every affix spelled out, and a legendary effect's name *and* what it
does — so the deck you read at the reveal is the deck you inspect
later, word for word.

[[images/ui/gear-inspect.png]]

*An inspect sheet: the item drawn at card size, its headline numbers and rolled stats, where it came from, and the actions you can take on it.*

### The Trade: what a swap does to your build

Under the stat poster, the inspect sheet prints **The Trade** — the
item weighed against the piece it would replace. Two groups, and
only the numbers that actually change: **You gain** and **You give
up**, each line showing the value your hunter ends up with and the
signed change beside it — DPS, HP, shield and armor break, rare
find, offline earnings, scrap, XP, and the activity rates your
skills feed (crafting and salvage speed, market bonuses, and the
rest). The things no single number can carry print as their own
lines: a legendary effect you'd gain or lose, **with what it does**;
affixes gained and lost by name; a class mod's skill-node boosts by
skill name; and an action skill a swap would qualify you for — or
cost you. If a swap moves nothing, the sheet says so plainly: *No
build change.* When you've picked a boss, the DPS line prices
against that boss, like your Home rundown. The same Trade prints in
the Market's inspect sheet, weighed against your equipped piece —
it's the buy decision, answered before you spend.

The slot picker and the Market's item rows carry the lighter half
of the comparison: a compact strip of the item's own numbers against
the equipped piece — weapon DPS first, relic affixes by name, class
mod boosts by skill name — so you can scan a list fast, then open
the inspect sheet for the full build trade before you commit.

One honesty fix rides with this: your **class mod's skill boosts
now count in every number the game shows you** — Home, Profile,
boss prep, and The Trade all price the boosted skills, the same
values the game has always paid out. If you wear a class mod, your
skill-driven numbers on screen went up to meet the truth; nothing
about payouts changed.
payout, and the salvage result names exactly what you got. Salvaging a
Legendary also pays out **legendary cores** — see [[Collections]] for
the exact yield, because cores are the scarcest currency in the game.
Crafting materials come back only one way: with the **King of Scrap**
keystone, breaking down a **Common** item can pay one bonus material
matched to the item's kind (weapons lean toward Ballistic Parts,
shields and ordnance toward Reactive Components, class mods and
relics toward Tech, everything else toward Scrap Alloy). Essences
never come from salvage — roam for those, or buy them.

**Bulk salvage** clears space in one move. The salvage button on the
Gear tab opens a rarity sheet — **Commons only**, **Uncommon & under**,
**Rare & under**, or **Epic & under** — with the live count each level
would take. Pick one and the sheet closes right away: everything
eligible at or under that rarity leaves your inventory immediately
and the settlement finishes in the background, followed by one summary
card showing the totals you gained when it lands. If a settlement
ever fails, nothing is scrapped — the items come back and a notice
says so. **Epic & under** asks you to
confirm first, with the epic count stated. Locked and equipped items
are always left alone, and **Legendaries are never bulk-scrapped** —
they are salvaged one at a time from the item's inspect sheet.

**Auto-Salvage Rules** (in Settings) put that same breakdown on
autopilot for fresh drops. Set a max rarity (up to **Epic** — never
Legendary), a max roll quality, and a yield: **Scrap**, or
**Materials**, which breaks each item down into +1 of its kind's
crafting material instead (weapons → Ballistic Parts, shields and
ordnance → Reactive Components, class mods and relics → Tech) and
reports the scrap you traded away. Whenever a **roaming claim** or an
**offline settlement** stores new drops, each drop at or under both
caps is salvaged on the spot, for exactly what manual salvage would
have paid — skill bonuses like Hoarder's Instinct included. Boss
loot, cache contents, market deliveries, and crafted items are never
auto-salvaged, and the rule never reaches back into your existing
bag: it only ever sees the drops a settlement just brought in. Every
auto-salvage is announced — a feed line per item, a summary in the
claim and the offline recap, and a marked record in the
[[Activity-Log]].

## Reforge: fix one affix

The **reforge bench** rerolls **one** rolled affix on a weapon, shield,
class mod, relic, or ordnance piece, drawing the replacement from the
same pool the item originally rolled from.

- **Cost:** scrap equal to **3× the item's own salvage value**, so the
  price scales with the item's rarity and level.
- **Legendary items** additionally burn **2 legendary cores** per reroll.
  Short on cores at the bench, the confirm's core line carries the
  quick-buy **+** — it opens the [[Crafting|quick-buy sheet]] priced
  for exactly the gap, so the reforge in front of you never waits on
  a Market trip. (The cost's Scrap half never carries a **+** —
  Scrap is earned, not bought.)
- A reforge changes that one affix and nothing else. Rarity, level,
  element, manufacturer, roll quality, and a weapon's legendary effect
  are the item's identity — they never change, a non-Legendary can never
  gain a legendary effect here, and a Legendary never loses one.
- **Vehicles cannot be reforged** — they are a separate item family
  managed in the Garage.

Reforging is a decision, not a chore: you are burning roughly three
items' worth of salvage to fix one keeper. Save it for items you intend
to keep.

## Where gear comes from

Roaming drops, [[Bosses|boss loot]], [[Caches]], the [[The Market|player
market]], and the [[Crafting|Workshop]] all feed the same inventory.
Workshop gear is capped at Epic — Legendaries are found, not made. Boss
prep shows you the boss's mechanics and your own numbers, never a
computed win chance; choosing which gear to bring is the game. See
[[Combat]] for how these stats meet an enemy, and [[Reference]] for the
full data tables. The Reference pictures all of it, too: every weapon
frame by type and maker, every element read on the frame, and every
shield, ordnance, class mod, and relic form the game renders.

---

_Source of truth: `src/constants/weaponTypes.ts`, `src/constants/manufacturers.ts`, `src/constants/elements.ts`, `src/constants/rarities.ts`, `src/content/reforge.ts`, `src/screens/ChestScreen.tsx`, `src/screens/InventoryScreen.tsx`, `src/store/slices/loadoutSlice.ts`, `src/lib/gear/affixPools.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
