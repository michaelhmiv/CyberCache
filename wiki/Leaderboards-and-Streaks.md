# Leaderboards & Streaks

Two rhythms keep CyberCache ticking between sessions: **weekly leaderboard races** that settle every week, and a **daily login streak** that rewards simply showing up. Both surface in plain sight — the streak as the flame in [[The Board]]'s top bar, and the standings behind the **Standings door on the Hunter tab**. The door wears a live badge: a pill when last week's race rewards have landed, a warning when the current week is about to close, and your active drop-luck bonus while one runs. Race rewards **pay out automatically** — the pill is a notice that earnings arrived, not a claim prompt, and it clears once you've viewed the earnings panel it points to.

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

Before the first rankings settle, the standings show an empty board: rankings fill in from hunters' play, so the board populates after the next snapshot once anyone has scored.

### Visiting another hunter

Every name on the standings — weekly races and the all-time boards alike — is a door. Tap a hunter and a pop-up introduces them: the look they wear, their Trophy Shelf (hand-pinned trophies marked), their best depth, Cache Rank, and collection progress, and their headline stats. **View Full Profile** opens the whole public record: the hunter at stage size in the look they wear, the full shelf, and every public stat — level, kills, boss tiers, mastery, collection. Profiles are read-only and open to everyone, guests included: a hunter's public record is the brag surface — what they pinned, what they wear, and what the game itself keeps score of. Nothing private travels with it: no balances beyond net worth, no account details, no history folds.

### Settlement and rewards

Settlement rides the game's daily heartbeat: once a week has closed, it settles exactly once and rewards are paid from the settled standings.

**There is nothing to claim.** Paid rewards land in your account at settlement — cache keys are credited and the drop-luck buff starts on its own. Your record lives in the **Your Weekly Earnings** panel at the very top of the Standings page: per settled week it lists each race, your finish, and exactly what it paid. (Don't confuse these with the Rep Desk's weekly Parts Crate and Signature Orders on [[The Board]] — those are separate offers you buy with credits, and those ones really do have a Claim button.)

| Finish | Cache keys | Drop-luck buff |
| --- | --- | --- |
| 1st | 3 keys | +25% for 48 hours |
| 2nd | 2 keys | +20% for 36 hours |
| 3rd | 1 key | +15% for 24 hours |
| 4th–10th | — | +10% for 12 hours |

The **drop-luck buff** is a timed bonus that starts at settlement. While it is active:

- Roaming drops roll Epic and Legendary rarity weights higher,
- Boss fights get the same multiplier on their dedicated-drop chance, and
- [[Endless Mode]] milestone drops roll their Epic and Legendary weights higher too.

Buffs **never stack** — if you hold more than one, only the strongest active one applies. (One deliberate exception: Scavenger Cache Surge rolls inside an Endless run are a separate, player-spent benefit and do not take the buff.)

## Daily login streak

Open the game on a UTC day and the day is recorded — automatically, the moment [[The Board]] loads. There is no claim button to forget. Come back the next UTC day to extend the streak; **miss a day and the streak restarts at Day 1**, though your longest streak is kept on your profile forever. Guests earn streak rewards on exactly the same terms as signed-in players.

Rewards follow a **7-day ladder**. At tier 1 it pays:

| Day | Reward |
| --- | --- |
| 1 | 100 credits |
| 2 | 150 credits |
| 3 | 200 credits |
| 4 | 250 credits |
| 5 | 300 credits |
| 6 | 400 credits |
| 7 | 500 credits · **1 cache key** |

A full tier-1 week totals 1,900 credits and 1 cache key. (The ladder once paid key fragments on days 3–7 too; fragments were retired as a currency, and every day still pays its credits.)

### Tiers: the ladder repeats, richer

Finishing day 7 doesn't end the streak — the next 7 days repeat the ladder at the **next tier**. Each tier step adds half again to the credit amounts:

- Tier 1 pays ×1, tier 2 ×1.5, tier 3 ×2, tier 4 ×2.5, and **tier 5 caps the ladder at ×3**. A streak longer than 35 days keeps cycling at tier 5.
- The **cache key never scales**: every completed cycle pays exactly one key, at every tier.

The flame icon in the top bar shows your current streak day at a glance and opens the streak sheet when tapped. When a check-in has just paid, the flame pulses with a NEW badge — that pulse is an announcement, not a claim: the reward is already in your account. The sheet tags every reward **Banked**, and you can watch your credits tick up to the new balance in the top bar. Opening the sheet and tapping **Back to the hunt** acknowledges the grant and clears the badge; a day that has already banked shows no pulse at all. The sheet prints the full ladder and what tomorrow pays, so you can always see what tomorrow is worth before you decide to come back for it — and a new streak day starts at 00:00 UTC.

---

_Source of truth: `src/content/leaderboards.ts`, `src/content/loginStreak.ts`, `src/server/leaderboards/`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
