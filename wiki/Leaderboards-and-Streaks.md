# Leaderboards & Streaks

Two rhythms keep CyberCache ticking between sessions: **weekly leaderboard races** that settle every week, and a **daily login streak** that rewards simply showing up. Both surface in plain sight — the streak as the flame in [[The Board]]'s top bar, and the standings behind the **Standings door on the Hunter tab**. The door wears a live badge: a pill when last week's rewards are waiting for you, a warning when the current week is about to close, and your active drop-luck bonus while one runs.

## Weekly leaderboards

Weeks run on ISO time: a week opens **Monday 00:00 UTC** and closes the next Monday. There are **8 race definitions**, and **4 of them run each week**, chosen by a seeded rotation — the same four for every player worldwide that week, so the slate is fair and predictable in hindsight, never hand-picked.

| Race | What counts | Minimum to qualify for rewards |
| --- | --- | --- |
| Roaming Kills | Hunter kills confirmed by roaming | 25 kills |
| Boss Victories | Verified boss kills | 1 victory |
| Elite Kills | Elite enemies downed while roaming | 1 elite |
| Caches Opened | Caches opened | 1 cache |
| Items Salvaged | Items recycled through salvage | 5 items |
| Endless Depth | Deepest depth in an [[Endless Mode]] run that **ended** that week | 1 depth |
| Market Sales | Your [[The Market]] listings that sold | 1 sale |
| Extraction Passes | Extraction passes finalised | 1 pass |

Standings list everyone with a score above zero, but **rewards only pay at or above the qualifying minimum** — a quiet week doesn't hand a champion's prize to a token effort. Note the Endless rule: only runs that ended inside the week count. An unfinished run proves nothing.

### Settlement and rewards

Settlement rides the game's daily heartbeat: once a week has closed, it settles exactly once and rewards are paid from the settled standings.

| Finish | Cache keys | Drop-luck buff |
| --- | --- | --- |
| 1st | 3 keys | +25% for 48 hours |
| 2nd | 2 keys | +20% for 36 hours |
| 3rd | 1 key | +15% for 24 hours |
| 4th–10th | — | +10% for 12 hours |

The **drop-luck buff** is a timed bonus that starts at settlement. While it is active:

- Roaming drops roll Epic and Legendary rarity weights higher, and
- Boss fights get the same multiplier on their dedicated-drop chance.

Buffs **never stack** — if you hold more than one, only the strongest active one applies. Endless drops don't use the buff at all; it is a roaming-and-bosses reward.

## Daily login streak

Open the game on a UTC day and the day is recorded — automatically, the moment [[The Board]] loads. There is no claim button to forget. Come back the next UTC day to extend the streak; **miss a day and the streak restarts at Day 1**, though your longest streak is kept on your profile forever. Guests earn streak rewards on exactly the same terms as signed-in players.

Rewards follow a **7-day ladder**. At tier 1 it pays:

| Day | Reward |
| --- | --- |
| 1 | 100 credits |
| 2 | 150 credits |
| 3 | 200 credits · 1 key fragment |
| 4 | 250 credits · 1 key fragment |
| 5 | 300 credits · 2 key fragments |
| 6 | 400 credits · 2 key fragments |
| 7 | 500 credits · 3 key fragments · **1 cache key** |

A full tier-1 week totals 1,900 credits, 9 key fragments, and 1 cache key.

### Tiers: the ladder repeats, richer

Finishing day 7 doesn't end the streak — the next 7 days repeat the ladder at the **next tier**. Each tier step adds half again to the credit and fragment amounts:

- Tier 1 pays ×1, tier 2 ×1.5, tier 3 ×2, tier 4 ×2.5, and **tier 5 caps the ladder at ×3**. A streak longer than 35 days keeps cycling at tier 5.
- The **cache key never scales**: every completed cycle pays exactly one key, at every tier.

The flame icon in the Board's top bar shows your current streak day at a glance, pulses with a NEW badge when a check-in has just paid, and opens the full ladder panel when tapped — so you can always see what tomorrow is worth before you decide to come back for it.

---

_Source of truth: `src/content/leaderboards.ts`, `src/content/loginStreak.ts`, `src/server/leaderboards/`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
