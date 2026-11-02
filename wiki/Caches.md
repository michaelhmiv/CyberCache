# Caches

Data Caches are the game's box-opening lane: spend an opening, get a weapon forged for you on the spot at your level. Caches are deliberately kept distinct from loot drops — drops are earned in play and are never sold; caches are the optional, capped lane beside them, and the ads in this game live here and nowhere else. There are no ads on the play screen, ever.

## The daily budget

Everything about caches runs on **one shared daily budget: 10 openings per day** by default, resetting at **00:00 UTC**. The free opening counts against it. So do openings paid with keys and openings paid with ads. There is no way to buy an eleventh opening — a key does not buy past the cap, and neither does an ad.

- **Your first opening each day is free.** No key, no ad. The game resolves it as free even if you tap the key or ad option — the free slot cannot be wasted or accidentally spent.
- **Openings 2 through 10 are your choice, per opening:** 1 cache key, **or** one rewarded ad.
- When the budget is gone, it is gone until the reset — the cache screen shows your openings used, what remains, and when the budget refills.

## What a cache gives you

Each opening forges **one weapon at your current level**. The rarity is rolled from the cache table, and only from it:

- **Rare — 60%**
- **Epic — 32%**
- **Legendary — 8%**

There are no Common or Uncommon cache weapons. A cache Legendary is a strong weapon — but a cache-forged weapon **never carries a [[Legendary Effects|legendary effect]]**. Named legendary effects come from boss drops — see [[Legendary Effects]] for how they work. That line is what keeps found legendaries special, and it is not for sale at any price.

Your build can improve the draw itself: Scavenger investment and the Cache Optimizer track raise your cache quality, which bends the rarity draw in your favor.

## Cache keys and fragments

A **cache key** pays for one opening inside the daily budget. Keys are a stock you hold; unspent keys carry over — only the openings are daily.

Keys also assemble from **key fragments: 5 fragments = 1 cache key**, converted automatically as fragments arrive.

Keys and fragments reach you from play, for example:

- **Roaming** — fragments drop as you roam (see [[Actions and Occupations]]).
- **Login streaks** — the day-7 reward of the streak ladder pays a cache key, and earlier days pay fragments (see [[Leaderboards and Streaks]]).
- **Weekly leaderboards** — the top finishers take cache keys: **3 for 1st, 2 for 2nd, 1 for 3rd**.
- **Contracts** — clearing your full weekly contract set pays **1 cache key**; dailies pay fragments instead.
- **[[Slots]]** — the slot machine's key prize is a real cache key. If a key prize lands when it cannot be paid, it converts to **5 fragments** instead — exactly one key's worth, so the prize is never lost.

Every one of those sources feeds the same key stock, and every opening they fund spends from the same daily budget. A key from a leaderboard and a key from fragments are the same key.

Fragments also **trade on [[The Market]]** by quantity. While fragments are listed for sale they sit in escrow and are **exempt from the 5-to-1 conversion** — the conversion only applies to fragments in your balance, so listing 4 fragments and earning a 5th will not mint a key out of the escrow. Cancel the listing and the fragments return to your balance as fragments; the conversion catches up the next time fragments arrive. Fragments you *buy* settle straight into your balance and convert as usual.

## Opening a cache, step by step

1. **Go to the cache screen.** It shows your key stock, your fragment progress toward the next key (for example, 3 / 5), your openings used today out of the daily cap, and whether today's free box is still waiting.
2. **Open.** If the free box is available, the opening is free — whatever you tapped. Otherwise you choose per opening: spend a key, or watch the rewarded ad.
3. **Take the weapon.** The forged weapon lands in your inventory at your level, ready to equip, sell, or scrap like any other weapon.
4. **Repeat while budget lasts.** The screen always shows what remains today and when the budget resets, so there is never a surprise lockout mid-session.

A practical note on timing: because the forged weapon is made **at your current level**, opening caches right after a level-up gets you a weapon at the new level; opening them just before gets you one at the old. Keys keep — there is no penalty for holding them for a level that matters.

## What caches never do

- Never sell or forge a legendary effect (above).
- Never appear on the play screen — the ad option exists only here, on the cache surface.
- Never block progress: everything a cache gives can be matched or beaten by gear earned in play.
- Never expire your keys: openings are daily, keys are yours until spent.

## Caches vs. drops, in one paragraph

Roaming, [[Bosses]], and [[Endless Mode]] drop gear because you played — including the legendaries with named effects that define builds. Caches forge level-matched weapons at published odds, on a capped daily budget, as the game's one optional monetization lane. If you never open a cache past the free daily box, you are missing convenience and a daily bit of fun — never power that play cannot earn.

---

_Source of truth: `src/content/cacheLane.ts`, `src/content/lootResolver.ts`, `src/content/loginStreak.ts`, `src/content/leaderboards.ts`, `src/content/contracts.ts`, `src/content/slots.ts`, `src/screens/ChestScreen.tsx` (cache opening). Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
