# Progression

CyberCache is a **long-term game**. Levels, skills, Cache Rank, and mastery are four separate ladders, each earned a different way — and none of them can be rushed by a single big session.

## Levels and XP

The XP curve totals **12,480,235 XP to reach level 100**. Early levels come fast; the curve steepens through the boss ladder and compounds hard in the prestige tail.

The pacing figures below are **modeled, not guaranteed** — they come from the game's own tuning model for a regular player roaming about six hours a day. Your mileage will vary with your areas, gear, and how much of your play is in higher-XP activities:

| Milestone | Modeled time (regular play) |
| --- | --- |
| Level 25 | ~2–3 weeks (modeled at ~17 days) |
| Level 45 | ~6–8 weeks (modeled at ~51 days) |
| Level 100 | ~24 months |

XP comes from roaming, enemy defeats, boss attempts and victories, salvaging, and completed crafts — the activities themselves, so every occupation levels your hunter.

Your progress is glanceable without opening your profile: Home's **Now** feed carries your level progress alongside your current activity, boss progress, and best weapon (see [[The Board]]).

## Skill points and the four trees

Your skill-point budget is **your level − 1**: a level 1 hunter has no points, and every level after that earns exactly one. Points are spent across four trees:

- **Gunslinger** — weapon damage, crits, attack speed, boss damage
- **Demolition** — ordnance, explosives, armor break, stagger
- **Scavenger** — drops, scrap, offline earnings, market fees — and the **King of Scrap** keystone, which adds **+4 hours** to your offline cap
- **Fixer** — crafting speed and quality, repair speed and efficiency, vehicle yield

Each tree also carries a signature [[Actions and Occupations|action skill]]. Because points arrive one per level and the trees are deep, a build is a commitment, not a checklist you complete.

**Spending a point:** tap any node to open its brief. The brief's **Spend** button is always there — when a point can't be spent yet, the button stays disabled and the brief says why in plain terms: no points banked (earn one per level), a prerequisite node to buy first, or the node already maxed.

**Respec:** you can retrain at any time, refunding all spent points, for **100 credits per spent point**. Retraining a heavily invested build is expensive by design — plan the big spends.

## Offline earnings

While you're away, your hunter keeps earning up to a cap that is **earned by level**:

| Your level | Offline cap |
| --- | --- |
| 1–19 | 2 hours |
| 20–39 | 4 hours |
| 40–59 | 6 hours |
| 60–79 | 8 hours |
| 80+ | 12 hours |

Bonuses add on top — the Scavenger keystone's +4 hours is the big one — but two rules bind everything:

- The **absolute ceiling is 24 hours**. No combination of tiers and bonuses can ever settle more than a day away.
- You can set your **own limiter lower** in Settings. The limiter can only reduce your earned cap, never raise it.

When you return, everything that settled is summarised in the while-you-were-away recap on [[The Board]].

## Your Lifetime Record

Your Profile opens with your identity and the **Trophy Shelf** in one panel: your best weapons, ranked by the server and shown as the actual items, alongside your best endless depth, Cache Rank standing, and collection progress (the Collections box is a door to the full shelf). Under it, the **Now** feed keeps your hunter's present tense in one place — what you're doing right now and where, your level progress, boss defeats, your strongest weapon, bench jobs, and your **Killed By** record of recent deaths.

Your Profile carries a **Lifetime Record** under the Trophy Shelf: the all-time, server-proven account of your hunter — roaming kills by area, weapon type, and element; boss attempts and victories; salvage and legendary cores; crafting, repair, dispatch, and market history. Every figure is folded from the game's own server records; nothing is estimated.

Three figures carry their history on their face:

- **Lifetime deaths** counts every death the server has recorded — the full record, reaching back to when deaths first became server-recorded facts.
- **Credits earned / credits spent** count every credit change since the count began (the record's start is shown on the panel). Credit movements before that were never recorded flow-by-flow, so the totals honestly start there rather than pretending to reach further back.
- **Kills by element** accrue from the current record forward: earlier kills were recorded by weapon type only, so they carry no element attribution.

## Cache Rank

Cache Rank lives on the **Hunter tab**, on its own rail stop — the
same rail carries Research and the Skill Trees (mastery rides with
the trees), so every ladder in this chapter sits one tap from your
profile and Trophy Shelf.

Cache Rank is the permanent-bonus ladder that sits on top of levels. Its rules are strict:

- **Tokens come from levels only** — one per level gained, plus a bonus bundle at levels 10, 25, 50, 75, and 100. Nothing else in the game grants them: no challenges, no checklists, no purchases.
- Across a full climb to level 100 you earn **174 tokens** in total.
- Tokens are spent on **7 tracks, each capped at 10 ranks**: credits earned, XP earned, scrap earned, damage, max HP, cache quality, and market proceeds. Each rank is small — +1% credits, XP, scrap, or max HP; +0.5% damage or market proceeds; +2% cache quality — so a maxed track is meaningful over years of play without ever defining a build.
- Maxing one track costs 30 tokens; maxing all seven would cost 210 — more than the 174 a full climb earns. **Choices are permanent and matter.**
- There is **no respec** for Cache Rank. That is deliberate: the bonuses are small and broad, and level-bound tokens cannot be farmed by re-spending.

Cache Rank is a separate currency from skill points — spending tokens never touches your level − 1 skill budget, and retraining your skills never touches Cache Rank.

## Mastery

Mastery is XP earned **per activity track** by actually doing the work: roaming in an area feeds that area's location mastery, fighting with a weapon type feeds its weapon mastery, crafting feeds the crafting tracks (such as refining and gear), extraction feeds its gathering track, repair work feeds the services track, and completing [[Crafting|Research]] courses feeds the **research scholarship** track.

Mastery is not decorative. Mastery levels feed real mechanics — crafting mastery widens the quality bounds of what you make, extraction mastery widens gathering yield, and some advanced recipes require a minimum mastery before they unlock at all. Where levels measure how far you've come overall, mastery measures what you've actually spent your time doing.

---

_Source of truth: `src/content/simulation.ts`, `src/content/xpResolver.ts`, `src/content/offlineCap.ts`, `src/content/cacheRank.ts`, `src/constants/skillTrees.ts`, `db/migrations/0004_write_apis.sql`, `db/migrations/0051_profile_lifetime_counters.sql`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
