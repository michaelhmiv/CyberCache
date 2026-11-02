# The Board

The Board is your home screen — the first thing you see, and the screen every session passes through. It is arranged so the things you check most are visible on the first paint, without scrolling. From top to bottom:

## The resource bar

Six chips, always on display:

| Chip | What it shows |
| --- | --- |
| **Credits** | Your spendable credits |
| **Scrap** | Salvage material for crafting, repairs, and reforging |
| **Keys** | Cache keys — with your key fragments riding alongside as progress toward the next key (shown as fragments out of 5) |
| **Cores** | Legendary cores, earned by salvaging Legendaries — see [[Collections]] |
| **Loot** | How many items you hold, with your equipped count alongside (equipped out of 7 gear slots) |
| **Level** | Your hunter level |

The bar is display-only. There are no ads on this screen, ever.

## The top bar: level, streak, contracts

Directly under the resource bar sit three controls:

- **The level button** takes most of the row: an **LV badge** with your level and a live **XP progress bar** showing your XP into the level, how much the level needs, and how much remains. Tapping it opens the level sheet with the full breakdown — and the while-you-were-away recap, below.
- **The streak flame** shows your current login-streak day. Tapping it opens the streak panel with the 7-day ladder. When today's check-in has just paid out, the flame pulses with a **NEW** badge. You never need to tap it to check in: loading the Board records the day by itself. See [[Leaderboards and Streaks]].
- **The contracts icon** (the clipboard, labelled Orders) opens the contracts panel. When contracts are ready to claim, it pulses and carries a badge with the **claimable count** — visible without opening anything. Guests see a lock badge instead: guests can read the board, but claiming rewards requires signing in. See [[Getting Started]].

Claimable state is designed to be glanceable: if something is waiting for you, the top bar says so before you scroll anywhere.

## The area chip and the stage

Under the top bar is your **current area chip** — tap it to open the area picker and change where roaming happens. If you are enrolled in a [[Progression|Research]] course, its chip sits beside the area chip, because research runs alongside your action rather than replacing it.

Below that is **the stage**: your hunter, rendered with the weapon you actually have equipped, your current activity, and the two doors that matter most in the moment — start (or manage) your roam, and prep or choose a boss.

## Hunter Totals and consumables

The **Hunter Totals** panel summarises your hunter's combat numbers — health, damage, and the rest — computed from your real gear, skills, and buffs. Its **Sources** button opens a full breakdown of where every number comes from.

The **Consumables** panel shows your active consumable slots. Tap a slot to open the ledger and manage what is loaded.

## The Action Board

The Action Board is the Board's directory — status first, navigation second:

- **Roaming** — whether your run is live, and the door to the Action workspace where roaming is started and managed
- **Loadout Bench** — how many of your 7 gear slots are filled; equip, compare, and tune gear
- **Crack Cache** — your key count and the door to [[Caches]]
- **Skill Trees** — how many unspent points are ready; see [[Progression]]
- **Workshop** — how many bench jobs are open; see [[Crafting]]
- **Dispatch** — the dispatch contract board; see [[Actions and Occupations]]
- **Market** — the trade hub; see [[The Market]]
- **Settings** — preferences and account tools

Underneath, **Hunter Notes** recaps your current area — its manufacturer influence, danger, and loot bias — and your equipped weapon.

## While you were away

Your hunter keeps working while you're gone, up to your offline cap (see [[Progression]]). When you return, the earnings settle automatically and a **"While You Were Away" recap** waits inside the **level sheet** — tap the level button to read it. While an unread recap is waiting, the level button pulses and carries an **AWAY** badge.

One exception: if you were away **less than five minutes**, the recap never presents itself. The settlement still lands in full — it simply stays tucked inside the level sheet for you to read if you want it, instead of interrupting a quick check-in.

The recap is also where the game asks about **notifications**: a single primer row inside the recap is the one place the app will ever offer to turn push notifications on — at the moment you can see exactly what a notification would have told you.

---

_Source of truth: `src/screens/DashboardScreen.tsx`, `src/components/dashboard/`, `src/components/layout/ResourceBar.tsx`, `src/components/dashboard/DashboardTopBar.tsx`, `src/components/activity/OfflineRecap.tsx`, `src/store/slices/offlineRecapSlice.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
