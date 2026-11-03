# Contracts

The Contracts Board posts rotating work orders — kills, boss victories, crafts, sales, extractions, and more — that progress from **what you actually do while you play**. Contracts are never an action and never occupy your [[Actions and Occupations|action slot]]; they ride along on your normal play and pay when you claim them.

They are also **not achievements**. Nothing permanent is gated behind them — no ranks, no lifetime tiers, no badges — and your [[Progression|Cache Rank]] never reads contract history. Contracts expire, recur, and exist to redirect play toward corners of the game you might otherwise skip.

## The two sets

- **The daily set is 3 contracts**, drawn fresh each UTC day. It is **global per level band**: every player in your band sees the same three contracts that day — the board is a shared bulletin. Claim by **00:00 UTC**.
- **The weekly set is 5 contracts**, drawn each ISO week and **seeded per player**, so your week's work differs from every other hunter's. Claim by **Monday 00:00 UTC**.
- A set never holds more than **2 contracts from any one family**.
- **Issued is frozen.** A contract's target, reward, and band are locked in at issuance. Levelling up mid-period never re-bands a set you already hold, and no later change reprices an issued contract.

Progress is read from the server's own records of your play — kills counted, crafts completed, sales settled — never from anything the client reports.

## Level bands

Your band sets both the size of the targets and the credit reward per contract:

| Band | Levels | Targets | Daily contract pays | Weekly contract pays |
|---|---|---|---|---|
| B1 | 1–9 | ×0.5 | 120 cr | 500 cr |
| B2 | 10–24 | ×1 | 220 cr | 900 cr |
| B3 | 25–49 | ×1.5 | 350 cr | 1,400 cr |
| B4 | 50–74 | ×2 | 500 cr | 2,000 cr |
| B5 | 75+ | ×2.5 | 650 cr | 2,600 cr |

Targets below are the **base targets** (what B2 asks); other bands multiply them by the band's target factor, rounded. The Gauntlet is the one exception — its depths are set per band, listed under the table.

## The work

| Contract | Family | Asks for | Daily | Weekly | From |
|---|---|---|---|---|---|
| Field Work | Combat | Roaming kills | 200 | 1,200 | B1 |
| Elite Hunt | Combat | Named elites downed | 1 | 4 | B1 |
| Surge Watch | Combat | Roaming events triggered | — | 100 | B1 |
| Long Haul | Combat | Roaming XP earned | 1,000 | 8,000 | B1 |
| Gauntlet | Combat | Endless depth reached in one run | per band | per band | B1 |
| Gauntlet Regular | Combat | Endless runs completed | — | 3 | B1 |
| Boss Contract | Boss | Bosses defeated | 1 | 3 | B1 |
| Named Bounty | Boss | Defeat the one boss the card names | — | 1 | B3 |
| Production Order | Craft | Craft units completed | 4 | 24 | B1 |
| Fine Work | Craft | Consumables crafted | 4 | — | B1 |
| Refinery Shift | Craft | Refine units completed | — | 8 | B1 |
| Perfectionist | Craft | Reforges completed | — | 3 | B3 |
| Service Record | Service | Condition points restored by repair work | — | 150 | B2 |
| Shopfront | Market | Sales completed as the seller | 1 | 4 | B2 |
| Open for Business | Market | Listings posted | 2 | — | B1 |
| Supply Run | Market | Purchases from the NPC vendor | 3 | — | B1 |
| Breakdown | Meta | Items salvaged | 6 | 36 | B1 |
| Cache Work | Meta | Caches opened | 1 | 3 | B1 |
| Field Kit | Meta | Consumables used | 5 | — | B1 |
| Archivist | Meta | New discoveries recorded | — | 3 | B1 |
| Gathering Order | Meta | Materials and essences gathered by extraction | 40 | 240 | B1 |

**Gauntlet depths by band** — daily: B1 2 · B2 3 · B3 5 · B4 4 · B5 3; weekly: B1 3 · B2 5 · B3 8 · B4 6 · B5 5. (The ladder is a fixed course, so the ask follows what a regular build honestly reaches at each band — see [[Endless Mode]].)

## Rewards — and what contracts never pay

- **Credits**, per contract, by band (the table above).
- **Cache-key fragment parts.** Combat- and boss-family dailies — and Breakdown — pay **1 fragment part** on top of the credits. **Every weekly contract pays 3 fragment parts.**
- **Full-set bonuses.** Clear all 3 dailies: **+2 fragment parts**. Clear all 5 weeklies: **1 cache key plus one weekly contract's credits**. Cache keys live only in that weekly bonus — one key per week per player is the maximum this whole system can mint (see [[Caches]]).
- **Contracts never pay legendary cores.** Salvaging is the only core mint in the game — no contract, bonus, or reroll changes that. Contracts also never pay legendaries, gear, or XP: they redirect play, they are not a fourth occupation.

**Claiming is the reward beat.** Completing a contract does not pay it — *claiming* does, and the card states its claim-by deadline from the moment it is issued. An unclaimed contract whose window closes **expires unpaid**. Guests can view the board; claiming requires an account.

## Rerolls

Don't like a contract? **Each set allows one free reroll.** Further rerolls cost scrap — **100 scrap** in the daily set, **400 scrap** in the weekly set — and the scrap is destroyed. A reroll draws a fresh contract with a fresh baseline: work toward the old one does not transfer. A completed-but-unclaimed contract **cannot be rerolled** — claim it, or let it expire.

---

_Source of truth: `src/content/contracts.ts`, `src/server/routes/contracts.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
