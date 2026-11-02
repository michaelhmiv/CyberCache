# The Board

The Board is your home screen — the first thing you see, and the screen every session passes through. It lives on the **Home** tab: the app has four tabs — **Home, Gear, Market, Hunter** — and Home merges what used to be separate Board and Action tabs into one screen, with the action stage (below) at its centre. It is arranged so the things you check most are visible on the first paint, without scrolling. From top to bottom:

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

The bar is display-only. There are no ads on this screen, ever. At the bar's right edge sits a small **gear icon** — the shortcut to Settings (whose home is Hunter → Account).

## The top bar: level, streak, contracts, weekly

Directly under the resource bar sit the claim chips:

- **The level button** takes most of the row: an **LV badge** with your level and a live **XP progress bar** showing your XP into the level, how much the level needs, and how much remains. Tapping it opens the level sheet with the full breakdown — unless a while-you-were-away recap exists, in which case the same tap opens the **Return Sheet** (below) and the level sheet is one tap further, from the Return Sheet's footer.
- **The streak flame** shows your current login-streak day. Tapping it opens the streak panel with the 7-day ladder. When today's check-in has just paid out, the flame pulses with a **NEW** badge. You never need to tap it to check in: loading Home records the day by itself. See [[Leaderboards and Streaks]].
- **The contracts icon** (the clipboard, labelled Orders) opens the contracts panel. When contracts are ready to claim, it pulses and carries a badge with the **claimable count** — visible without opening anything. Guests see a lock badge instead: guests can read the board, but claiming rewards requires signing in. See [[Getting Started]].
- **The weekly chip** (a crate, labelled Weekly) appears only while a weekly **Parts Crate** or **Signature Order** is claimable at the Rep Desk, and carries the claimable count. Tapping it opens the weekly claim sheet, where the offers can be claimed right there. See [[Manufacturer Standing]].

Claimable state is designed to be glanceable: if something is waiting for you, the top bar says so before you scroll anywhere.

## The stage

The centre of Home is **the stage**: your hunter, rendered with the weapon you actually have equipped, your current activity, and the two doors that matter most in the moment — start (or manage) your roam, and prep or choose a boss. This is the Action workspace, living on Home itself: pick an area, tap Start Roam, and the rundown begins on the same screen.

The weapon in your hunter's hands is always the exact weapon you have equipped — its type, make, and rolled parts — held at the grip, with nothing else underneath it. The same hunter, with the same rule, steps into the boss arena: what you see on the Board is what you fight with. Equip nothing and the hands are empty.

At the stage's top edge sits your **current area chip** — tap it to open the area picker and change where roaming happens. If you are enrolled in a [[Progression|Research]] course, its chip sits beside the area chip, because research runs alongside your action rather than replacing it.

## The mode rail

Under the stage runs the **mode rail** — six stops, one tap each: **Area · Roam · Boss · Endless · Extract · Craft**. The lit stop is the mode whose workspace is open below. Endless, Extraction, and Crafting are full stops on the rail; the **Switch Action** sheet (under the rail) still offers every mode it always did, Salvage included — the rail is the fast door, the sheet is the complete one.

Below the rail sits the **lit workspace** for the current mode, then the **consumable belt**: your active consumable slots, above the fold. Tap a slot to open the ledger and manage what is loaded.

## The deck

Everything below the fold is the **deck**, in a fixed order:

1. **Launchers** — the directory doors: **Dispatch** and **Crack Cache** first, then **Slots** (the card lands you right on the wheel at the Market rail stop), then the **Loadout Bench** shortcut — which only appears while your loadout is incomplete (fewer than 7 of 7 gear slots filled).
2. **Weekly claimables** — the weekly Parts Crate and Signature Order offers, with their claim buttons. This panel only exists while something is claimable; an empty week leaves no empty box behind.
3. **Now** — one merged feed: your latest activity plus the world pulse (current activity, level progress, boss progress, best weapon, bench state).
4. **Hunter Totals** — your hunter's combat numbers — health, damage, and the rest — computed from your real gear, skills, and buffs. Its **Sources** button opens a full breakdown of where every number comes from.

## While you were away

Your hunter keeps working while you're gone, up to your offline cap (see [[Progression]]). When you return, the earnings settle automatically and the **Return Sheet** waits behind the level button — tap it to read the recap. While an unread recap is waiting, the level button pulses and carries an **AWAY** badge.

The Return Sheet presents the absence in the loot language: a **totals row** with the headline earnings, the absence's **best drop as a poster card**, the itemised rewards below, and one **Collect** button. The primer about **notifications** rides the sheet's footer — a single row inside the recap is the one place the app will ever offer to turn push notifications on, at the moment you can see exactly what a notification would have told you. The level sheet itself now holds level specifics only; while a recap exists it carries a door back to the Return Sheet.

One exception: if you were away **less than five minutes**, the recap never presents itself. The settlement still lands in full — it simply stays tucked behind the level button for you to read if you want it, instead of interrupting a quick check-in.

---

_Source of truth: `src/screens/HomeScreen.tsx`, `src/components/dashboard/`, `src/components/layout/ResourceBar.tsx`, `src/components/dashboard/DashboardTopBar.tsx`, `src/components/activity/OfflineRecap.tsx`, `src/store/slices/offlineRecapSlice.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
