# The Board

The Board is your home screen — the first thing you see, and the screen every session passes through. It lives on the **Home** tab: the app has four tabs — **Home, Gear, Market, Hunter** — and Home merges what used to be separate Board and Action tabs into one screen, with the action stage (below) at its centre. It is arranged so the things you check most are visible on the first paint, without scrolling.

[[images/ui/home-stage.png]]

*The Board mid-roam: the stage live with the hunter's HP plate at his feet, the active area's rates in the workspace below, and a tick's payout arriving in the pop-up lane.*

From top to bottom:

## The resource bar

Six chips, always on display:

| Chip | What it shows |
| --- | --- |
| **Credits** | Your spendable credits |
| **Scrap** | Salvage material for crafting, repairs, and reforging |
| **Keys** | Cache keys — the count is the whole story (keys are the only cache currency) |
| **Cores** | Legendary cores, earned by salvaging Legendaries — see [[Collections]] |
| **Loot** | How many items you hold, with your equipped count alongside (equipped out of 7 gear slots) |
| **Level** | Your hunter level |

The bar is display-only. There are no ads on this screen, ever. At the bar's right edge sits a small **gear icon** — the shortcut to Settings (whose home is Hunter → Account).

A counted number never rises silently: when one of these values goes **up**, its digits flash green and pop, with a glow in that resource's own color behind them. A gain that matters gets the full beat (about half a second, the peak held so your eye can catch it); the small drip of roaming earnings gets a shorter, smaller one. Numbers going **down** — your own spending — never flash.

## The top bar: progress, caches, offline, streak, contracts, weekly

Directly under the resource bar sit the progress display, two action buttons, and the claim chips:

- **The XP display** takes most of the row: your level, a live **XP progress bar**, and the real fraction — how much XP you hold into the level against how much the level needs. Tapping it opens the level sheet, which holds level specifics only — and at level 100, the Progression cap, it reads **MAX LEVEL** instead of counting toward a level that does not exist.
- **The cache button** carries a bubble with the count of **cache keys** you hold. Tapping it goes to the **Chest** (below).
- **The offline button** shows the amount your away earnings are holding (below). Tapping it opens the **Return Sheet** — and while a hold waits, that sheet's claim is what pays it.
- **The streak calendar** shows your current login-streak day. Tapping it opens the streak sheet with the 7-day ladder. While today's reward is waiting to be claimed, the calendar pulses with a **CLAIM** badge — the day is recorded but the reward is not yet yours; open the sheet and tap **Claim** to bank it, and your balances in the Strip answer as it lands. The claim itself is a small ceremony: the day plate stamps down onto the sheet, each reward row stamps its **Banked** tag in turn, the cache-key row flares, and the whole beat settles in about a second — it belongs to the tap, plays once for that claim, and opening the sheet beforehand stays silent. Once claimed, the calendar goes quiet — no pulse, no badge. Loading Home records the day by itself, but the reward always waits for your tap — and an unclaimed reward expires when the next streak day starts at 00:00 UTC, though the recorded day still counts toward your streak. See [[Leaderboards and Streaks]].
- **The contracts icon** (the clipboard, labelled Orders) opens the contracts panel. When contracts are ready to claim, it pulses and carries a badge with the **claimable count** — visible without opening anything. Guests see a **GUEST** badge instead — the why prints on the pill itself: guests can read the board, but claiming rewards requires signing in. See [[Getting Started]].
- **The weekly chip** (a crate, labelled Weekly) appears only while a weekly **Parts Crate** or **Signature Order** is claimable at the Rep Desk, and carries the claimable count. Tapping it opens the weekly claim sheet, where the offers can be claimed right there. See [[Manufacturer Standing]].

Under the claim chips sits the **announcement line** — at most one announcement at a time, for earnings that happened somewhere else:

- **Sold** — a listing of yours sold on the player market. The chip names the item and shows the credits you actually received (the price minus the sale fee, plus any proceeds bonus) — the same amount that just pulsed green in the resource bar. Tapping it opens your trade record (Market → Sell → History). If several listings sold, they gather into one chip with the total. Opening your trade history yourself clears the announcement too.
- **Bench ready** — a Workshop job finished while you were elsewhere. Tapping it opens the Workshop. If you are already looking at the Workshop when a job finishes, there is no announcement — you can see it happen.

Announcements stay until you tap them. Sale proceeds announce first when both are waiting.

Claimable state is designed to be glanceable: if something is waiting for you, the top bar says so before you scroll anywhere.

## The mode rail

Directly under the claim chips, above the stage, runs the **mode rail** — five stops, one tap each: **Roam · Boss · Endless · Extract · Craft**. The lit stop is the mode whose workspace is open below. Endless, Extraction, and Crafting are full stops on the rail; the **Switch Action** sheet still offers every mode it always did, Salvage included — the rail is the fast door, the sheet is the complete one. There is no separate Area stop: **Roam is the area door** — tapping it from any other activity starts the roam and opens the area picker on entry, and tapping it while already roaming opens the picker again (pick a new area to move the roam; close it to keep roaming where you are).

The action control floats **on the stage** as one small square button at the top-left corner: while an action is running, **Stop** (the filled-square glyph) sits there; at standby the stage carries no buttons at all. It is icon-only by design; its name lives in its accessible label. There is no separate controls row — the rail is the last thing above the stage. The Switch Action sheet's door rides in the standby and roaming workspace panels under the stage, beside Change Area.

## The stage

Roaming actors now return to their ready stance after recoil or a hit, so repeated shots read as separate exchanges. The enemy still completes its approach, and defeated enemies stay down. Leaving Home, scrolling the stage out of view, or backgrounding the app pauses the unseen animation; returning resumes the retained stage. Your hunt's settlement is independent of this presentation pause. Source breakdowns include Cache Rank contributions, extra queue/listing slots print as counts, and open consumable countdowns continue updating until expiry. While you roam the day's hot area, a small flame flickers beside the area's name in the Active Area panel under the stage — the hot area's mark riding the name your eye already reads for where you are — and stills to a steady flame under reduced motion.

The centre of Home is **the stage**: your hunter, rendered with the weapon you actually have equipped, with a **gear count plate** at the top-right corner. Your equipped vehicle stands parked at the stage's left edge, half behind your hunter — the one you have equipped right now: equip or swap it in the Garage and the parked vehicle changes with it, its rolled fittings drawn whole inside its own frame. The stage prints no words of its own — no banner, no activity name, no status ribbon: what just happened — drops, finds, kills — reads in the feed cards under the stage, and the doors that matter in the moment live in the workspace under the belt: in standby that is the Roam panel (the area's rates, one **Start Roam** bar, and a **Change Area** row beneath it, with the Switch Action door beside it); while a boss encounter is open, the challenged boss stands on the stage itself, and the encounter panel underneath carries the prep, the launch, and Change Boss — when the attempt launches, the fight plays out on the stage above, and the panel carries the result. The Chaos Chamber holds the stage the same way for a run's whole length: the next encounter stands in its own arena between depths, each depth's fight plays out on the stage above, and the Chamber panel underneath carries the run's depth, escrow, banking, and result. Work has its own picture: while Craft, Salvage, or Workshop Service holds the slot, the hunter works the stage's bench unarmed — striking, pressing, and fitting as the job demands — with the job's own piece sitting on the bench under his hands (a rolled gear piece, which does not exist until it lands, waits as an empty frame in its rolled rarity's colour), and a finished unit rises off the bench as itself as he celebrates — a settled recycle sends its scrap rising off the crusher the same way. Extraction works its site in the same spirit: while it holds the slot, the hunter works the claim's sift rig in a steady dig-and-sift rhythm, and a landed pass sends its finds rising off the rig — each material and essence pictured at the count it settled. A market listing holds the stage its own way: while one of your listings runs, the hunter stands at his vendor stall tending it — weapon slung, hands on the goods in a slow handling rhythm — until the listing settles or you pull it. This is the Action workspace, living on Home itself: pick an area, tap Start Roam, and the rundown begins on the same screen.

The country behind the stage is each area's full master painting, standing whole behind the fight — the Dustwaste sunset over its dunes, Redline's red sun, Ironwood under its moon, BlastForge's yards, PrismaTek's crystal hills, ThrowTech's storm towers, HelixWorks' skyline, camp under its starfield. The life on top of the paintings still moves on its own clocks: dust devils turning over the Dustwaste, aurora moving over the reactor dome, fireflies in the Bastion's tree line, embers rising at camp. And the hunter covers the ground himself: each new encounter arrives with an advance — he walks, legs striding, and settles into his stance as the enemy comes in to meet him. The enemy closes its own distance too: it enters from well off its mark, body moving with its stride as it comes, and settles in close — fights frame tight, at the range the weapons describe. At standby the stage is camp — your hunter at the fire, the camp's crates and supplies where they are kept, smoke rising and embers drifting while nothing is running.

Attached to the stage's foot — below the art, never over it — is the **hero rundown**: your hero stats in two stacked rows, live. The damage row: **DPS** (damage per second), **Dmg/tick** (standing roaming damage across the 3-second tick, before target defense and temporary effects), **Crit %** and **Crit ×** (the crit chance your boss fights settle with — your primary weapon's crit plus the crit your skill nodes grant — and that weapon's own crit multiplier, as their own numbers). The survival row: **HP** (current/max, with its bar), **Shield** (your equipped shield's capacity), **Mit** (its mitigation rate), and **Shield Break** (your stacked shield-breaking power). Swap gear, burn fuel, finish a buff and the numbers move. Every hero prints its **effective** value; where a stat has a base and your gear, skills, or vehicle lifted it above that base, the gain prints beside it smaller and green **as a percentage of the base** (base 100 DPS reading 150 prints **150 +50%**) — the same percentage its source breakdown prints — and where something is costing you, the loss prints in red. Stats with no base to measure against (crit, shield, mitigation, shield break) and unmodified stats print plain. While a boss holds the stage, DPS reads **Eff. DPS** against that boss — the same figure the boss picker's **Your DPS vs …** chip promised before you picked the fight, and the same loadout summary the Gear tab's header prints in standard context. Each hero is a button: tap it and its **source breakdown** opens — every contributor to that one number, row by row. The full all-stats breakdown lives behind Hunter → Profile's **Totals & Sources** door. While any consumable buff or activity modifier is active, a slim **buff line** rides under the heroes naming it — the deltas above include it. The old per-action figures live where the action lives now: roaming's gathering rates print in the roaming workspace panel, a crafting job's figures in its panel, and at standby the Roam panel's facts carry an **Away** cell with your offline cap (the cap you have earned through [[Research]] — see [[Progression]]), so you can read your build — and your away terms — before you start.

While a fight runs, each fighter's health rides on their own side of the stage, never across their face: your hunter's **HP plate** sits at his lower body — his current and maximum health, with the bar — and the enemy's **HP plate** (its name and health bar) floats translucent over the enemy's lower body at the same height, so the two read as a matched pair. A boss's HP plate anchors under the boss on the ground line, and its name rides that plate the same way.

Finds on the stage rise as what they actually are: a gear drop gets its rarity beam and item card; a cache key rises as the blue key shard; materials and essences rise as their own icons — the same adopted paintings the consumable ledger, the belt, and the market shelves draw, so the med kit you see on the vendor's shelf is the med kit in your belt and the one rising off a find — and a kill pays out with a scrap rise. Every one of those rise icons is a small painting, tinted to its own drop's color as it rises — they show exactly what they showed before. The everyday working icons across every screen are paintings in the same hand now — checks, chevrons, locks, shields — and where an icon's color carries its state, the painting itself ships in that state's colors, so the read never changes. The big cache crate never celebrates an ordinary roaming tick — roaming grants materials, the base payout, and now and then a whole cache key, while cache boxes themselves are opened on the cache lane. See [[Caches]].

The weapon in your hunter's hands is always the exact weapon you have equipped — its type, make, and rolled parts, drawn by the same renderer that draws its card, at the card's full detail — held at the grip, with nothing else underneath it. The same hunter, with the same rule, steps into the boss arena: what you see on the Board is what you fight with. Equip nothing and the hands are empty.

Your equipped gear is worn the same way — mounted on the figure itself, moving as he moves. Your shield projects from his support arm as its own behavior glyph (the starburst, ward, and so on), tinted by its element; your relic hangs at his chest framed by its rarity; the pauldron on his shoulder wears your class mod's tree; and the consumables slotted for the fight ride his belt. Swap any piece and the figure on the stage is wearing the new one — unequip it and that read is simply gone.

Under the gear, the figure itself is dressed by your [[Skins-and-Cosmetics|skin parts]]: wear a crafted part and it replaces the matching piece of the standard suit on the stage, in the boss arena, everywhere your hunter appears. Parts are pure looks — the stage hunter fights exactly as hard in a shaped Bulwark set as in the stock suit.

Changing area lives one tap from the stage: the mode rail's **Roam** stop and the workspace panels' **Change Area** buttons both open the area picker. Research no longer prints on Home — research runs alongside your action rather than replacing it, its enrollment state lives on Hunter → Research, and when a course finishes, it reads completed there.

## The consumable belt

Directly under the stage — below the hero rundown at its foot — sits the **consumable belt**: your active consumable slots, above the fold. Tap a slot to open the ledger and manage what is loaded. Your **vehicle chip** rides the resource Strip at the top of Home, docked beside the loot counter right after the gear count: your equipped vehicle and its fuel, sitting quietly as a readout while it is fueled — and the moment it runs dry (or wears out), the chip carries the remedy: a door to the Garage to load a carried fuel cell, or to the Vendor when you have none. On foot it reads **On foot** and opens the same Garage. The vehicle's full status lives in the Garage on the Gear tab. Below the belt sits the **lit workspace** for the current mode.

## When something is waiting

Nothing on Home gathers your waits into one card — each wait lives at its own home, where you act on it. A finished craft reads on the **Workshop's** bench (Home → Craft), ready to collect — and if you were elsewhere when it finished, the **Bench ready** announcement under the claim chips says so (see the top bar, above). Caches wait at the **Chest**, opened with a key or a rewarded ad — keys drip from roaming and land whole. Claimable contracts and the weekly Rep Desk earnings announce on the claim chips under the Strip and claim from their sheets. A while-you-were-away settlement waits behind the offline button (see below). A finished Research course reads completed on Hunter → Research.

## Event pop-ups

Live tick events surface as small pop-up cards in a fixed lane above
the bottom navigation. They are glance-only: each card is a single
headline carrying the outcome — the gain or loss and its subject
(`+1 BallisticParts`, `-12 HP`, `+12.5cr · +3 scrap · +16 XP`, a drop's
name) — with no narrative line under it. Inside the headline the
number is the hero: gain values print in bright gain-green at full
weight, damage taken prints in red, and the words beside a value
sit quieter. At most two cards show at
once, newest first, and each clears a few seconds after it appears;
newer events replace older ones rather than walling off the screen.
Gear drops follow the rarity law inside the lane: Common and
Uncommon drops use the compact card, Rare drops add their rarity
stamp in rarity color, and Epic and Legendary drops keep the full
two-line card (their moment on the stage itself is the separate,
rarity-scaled loot celebration). The complete event — what happened,
where, and from whom — is never lost: the same events print with
their full detail in the Now rows in the deck below and in the Action
screen's reward stream.

One exception to the popping: gains earned during a brief app
switch (under 15 seconds away) never pop on your return. The
action resumes the moment you are back, and those few ticks fold
straight into the Now rows and the reward stream below — the
record is complete, the return is quiet. Drops still pop and
still take their stage moment; only the routine gain cards fold.

## The deck

Everything below the fold is the **deck**, in a fixed order:

1. **Launchers** — the directory doors: **Dispatch** and **Crack Cache**.
2. **Now** — one merged feed: your latest activity plus the world pulse (current activity, level progress, boss progress, best weapon, bench state).

That is the whole deck. The doors that used to stack here moved to their canonical homes: Slots was removed from the game entirely (migration 0074), your loadout is the Gear tab (the stage's count plate carries the n/7 signal), weekly claimables announce through the top bar's Weekly chip and claim from its sheet, and your totals are the hero rundown at the stage's foot with the full breakdown behind Hunter → Profile's **Totals & Sources** door.

## While you were away

Your hunter keeps working while you're gone, up to your offline cap (see [[Progression]]). When you return, the window is computed and the earnings are **held** — nothing is paid until you claim it. The **offline button** in the top bar shows the true held amount, and tapping it opens the **Return Sheet**.

The Return Sheet presents the absence in the loot language: a **totals row** with the headline earnings, the absence's **best drop as a poster card**, the itemised rewards below, and one **Claim** button — the tap that actually pays: credits, XP, keys, materials, and items land at that moment, exactly once. The primer about **notifications** rides the sheet's footer — a single row inside the recap is the one place the app will ever offer to turn push notifications on, at the moment you can see exactly what a notification would have told you. The level sheet itself holds level specifics only.

One exception: if you were away **less than five minutes**, the recap never presents itself. The settlement still lands in full — it simply stays tucked behind the offline button for you to claim and read if you want it, instead of interrupting a quick check-in.

---

_Source of truth: `src/screens/HomeScreen.tsx`, `src/components/dashboard/`, `src/components/layout/ResourceBar.tsx`, `src/components/dashboard/DashboardTopBar.tsx`, `src/components/activity/OfflineRecap.tsx`, `src/store/slices/offlineRecapSlice.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
