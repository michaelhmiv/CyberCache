# Caches

Data Caches are the game's box-opening lane: spend an opening, get a weapon forged for you on the spot at your level. Caches are deliberately kept distinct from loot drops — drops are earned in play and are never sold; caches are the optional lane beside them, and the ads in this game live here and nowhere else. There are no ads on the play screen, ever.

## Every opening is paid — no daily limits

There is **no daily cap, no free daily box, and no reset**. Every opening costs **1 cache key or one rewarded ad** — your choice, per opening, as many times a day as you can pay. Scarcity lives in the supply of keys, not in a budget: keys are rare, and ads are the always-available rail.

- **Key opening:** spends exactly 1 cache key from your stock.
- **Ad opening:** watch one short rewarded ad. The ad rail is the same on every platform (owner ruling, 2026-11-09) — until iOS ships, rewarded ads run in the Android app.
- With no key and no ad, there is no opening — nothing is free, and nothing is owed at midnight.

## What a cache gives you

Each opening forges **one weapon at your current level**. The rarity is rolled from the cache table, and only from it:

- **Rare — 60%**
- **Epic — 32%**
- **Legendary — 8%**

There are no Common or Uncommon cache weapons. A cache Legendary is a strong weapon — but a cache-forged weapon **never carries a [[Legendary Effects|legendary effect]]**. Named legendary effects come from boss drops — see [[Legendary Effects]] for how they work. That line is what keeps found legendaries special, and it is not for sale at any price.

Your build can improve the draw itself: Scavenger investment and the Cache Optimizer track raise your cache quality, which bends the rarity draw in your favor.

## Cache keys

A **cache key** pays for one opening. Keys are a stock you hold and they never expire — unspent keys carry over indefinitely. Keys are the **only** cache currency. (The game once had key fragments that assembled into keys 5-to-1; fragments were retired as a currency — any fragments you still held were converted into keys at 5-to-1, rounded down, when the change landed, so nobody lost value.)

Keys reach you from play, for example:

- **Roaming** — a whole key drops now and then as you roam, roughly one per seven hours of roaming (see [[Actions and Occupations]]).
- **Login streaks** — the day-7 reward of the streak ladder pays a cache key (see [[Leaderboards and Streaks]]).
- **Weekly leaderboards** — the top finishers take cache keys: **3 for 1st, 2 for 2nd, 1 for 3rd**.
- **Contracts** — clearing your full weekly contract set pays **1 cache key** (see [[Contracts]]).

Every one of those sources feeds the same key stock. A key from a leaderboard and a key from roaming are the same key.

## Opening a cache, step by step

1. **Go to the cache screen.** It shows your key stock and the rule: every cache box costs 1 cache key or one short ad — no daily limit.
2. **Open.** Choose per opening: **Open with Key** (the button shows how many keys you hold), or **Watch Ad to Open**.
3. **Take the weapon.** The forged weapon lands in your inventory at your level, ready to equip, sell, or scrap like any other weapon.
4. **Repeat while you can pay.** No budget refills at midnight — when you're out of keys, the ad rail is still there.

A practical note on timing: because the forged weapon is made **at your current level**, opening caches right after a level-up gets you a weapon at the new level; opening them just before gets you one at the old. Keys keep — there is no penalty for holding them for a level that matters.

## The reveal

The opening itself is a moment: the cache sits at the base of a pillar of light in the drop's rarity color, and **the item rises out of it** — as the beam ignites, the crate itself opens: its lid swings back and the light pours out of the chest, the one frame the whole moment catches fire from. The open crate is just packaging, though, and fades as the item climbs. The crate you see is the game's own cache, painted at full quality — deep navy panels, brass fittings, hairline cracks with gold light inside, and the hex medallion on its lid — the same crate as the app icon, on the lane, in the decrypting overlay, and at the beam's base. Under the risen item, a stat deck lands in stages: the item's name and kind, its headline number big (damage for a weapon, shield HP for a shield), its supporting numbers beside it, then every affix with its percentage picked out, and finally its **roll quality** — the same 0–100 quality the rest of the game shows, so the reveal never flatters a weak roll. A legendary weapon also shows its named effect up top and its flavor line last. The light scales with rarity — a wider, brighter corona, longer hold — and a legendary dims the world behind it. On this one stage the light is drawn as light itself: the risen item hangs in a layered corona, white-hot at its heart and falling off through gold to a warm amber wash, with dozens of fine rays radiating through it, a slim feathered beam landing in a soft bloom of light on the ground, gold sparks bursting where the beam meets the ground as it ignites, and warm embers rising through the column while the item climbs. Even the CACHE DECRYPTED header stays crisp — the beam's light is notched down behind it over a soft shadow, so the words never wash out mid-reveal. The timings are the same as ever; only the light's finish changed. The shockwave that crowns a legendary keeps its stepped ring, exactly as before. None of this changes what you got: the item was forged and in your inventory before the reveal played, and tapping (after your first-ever reveal) skips straight to the finished deck. When the rise finishes, the reveal stays on that same page — no second card pops up. The item's complete stat deck lands below the animation: every number the inspect sheet shows (DPS, crit, modifiers, roll quality), every affix spelled out in words rather than counted, a legendary's effect named *and* described, together with the item's Equip / Lock / Salvage actions and the Open Another and Collect buttons. The stage then settles down to its header, so that deck is presented right under CACHE DECRYPTED — the item, its numbers, and its actions are in front of you the moment the reveal ends. Under reduced motion the decrypting crate waits still instead of shaking, and the reveal's light stays inside the screen's edges at every width.

## What caches never do

- Never sell or forge a legendary effect (above).
- Never appear on the play screen — the ad option exists only here, on the cache surface.
- Never block progress: everything a cache gives can be matched or beaten by gear earned in play.
- Never expire your keys: keys are yours until spent.
- Never leave you hanging: an opening always finishes — if the connection stalls mid-open, the decrypt ends with an error you can retry instead of shaking forever.

## Caches vs. drops, in one paragraph

Roaming, [[Bosses]], and [[Endless Mode]] drop gear because you played — including the legendaries with named effects that define builds. Caches forge level-matched weapons at published odds, as the game's one optional monetization lane: pay a key you earned, or watch an ad — as often as you like, with no daily budget standing in the way. If you never open a cache, you are missing convenience and fun — never power that play cannot earn.

---

_Source of truth: `src/content/cacheLane.ts`, `src/content/lootResolver.ts`, `src/content/loginStreak.ts`, `src/content/leaderboards.ts`, `src/content/contracts.ts`, `src/content/slots.ts`, `src/screens/ChestScreen.tsx` (cache opening). Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
