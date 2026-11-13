# Changelog

Per-release notes for CyberCache, newest first. Entries are written by hand in the same PR as any release, grouped by day and theme. The merge ledger at the foot of this page is generated from master's merge history (Wiki Phase 4) and lists every pull request the entries summarize — and the freshness gate fails if a master merge ever lands without this page catching up, so the list cannot silently lapse again.

## 2026-11-13 — The market says when it's down; the Gear tab is already warm



- **The market's outage error actually shows up now** — the Buy stop gained a proper error screen with a Retry button if listings fail to load, but under the hood a failed load was still being folded into an empty result, so a real outage went on presenting as "No listings found." A failed load now reaches that error screen on both the Buy stop and My Listings; a market that is genuinely empty still reads as empty.
- **The Gear tab no longer makes you wait on first open** — the Gear screen used to build itself entirely on your first tap — its code, the loadout figure, the inventory and all — and if that tap came while a roam was warming up, the build queued behind the fight and the tab could sit on its loading card. The Gear tab now warms up quietly in the background once you are signed in, so the first open — mid-roam included — lands as fast as every switch after it. The screen itself is unchanged.
- **The next enemy after a kill no longer starts invisible**
- **Vehicle art stays inside its card now** — fitting a Scanner array (or a cargo rack, or a reinforced frame) used to blow the vehicle's picture out of its thumbnail box and paint it down over the card's Condition bar: the add-on paintings are their own pictures, not layers of the vehicle's, and the square scanner painting stretched to the box's width stood twice as tall as the box. Fitted gear now renders inside the vehicle's frame on the Gear list and in market rows alike — same paintings, same vehicle, nothing painted over the card. — when your hunter dropped a roaming enemy, the next one up could stay hidden until the fight's next beat landed — up to a full tick later — missing its walk-in entirely and then popping in already standing there. The fall-and-fade of a kill now belongs to the enemy that actually died; the next enemy walks in on time and in plain sight. The fight itself is unchanged: same targets, same damage, same timings.
- **The parked vehicle on the stage keeps up with the Garage** — equip or swap your vehicle on the Gear tab and the stage plate updates in place, instead of still showing the vehicle you had when the stage loaded; and its rolled fittings (cargo rack, scanner array, reinforced frame) render whole and undistorted inside the vehicle's own frame on both stage renderers, instead of the scanner painting spilling past the plate on one and squashing into it on the other
- **Ammo Packs now actually get used up as you roam** — coverage consumables like the Ammo Pack were only ever charged during one unbroken stretch of play: the coverage clock lived in the app's memory, so closing the app quietly reset it and pack counts never went down. The Chef now keeps the coverage clock on your profile, so a pack's ten minutes count down across sessions and away time alike, and each pack is charged when its window ends — the way coverage always described itself. (PR #580)
- **Buying from the vendor now asks how many** — tapping Buy on any vendor row opens a quantity sheet instead of buying exactly one: quick picks of 1 / 20 / 50 / 100 / 1,000 / MAX, a slider across the same range, and the total with your credits-after shown before you confirm. MAX is as many as your credits cover (vendor stock is unlimited), and picks you can't afford stay visible but disabled. The row buttons drop their old fixed "1" to match.



## 2026-11-12 — The audit fix wave



- **Linking Google now upgrades your guest account, as promised** — signing in with Google from a guest account used to leave the account flagged as a guest underneath: the market, services, extraction and leaderboards stayed locked and the game kept asking you to link. The link now promotes the account in place — same account, same hunter, same progress — and the locks lift the moment you sign in.
- **Class mods no longer phantom-spend your skill points** — wearing a class mod with a tree bonus used to inflate the "points spent" count behind the scenes: the Hunter screen could announce "All points spent" with real points still in hand, quote a respec price higher than the server would charge, and even block you from spending points you actually had. Spent, available, and the respec quote now count only the points you really spent — the mod's boosts still strengthen your skills exactly as before.
- **Local previews can no longer touch the live game by accident** — a copy of the game opened from a local address used to send its sign-ins and economy calls to the live production server unless it sat on one specific port, so a preview could silently play on the real economy. Local copies now talk only to whatever served them; pointing one at a real server is an explicit setting, never the default. The app itself is unchanged.
- **Roaming enemies no longer vanish after their walk-in** — on the animated (Pixi) Home stage, an enemy faded in as it approached and then disappeared the moment it arrived, leaving its name plate and HP bar standing over an empty patch of ground while the fight went on without it. The enemy now walks in and stays in the fight at its settle point for as long as it is your target — including when the stage opens on a fight already in progress, and when you come back to the tab mid-fight. Nothing about the fight itself changed: same targets, same damage, same timings — the enemy was always there, and now you can see it.
- **The Bulwark chest plate is unbroken steel now** — the shorter glowing cyan streak that ran beside the Bulwark plate's chest diamond is painted out, the same flaw the Standard Issue plate carried, along with the light it threw on the steel around it. The diamond itself — the framed gem set into the plate — is a deliberate light and burns exactly as it did, and every other accent on the set is untouched.
- **Major and keystone skills now charge the price on the tin** — every skill train used to debit a single budget point, even the majors listed at 3 and the keystones listed at 5, so whole trees ran cheaper than designed and a keystone could land far earlier than intended. Trains now debit the listed cost on every path, and the respec quote prices the same budget points the server charges. Points you already trained stay trained — nothing is retro-charged.
- **A stalled cache opening can't trap you on the decrypt screen anymore** — opening a cache used to wait on the server with no time limit at two points in a row, so a connection that stalled (without ever failing) left the cache shaking on the DECRYPTING overlay forever: no beam, no reveal, no error, and no way out short of killing the app. Every server request now has a hard time limit, a stall ends as a plain "took too long" error with the open button live again for a retry, and the background save that used to sit between the forge and the reveal no longer gates it — the weapon the server forged reaches its reveal as soon as it is granted. Timings, odds, and the reveal itself are untouched.
- **Big inventories open instantly now** — the Gear list used to draw every single item you own before the tab could settle, so the deeper your stash got, the longer the rows sat as blank stencils waiting for their portraits. Now the list only draws the rows on your screen (plus a few above and below), each item's portrait is painted at the size the row actually shows instead of poster size, and portraits you've already seen are remembered — scroll back or hop between tabs and they are simply there. Nothing about your gear changed: same items, same order, same sorting, searching, selecting and scrapping — the list is just no longer doing two thousand portraits' worth of work to show you eighteen rows.
- **Tabs remember themselves** — switching between Home, Gear, Market, and Hunter used to tear the old tab down and rebuild the new one from nothing on every single tap: the roaming stage re-painted itself second by second, the Market re-fetched its listings, every scroll position reset. Now a tab is built the first time you visit it and then simply kept — switching is just showing and hiding, so you return to the exact screen you left: same scroll, same stage already alive, no reload pause. The Market still refreshes its listings when you come back to it, and each tab keeps its own place independently. Sub-screens (Cache, Collections, Settings, the Field Manual, and the rest) still take over the full view exactly as before.
- **The Hunter tab only builds the room you're standing in** — the tab used to construct every stop at once (Skill Trees, Research, Collections, Standings, Wardrobe, Account, and the full Profile & Record) and merely hide the ones you weren't looking at, so opening the tab and moving around it dragged the whole building along. Now only the open stop exists; the others aren't built until their door is tapped, and they leave when you walk back to the menu. Nothing about what any stop shows, tracks, or does has changed — the doors, the badges, the deep links that land you straight on Skill Trees, Research, or the Wardrobe all work exactly as before. The tab is simply carrying the one room you're in instead of all nine.
- **"vs Boss" numbers now come from the real fight math** — the Hunter totals for boss DPS and Shield Break were a rough display estimate that over-promised speed-heavy builds (it counted attack speed at full weight; the actual fight engine counts it at a third). Wherever a boss is in context, those totals now print the boss simulator's own numbers — the same engine that settles the fight.
- **Linking a Google account that's already tied to another hunter now says so** — it used to silently sign you into that other account, leaving your current hunter's progress behind with no warning. Now the link is refused with a clear message: sign in with that Google account instead, or link a different one. Your current session is untouched.
- **One refusal, one answer** — actions that need a linked account (standing turn-ins, contract claims and rerolls) used to answer with a "wrong state" error while the market answered "not allowed" for the same refusal. They all answer "not allowed" now, so the sign-in prompt can always tell the difference.
- **Your shield stays in the fight** — yesterday the far arm sat out the combat stances, and because your shield rode that arm, it sat them out too — gone for most of every fight, popping back at rest. The arm still sits out (the strict side view stands), but the shield now remounts to your torso while you aim and ride the recoil, held across your body, and returns to your arm the moment you stand at rest. It never leaves the figure; every other pose is exactly as it was.
- **Long sessions no longer stall an hour in** — your sign-in token quietly expires after an hour, and the game's roaming connection didn't know how to renew it: claims started failing, "rewards are paused" appeared, and roaming silently stopped paying until you restarted the app. The roaming connection now renews the session and carries on, the same way the rest of the game already did.
- **A failed load now offers a way back** — if the game couldn't reach the server while restoring your session, it used to open onto skeleton bars that never filled, with no way forward but killing the app. It now stops on a clear screen with a Retry button (and a sign-out if you need it).
- **The web sign-in screen no longer offers a button that can only fail** — "Continue with Google" on the web build always ended in an error (sign-in lives in the app), and it dumped a developer debug packet on the screen for good measure. The web screen now says plainly that sign-in happens in the app, and guest entry stays front and center.
- **Switching activities says what it cost** — starting a roam used to silently pause a running crafting bench, and picking a boss silently ended your roam. Now a notice names it: "Crafting paused — Roaming started" (your bench jobs resume when Crafting holds the slot again), "Roaming ended — Boss fight started", and so on for every switch.
- **The out-of-fuel chip reads whole again** — at phone width its remedy text was clipped mid-word ("OUT OF" / "BUY CE"), hiding the one instruction the chip exists to give. The remedy chip now takes the room its words need. The hero rundown's "Shield Break" label gets the same treatment — it was truncating while the three-letter "Mit" sat on nearly as much room.
- **Guest rerolls on the contract board are closed** — a guest could reroll contracts (burning the board's free reroll, then spending real scrap) even though contract rewards have always required a linked account. Rerolling now asks for the same linked account claiming does, before anything is spent.
- **Vendor sell quotes now show your real rate** — the sell screen always quoted the standard 40% buyback, but the vendor actually pays your levered rate (Appraiser's Eye and Street Economics raise it). Quotes, the percentage in the copy, and the payout now agree.
- **A market outage no longer looks like an empty market** — if listings fail to load, the Buy stop now shows a proper error with a Retry button instead of "No listings found" and a prompt to sell your gear. Your own listings get the same treatment: a failed load says so, with its own Retry.
- **Your sign-in no longer rides an Android backup** — the app's session (the token that keeps you signed in) is now excluded from Android cloud backups and device transfers, so restoring an old backup on another phone can't carry a stale sign-in that knocks you out everywhere. Everything else still backs up as before.
- **Sign-out now leaves nothing behind on the device** — your "While You Were Away" recap used to survive sign-out and could pop up inside the next account's session on a shared device. Changing accounts or signing out clears it now, and your on-device snapshot copy is removed too (your own return still restores from the server as before).
- **The Wardrobe opens again for repaint owners** — if you owned a repaint-tier cosmetic, your cosmetics page failed to load at all (the server tried to read the repaint tier as a number). It now reads tiers the way the rest of the game does, and your parts list normally.
- **The market docs now match the market** — MECHANICS.md claimed listing was free; it has not been since the listing deposit shipped. Listing now correctly reads as a 25-scrap deposit, refunded when your item sells and burned if you cancel, alongside the 5% sale fee.
- **Level 100 is the top now** — XP used to keep minting levels (and skill points) past 100 forever, and your level plate promised a "Level 101" that was never meant to exist. Level 100 is the summit: XP still banks, the plate reads MAX LEVEL, and the skill-point budget stops at its designed 99.
- **Respec asks first now** — respec used to fire on a single tap: one misclick could burn your whole build and its full cost with no undo. The button now arms a confirmation that names the exact cost before anything is spent, and it stays disabled when you have nothing spent to refund.
- **Signing out on one device no longer signs you out everywhere** — a signed-out session's leftover refresh attempt was being read as token theft, which revoked your sessions on every device. Sign-outs are now marked for what they are; only genuinely replayed (rotated) tokens trigger the theft response.
- **Explanatory paragraphs are off the screens for good** — a few had crept back: two chatty lines under the hero stats on Home, a tagline under the Inventory heading, and three paragraphs in the expanded Garage. They're trimmed to the facts and labels every other screen uses, and the game's no-paragraphs check now scans Home and the Gear page too, so they can't creep back unnoticed.
- **Small text you have to read is at the readable size now** — a few labels had slipped under the game's 11px floor: the "Unarmed" state word on the stage, workspace labels, badge labels, and the area picker's stats among them. They're all at the floor, and a new automated census keeps every screen honest from here on.
- **The small buttons are proper tap targets now** — the little text buttons that used to stand only about 25px tall (Save, Cancel and OK in the build presets, Unequip, Change Boss, the extraction panel's Close and Settle, the Gear bulk Lock/Unlock and clear-filters chip, the sign-in banner's Dismiss, Collections' Retry and their kin) now meet the 44px tap law, big enough to hit reliably on a phone. Nothing moved and nothing about what they do changed; they are just taller.
- **Hunter Totals now call the big health number what it is** — the total that counts your shield's mitigation as extra health is labeled **Effective HP**, and its breakdown names your actual HP pool beside it, so it can't be mistaken for your roaming health bar. The values themselves are unchanged.
- **The bench's pause message names the real blocker** — standing in boss prep with jobs queued no longer claims "you're in a boss fight" when no fight is running; it says you're prepping for a boss. The fight wording now appears only while a fight is actually on.
- **First launch is quieter under the hood** — a fresh account's starter bundle (5,000 credits, 500 scrap, 3 cache keys and the Scrap Bike) is now requested exactly once per session, so the duplicate request that used to bounce off the server on a new player's first screen is gone. The bundle itself is unchanged.
- **The Garage agrees with itself when the tank is dry** — the vehicle card's "Effective yield now" used to keep showing the fueled bonus (×1.15) while the banner above it said you were roaming on foot at ×1.00. Both now read from the same tank state: empty tank, ×1.00 everywhere.
- **Stack prices in the Market now add up on the label** — a ×17 stack priced at 25cr used to read "1cr ea", which implies 17cr. The per-unit label now prints the exact price (1.47cr ea; whole credits when the price divides evenly), on both the listing row and the listing's detail header.
- **Skill-tree node art renders at its full size** — the authored 30×30 node art was being squeezed into 20px on the board, blurring the inner marks and your tree's sigil into a colored blob. It now renders at its native 30px, so each tree's sigil reads clearly.
- **A worn cosmetic that can't be found now says so in the developer console** — if a skin part you're wearing fails to load, the game still shows the stock part (as before), but the miss is now recorded on the resolved look instead of vanishing silently, so the problem can actually be found and fixed.
- **The Chamber's error message now has a Retry button** — if the Endless Chamber facts fail to load, you no longer have to leave the tab and come back; tap Retry and it loads again right there.
- **Leaderboards and social screens are now officially open to guests in the app's gate table too** — they already worked for guests; this removes a leftover rule that said otherwise, so nothing can accidentally lock guests out of viewing them again.
- **No connection no longer reads as a broken app** — if the game can't load because your device is offline, the loading screen now says you're offline (and to reconnect and reload) instead of claiming the app failed to boot.
- **Behind-the-scenes account safety fix** — the test version of the sign-in system could silently hand an email address to a brand-new Google account; it now refuses exactly the way the live system does, so the protection is actually covered by tests.
- **You can always cancel your own market listing now** — the Cancel button no longer demands a verified account, matching the server: pulling down your own listing is recovery, not trading, so a lapsed verification can't trap a live listing anymore.
- **Boss specials announce themselves** — when a boss starts winding up its big cadence attack, the fight stage now calls it out by name (Sand Slam, Eruption, Event Horizon, and the rest of the thirteen) with a red danger ring and a charging glow, for exactly the window before the hit lands. Regular attacks keep their existing small glow, so a special reads instantly differently from a jab. What is coming is always shown — the odds, as ever, are yours to judge.
- **A graphics hiccup can't freeze the fight anymore** — if your device loses the game's graphics context mid-fight (a GPU reset, a driver stutter), the stage used to freeze on its last picture forever, with the fight still running behind it. Now the stage hands off to the backup renderer instead — the same fight, fully playable — instead of leaving you staring at a still frame.
- **Crit % now shows the crit your fights actually use** — the rundown and the Crit breakdown used to pool the crit of every weapon you carried, so the number on your hunter never counted your skill nodes: points in Steady Hand and Weakspot Training were raising your real crit in boss fights (and could switch on the Gunslinger keystone's high-crit bonus) while the displayed number never moved. Crit % now reads the fight's own number — your primary weapon's crit plus the crit your skill nodes grant — and Crit × is your primary weapon's own multiplier, the one its crits land with.
- **Your hunter name can wait** — signing in used to stop the game cold and demand a hunter name before a single tab would open. The ask is now an invitation with a **Not now** door: claim a name when you're ready, or skip it and play. The game asks again when you first reach the Standings — the one place the name is actually on show.
- **One HP pool, everywhere** — your hunter's HP used to be three different numbers depending on where the game looked: Cache Rank Thick Skin counted in your Hunter totals and boss fights but not while roaming, while the offline earnings check quietly inflated HP with a hidden bonus no perk describes. There is now exactly one HP pool — the one your totals show, Thick Skin included — and roaming, boss fights, the fight's HP bar, and the offline check all use it.
- **Roaming recovers between exchanges** — recoil and hit poses return to ready instead of holding until another event. Hidden stages rest while other tabs are open and resume in place.
- **Numbers explain the right quantities** — boss DPS uses the fight model, roaming Dmg/tick uses the roaming loadout, source rows include Cache Rank and reconcile to their totals, and extra slots print as counts. Area rates are labeled Base, elapsed time counts real seconds, and open consumable countdowns stay current. Foreground syncs also enforce their normal tick limit against malformed requests.
- **Your cache winnings now stay on screen** — when a cache reveal finished, the item, its stats, and its buttons vanished along with the animation, leaving the CACHE DECRYPTED header over an empty stage while the reward card waited a full screen further down, out of sight. The reveal stage now settles down to its header the moment the animation ends, and your item is right there beneath it: its picture, its complete stat deck, and its Equip / Lock / Salvage buttons, with Open Another and Collect beside them. The reveal itself — beam, rise, and timings — is untouched.
- **Roaming fights now replay the same way every time** — every roll in a roaming fight was already dealt from the fight's own seeded dice, so the same tick always came out the same — except the combat damage itself: which enemy pressed you, whether it hit, and the swing on both its hits and yours were rolled loose and landed differently on every pass over the same fight. That looseness also made one of the game's own roaming checks fail at random. Those rolls now draw from per-tick streams seeded like every other roll in the fight. The odds are untouched: same enemies, same accuracy, same damage ranges — the rolls are simply the replayable ones now.



## 2026-11-11 — The cache, painted whole; the big icons are paintings now; vehicles and set pieces, painted whole; a painted sign-in; goods, painted; gear, painted; your hunter is a painting now; the vistas are paintings now; your weapons are paintings now; the far arm sits out the fight; the reveal's light is a corona now



- **The cache crate is a painting now** — the little pixel crate is retired everywhere it stood: on the cache lane, shaking in the decrypting overlay, and at the base of the reveal's beam, you now see the game's cache painted at full quality — deep navy panels, brass corners and latches, hairline cracks with gold light glowing inside them, and the gold hex medallion on the lid — the same crate the app icon carries. And the reveal has its missing frame: as the beam ignites, the crate **opens** — lid swung back, gold light pouring out of the chest — the frame the whole moment catches fire from, before the crate fades and your item climbs. Every timing is exactly what it was; only the crate's portrait changed. Out in the Dustwaste, the half-buried cache the roaming event unearths wears the same new paint — the event, its odds, and its rewards are untouched.
- **The tab sigils, the streak calendar, and the loot rises are painted now** — the four bottom-bar sigils (Home, Gear, Market, Hunter), the calendar on the login-streak plate, and every marker that rises off a find on the stage — material, essence, fragment, scrap, credits, and the cache crate — are full paintings instead of the old texel glyphs. They sit in exactly the slots the glyphs sat in, at exactly the same sizes, and they show exactly what they showed before. The rises keep each drop's own color: the painting is re-tinted to the drop's hue as it rises, so a green material still rises green and a violet essence violet. The small working icons everywhere else — buttons, rows, badges — are unchanged.
- **Your vehicles are paintings now** — every class wears its new colors: the Scrap Bike in rust red and black, the Dune Buggy in olive and sand, the Utility Rover in safety orange with its white roof panels, the Cargo Hauler in rust brown, the Armored Crawler in gunmetal olive, the Relay Skimmer keeping its teal-cyan, and the Leviathan Rig in charcoal and rust-brown — the flagship is a full portrait now where a plain blockout used to stand. The Garage, the roaming diorama, and the market draw the same paintings, and the affix and wear overlays — cargo racks, scanner arrays, scuffs and smoke — ride over them exactly as before.
- **The world's furniture matches** — the benches, the bay lift and its trays, the vendor stall and sign, the dispatch board, the extraction rig, the refinery, the research shelves, the resurrection pod, and the war-room table are all painted at the same quality now, everywhere they stand in the workshop, the market, and your Home.
- **The sign-in screen's banner is a painting now** — the old pixel vista strip is replaced by the full painterly rendering of the same scene: banded rust dusk, mesas, the ruined skyline, and the cache crate itself — the adopted mark, charcoal shell and brass latches — cracked open with its gold beam pouring into the sky. Same slot, same framing; the finish is smooth instead of stepped.
- **Android themed icons work now** — the launcher ships a monochrome layer, so on Android 13+ the home-screen icon tints with your wallpaper theme like every other app: the crate, its split lid and the burst gap, drawn as one clean silhouette.
- **Shared links carry a preview** — the site's pages now declare a social preview image and card metadata, so a link to CyberCache posted anywhere shows the crate portrait instead of a bare URL.
- **The store banner catches up** — the Play feature graphic is restaged with the adopted crate (it still carried the retired pre-painterly crate); it goes live with the next listing submission.
- **Your hunter is a painting now** — every piece of the figure you assemble and dress — the Standard Issue rig, the Bulwark and Dreadnought skin sets piece by piece, the eight maker helms, the pauldron and relic and shield-emitter portraits — is now the adopted Top-Choice painting of that piece, standing in exactly the frame and pose the old portrait stood in, so every pose, joint, and mix-and-match combination works exactly as it did. One honest gap: the Dreadnought set's head has no painting — the portrait sittings for it never produced one — so that one piece keeps its current portrait until it can be painted properly. The hood is untouched, as ever.
- **Every area's backdrop is its full master painting now** — the roaming grounds and camp used to be assembled from layered strips sliding past each other; each scene is now one complete painting, front to back: the Dustwaste sunset over its dunes, Redline's red sun over the circuit plain, Ironwood under its moon, BlastForge's yards under the smoke (the yards got a fresh painting with real ground under the cranes — the old sky was all flame), PrismaTek's crystal hills, ThrowTech's storm towers, HelixWorks' glowing skyline, and camp under its starfield. The life on top of the paintings is unchanged — the drifting clouds, rising embers, blinking lights and campfire smoke still move on their own clocks, and your hunter still anchors on the same ground line in every scene.
- **The everyday icons are paintings now too** — the working icons on every screen — the checks and chevrons, the lock, the wrench, the shield, the little book and flask and trophy — are full paintings in the same hand as the tab sigils and the cache, sitting in exactly the slots and sizes the old texel glyphs sat in. Where an icon's color used to carry its state — a rarity's rings, an element's shield, a boss's purple armor readout — the painting now ships in that state's own baked colors, chosen piece by piece, so the read is the one the game always gave. The element badges on gear stay the plain dark stencils they were: on their colored field, the silhouette is the information.
- **Every consumable and material is a painting now** — all 44 consumables, all 26 materials and essences, and the wallet's own marks (credits, cache keys, XP, level, mastery, loot, legendary cores) were re-rendered at full painterly quality and those renderings are what the game draws: the same med kit on the vendor's shelf, in your belt, and in a market listing is the one painting, and Scrap's heap is a heap of rusted salvage instead of a diagram. Nothing about what any item does, costs, or stacks to has changed — only how it looks.
- **Cache Fragments are gone from the game's face** — the fragment currency was abolished a while ago (whole cache keys are the only cache currency), but its name and mark still lingered in the registries behind the wallet and the reward chips. Those are deleted now. Old records that mention fragments stay readable as history; nothing you own was touched.
- **Your shields, relics, class mods and ordnance are paintings now** — every one of the five shield forms, all sixteen relics, the four class-mod casings and the four ordnance forms renders as its full painterly portrait everywhere it appears: gear list, inspect sheet, loadout, compare and this manual's plates all show the same picture for the same item. A shield's element still recolors its glow — the blue Shock heart of a Nova turns Fire-orange, Cryo-cyan or Void-purple by palette, exactly the surfaces the old plates lit — and the Absorb shield keeps the plasma orb at its heart. A class mod's casing arrives with its deck window empty, and the live node field is drawn into that window from your actual boosts, seated where the casing's window really is; the Void Prism keeps the nebula turning in its eye. Nothing about the items themselves changed — same names, same stats, same effects — only how they're pictured.
- **Your weapons are paintings now** — every gun in the game pictures as its adopted Top-Choice painting: one portrait for each type × manufacturer, and each named legendary has a portrait of its own, the same picture in your hunter's hands, on its card, and in a market listing. What makes a copy yours rides on top of the painting: its element lights the painting's glow window in the element's colors (a Kinetic gun's window stays plain grey), its affixes stamp their decals onto the body, and its roll quality shows as condition — a beat-up gun looks beat-up and a godroll sparkles. A named legendary is never worn or stamped; its portrait is fixed, exactly as it was made. The old assembled-from-parts look is retired: your rolled parts still count in the stats exactly as before — they just no longer change the silhouette.
- **The Standard Issue chest plate is unbroken steel now** — the glowing cyan slash that crossed the breastplate is painted out: at the shoulder it read as a third arm, and the plate was never meant to carry it. The slash is gone from the painting itself; every other light on the rig — visor, wrist, the pouch studs — burns exactly as it did, and the Dreadnought plate is untouched.
- **The far arm sits out the fight** — in the aim stance the far (support) arm used to hang in the gap between the gun arm and the chest, its shoulder hidden, reading as a stray little arm at the armpit. Bracing it under the gun didn't cure the read, so it is simply not drawn in the combat stances now: the game is a strict side view, and in aim and recoil only the gun arm shows. Your shield rides that arm, so it sits out those two stances with it and is back on your arm at rest. The Bulwark and Dreadnought rigs follow the same rule. Every other pose is unchanged.
- **The reveal's light is a corona now** — the glow behind a risen cache item used to be stacked golden discs, and around a legendary they read as stamped shapes next to the painting. Now the item hangs in a corona of real light: white-hot at the heart, falling off through gold to a warm amber wash, with dozens of fine rays radiating through it, and the slim beam landing in a soft bloom of light on the ground instead of a hard pool. The CACHE DECRYPTED header stays crisp through the peak of it — the beam's light is notched down behind the words over a soft shadow, so nothing washes out. Gold sparks and rising embers ride the column as before, the shockwave ring keeps its stepped edge, and every timing — the beam-in, the rise, the 2.6-second legendary hold — is exactly what it was.




## 2026-11-11 — Boss mechanics collect

- **A boss's mechanic now charges what it advertises** — the line printed in a boss's prep is the line the fight measures: the Siltstalker's enrage is a kill-speed check (DPS 1.3), the Heap Guard's regen loop a shield-break check (1.2), Ashgut's burning ground a survival check (1.4), and the Rust Prophet's repairs and the Verdant Maw's regrowth are armor-break checks (1.5). Meet the line and the mechanic costs nothing; fall short and the shortfall taxes the attempt in proportion — no cliff, no free pass. The Scrap Bishop's three-phase siege measures all three of its layers (shield 1.25, armor 1.25, kill speed 1.35) and taxes on the weakest. Trait gates, the Mirror's adaptation, and the Widow's and Omega's ramps work exactly as before, and the Endless Chamber is untouched — the demands belong to the ladder.

## 2026-11-11 — Weapon paintings in the Reference

- **The Reference pictures the new weapon paintings** — the legendary weapons table and the weapon frames table now illustrate every named legendary and every type × manufacturer base with its adopted Top-Choice painting: full painted detail in place of the old texel renders. The element-read plates are unchanged — element light is the game's own compositor work, and those plates still show it. In-game weapon art is untouched by this change.

## 2026-11-10 — The reveal's light, finished smooth

- **The cache reveal's light draws smooth now** — on the reveal stage only, the beam and its fan of rays are continuous light instead of stepped dashes: the fan's shafts taper and fade toward their tips, the beam's bands feather at their edges, and the legendary's turning ray-disc falls off in three soft stops. Gold sparks burst where the beam meets the ground as it ignites, and warm embers rise through the column while your item climbs. Every timing is exactly what it was — the same beam-in, the same rise, the same staggered ignition, the same sixteen-second spin — only the light's finish changed. The shockwave ring keeps its stepped edge, and every other effect in the game (fights, the bench) keeps the texel grid untouched.

## 2026-11-10 — Bosses have a rhythm

- **Bosses attack in patterns now** — every boss's damage lands on a beat: regular hits on a steady interval, and a named special on a slower cycle that carries a fixed share of its damage — Refraction Burst, Event Horizon, The Maw Opens, and ten more, all printed in the boss's prep under Attack Pattern, wind-up included. The total damage a boss deals has not moved a single point; only the timing is new. The timing matters because of the quiet between hits: shields now recharge inside boss fights during the damage-free stretches, so a wide-rhythm boss lets a fast-recharging shield breathe, while a boss that hits every three seconds leaves no quiet at all — bring capacity instead.

## 2026-11-10 — A sharper cache

- **The cache got a new portrait** — the app icon and logo were re-rendered at full painterly quality: the same navy cache crate with its lid cracked in two and the gold burst pouring out, on the same vivid rust field — now with crisp, continuous surfaces instead of the old pixel finish. It is the same logo everywhere it appears: the home-screen icon, the web logo and favicon, and the store icon all carry the new rendering, and at small sizes the crate and burst still read at a glance.
- **The launch screen matches now** — the Android splash used to open on an old orange cache device that was never the logo; it now shows the new portrait instead: the whole navy crate and its gold burst, framed as an emblem on the same dark gradient field the old splash used, in every size and orientation the app ships.

## 2026-11-10 — Fights move faster now

- **Overclock Serum** — a new craftable from the bench (30 Scrap + 2 Ballistic Parts): your weapon fires 15% faster for a full minute. Higher-quality batches push the boost further, up toward +30%. It is a crafters' item — the vendor does not stock it — and it stacks with your damage tonics instead of replacing them: more hits, same punch per hit.
## 2026-11-10 — Scrap earns its keep

- **Crafting consumables costs real Scrap now** — the Scrap legs on consumable recipes were priced back when Scrap barely moved; they now run two to eight times higher, tiered by the item: a Patch Kit costs 10 Scrap, a Med Kit 40, a Shield Cell 100, an Adrenaline Shot 300. Batch recipes follow the same curve. Everything else about the recipes — the other inputs, the craft times, what the items do — is unchanged.
- **Listing on the market posts a Scrap deposit** — creating a listing now charges 25 Scrap alongside the escrow. Sell the item and the deposit comes straight back; cancel the listing and it is burned. The 5% sale fee works exactly as before, and the Sell form shows the deposit before you confirm.

## 2026-11-10 — Your shield comes back

- **Shields recharge now** — the RECHARGE number on every shield card is live: go a full tick without taking a hit and your shield refills at that rate until it is full; take damage and that tick's recharge is lost, with no extra delay once the quiet ticks return. It is the Borderlands rhythm — break off, catch your breath, come back whole — and it makes Turtle's trade honest at last: the big pool refills at half speed. Shield Cells still restore instantly when you cannot afford the quiet.

## 2026-11-10 — Your vehicle rides up front

- **Your vehicle has a permanent seat on Home now** — its chip moved off the consumables belt (the belt is consumables only again) and onto the resource Strip, docked right beside the loot counter after the gear count: your vehicle is your eighth loadout slot, so it sits with the counter that counts the other seven. It reads the same as ever while you're fueled — name, fuel units, yield, condition when worn — and still flips to its remedy when you run dry or wear out. The change that matters: it no longer vanishes when you're on foot. It reads **On foot** instead, and every state — fueled, dry, worn, on foot — taps straight through to your Loadout with the Garage already open.
- **The Field Manual's link counter can no longer be stalled by a duplicate link** — the check behind the manual's Links readout waited for one hand-counted link total, so a wiki page linking the same page a second time (an ordinary edit) changed the total, the check waited on a number that could never appear, and the manual looked frozen in testing. The manual itself always showed the true count; the check now waits for the manual's own corpus to finish loading and compares against the count the corpus reports, so a future duplicate link fails loudly with both numbers instead of silently timing out. Nothing about the manual's pages, links, or counter changed.

## 2026-11-10 — Enemies close the distance

- **Enemies walk in and close on you now** — a roaming enemy used to appear near its mark and slide the last few steps rigidly; now it enters from well off its mark — about four times the old distance — body swaying and shifting with its stride as it comes, and settles closer to your hunter, so fights frame tighter. A shot that lands while it's still walking in plays through its stride instead of freezing it, and it arrives exactly on its fighting stance. Bosses keep their own entrance staging.
- **The hunter's stride reaches full stretch** — the between-enemy advance used to spend its whole walk-in still warming up, peaking at about three-quarter stride as he arrived. His travel gait now builds to a full stride inside the walk and settles from there — same steps, same pace, the walk simply finishes becoming a walk before it ends.
- **First attempts on a boss cost half price** — until you have beaten a boss, every attempt on it charges half its entry fee: the Mnemosyne Mirror's first clear costs 2,500 credits instead of 5,000, The Siltstalker's 100 instead of 200. The discount is per boss and ends for good at your first victory over it; rematch pricing takes over from there. The fee prep shows is still exactly the fee charged.
- **Named elites stalk you more often** — when an elite rotates into your fight, it now escalates into the area's named elite — triple the strength, and its drop can't roll below Epic — about half again as often as before. Keep the belt stocked.

## 2026-11-10 — Consumables hit like they should

- **Ammo is worth its belt slot now** — a plain Ammo Pack raises damage 10% instead of 5%, High-Capacity and Incendiary sit at 12%, and the crafted coatings bite harder: Elemental Coating breaks shields and armor at 1.15×, Prism Coating at 1.18×, and a Redline Tonic runs at +14%. High-quality batches stretch further than before — a perfect Ammo Pack reaches +17.5%.
- **Heals grow with your hunter** — Med Kits, Nano Swarms, and Adrenaline Shots no longer restore a flat number that a high-level pool swallows whole: a Med Kit restores 20% of your pool (30% for the Refined), a Nano Swarm repairs 35% over 30 seconds, and a Shield Cell restores 25% of your shield's capacity. Early on they feel the same; deep into the levels they finally keep up.
- **Ordnance carries real weight** — the flat damage rider on every ordnance charge is four times what it was: 200 on a standard Ordnance Charge up to 360 on a Magnetized Payload, and a Forgeheart Charge now adds 120.

## 2026-11-09 — The log remembers everything

- **Your Activity Log now traces every action** — the record used to skip the quiet moves; now nothing you do to your own account is a mystery. Bulk salvage files its batch summary beside the per-item lines. Extraction settlements show their passes, finds, and XP. Reforging, standing turn-ins and rank-ups, streak claims, cache-rank token gains and spends, consumable use, and refuels all leave their lines. The repair and shield-tech boards record every step — posted, accepted, finished — each hunter reading their own side of the job. Dispatch departures, recalls, and board rerolls sit beside the settled returns. Listing something, or pulling it back down, reads beside the trades. Queuing a craft — or cancelling it for its inputs back — shows beside the completions. Even equipping, unequipping, and locking a piece of gear is on the record now. Two new chips — Extraction and Services — filter straight to the new lines, and the search box covers them like everything else.

## 2026-11-08 — The hunter gets a polish pass

- **The converted hunter, finished properly** — the hand-drawn hunter gets its polish pass: the Bulwark helm's dome is modeled platework now instead of one broad flat field, the shadow-side legs carry real form instead of reading as dark columns, the Fin's rust crest sits bolted to the crown, and the backpacks have their missing machinery — Bulwark's lower greebles, Dreadplate's tank-face seams and wear, the Standard Issue pack's swept plate seam. Same silhouettes, same outfits, same anchors — the work is all in the surfaces.
- **The hunter's legs are jointed now** — under the hood, the leg rig works the way the arm rig always has: the shin hangs off the thigh's knee instead of being pinned to the ground, so the legs can genuinely articulate — the groundwork for a walking hunter. Nothing on screen changes yet: every standing pose renders exactly as before, pixel for pixel; the stride itself arrives with the travel beat it belongs to.
- **The hunter walks between encounters now** — the travel beat the jointed legs were built for: when a roam starts, and again each time the next enemy comes on, the hunter advances on foot — legs striding, the country sliding past at the pace of his own steps so his boots and the ground agree — and settles into his stance as the enemy walks in to meet him. A shot landing mid-stride cuts the walk short exactly as it should; he finishes his last step into the fight, never through it. This closes the Motion Reboot: every stage motion the audit called for — the work cycles, the Pixi roam stage, the jointed legs, the walk itself — is in the game.
- **The enemy on stage is the enemy on the plate now** — on the WebGL roam stage, the enemy's picture was frozen on the first target of a session: the next enemy walked in wearing the previous one's shape while its name plate told the truth. The stage now swaps the enemy's drawn form the moment the target changes — every enemy you face is the one the plate names.

## 2026-11-08 — The named legendaries are hand-drawn

- **The named legendaries are hand-drawn now** — all 26 bespoke legendary weapons have been re-authored in the game's pixel craft, each as its own drawn piece: Armor Eater's vials and maw, Jackpot's reels and coin tray, Void Bargain's portal ring, Borrowed Time's clock face. Same names, same effects, same guns — they now render from the same drawn system as every other weapon, so the legendary you win reads identically in the reveal, on its card, in the inspect sheet, and in your hunter's hands. The swap also retired about 1.5 MB of old sprite files.

- **The tab icon is lighter now** — the browser-tab and home-screen icon (the cache crate bursting open) was recompressed the same way the logo was: the full-quality original is kept in the branding archive, and the shipped icon is about 62% smaller with the same picture at every size it is ever shown.

## 2026-11-08 — The places come alive

- **The workshop's rooms are real places now** — the bench scene in the Workshop and the repair and shield-tech bays on the Market boards no longer stand in front of a painted backdrop: each stands in its actual area, with that area's own weather and life moving behind the work — furnace smoke and embers at the BlastForge bench, dust and signal lights in the ThrowTech bays. Same benches, same work — the rooms finally match the world outside.
- **Your hunter minds his own stall now** — while one of your market listings runs, the Home stage shows the hunter at his vendor stall tending it — weapon slung, hands on the goods — instead of standing guard over it with his rifle up.
- **The Dumpnet heap is a pile again** — the big scrap heap under the turret nest in ThrowTech Dumpnet was the softest shape in the new backdrops: one smooth mound in three flat shades. It has been rebuilt as piled wreckage — faceted slabs with lit tops and hard shadowed undersides, cracks running down from its crest, wreckage jutting from its flanks, and the heaps on the horizon ridge and at the stage's feet given the same broken treatment. Same vista, same colors, same view — the junkyard looks like one now.
- **The workplaces are dressed properly now** — the gear your work stands among has been redrawn in the same pixel craft as everything else: the salvage crusher is a real jaw crusher with the work sparks landing in its mouth, the repair bay's lift is a lift — your vehicle sits up on its deck instead of floating beside it — the shield-tech rig's ring actually holds the shield being calibrated at its center, and the vendor stall is a stall you can read at a glance — canopy, counter, and goods on display: jars and wares on its front shelf, stock stacked at both ends. Same rooms, same jobs — the furniture finally matches the world.

## 2026-11-07 — The craft standard gets a gate

- **Your hunter is re-drawn in the craft standard** — every wearable part — Standard Issue, Bulwark, Dreadplate, and every head in the Wardrobe — has been re-authored by hand in the same pixel craft discipline that gave item art its depth: hue-shifted ramps, selective outline, cluster detail. Same silhouettes, same outfits, same anchors — crisper at the sizes the game actually shows, and because parts are now palette data end to end, mixing sets (a Bulwark helm over Dreadplate legs) reads as one hunter in scavenged kit. The Hood keeps its shaped cowl from the last pass. The game's art payload also shrank by over 600 KB in the swap.
- **Small items read at belt size now** — the icons you tap most got a form pass at their smallest size: every grenade type now has its own silhouette (the EMP ring, the magnet's horseshoe, the forge charge's molten crack), every scanner device reads differently (whip antenna, dish, twin-antenna jammer), the patch kits carry their cross where you can see it, and the calibration kit wears its dial. Two materials that were pale twins — Refined Alloy and Composite Plating — now stack visibly differently, and Voidweave's cloth no longer borrows the circuit board's checker.
- **The Field Manual shows real consumables** — the Manual's consumable pictures were monochrome pictograms from a retired icon set; they now show the same formed objects the game itself draws.
- **The gun in your hands is the gun on the card** — the weapon your hunter holds on the stage is now drawn by the same renderer as the big inspect card, minus the presentation furniture (no bipod, halo, or floating sparkles in-hand). Same gun, same shading, at its best quality everywhere you see it.
- **Crafting moves now** — at the bench your hunter actually works: forge, crusher, assembly, and calibration stations each run their own motion cycle while a job progresses, and the finished piece rises in the loot beat when it completes. Salvage and workshop service jobs animate the same way.
- **The item is on the bench now** — while a job runs, what it's making sits right on the bench under the hunter's hands: the patch kit, the ingots, the skin part, the named relic taking shape. A rolled gear piece can't be pictured before it exists, so its seat shows an empty frame in the rarity the job rolled — the real piece appears the moment the job lands. And landings read true now: a finished shield, relic, class mod, or skin part rises off the bench as itself, not as a plain gold glow. Salvage joins the ceremony too — a recycle settling at the crusher sends its scrap rising in the same beat.
- **The benches are proper pixel work now** — all three bench tiers were redrawn to the game's pixel craft standard: a forge bench you can read at a glance — hood, chimney, glowing mouth, anvil — instead of the dark glittery miniature that used to sit there. Same benches, same work points, a fraction of the weight.
- **One lane for the maker helms** — the six manufacturer helmets leave the crafting shelf and live only in the Standing picks, where they always also belonged (they are visor recolors, and the catalog now says so — part labels tell the truth about palette vs shaped). If you already crafted one, nothing changes: yours still equips, wears, and trades exactly as before, and any already-listed helm completes its sale. The Hood is a real hood now — a shaped cowl instead of the old flat slab.
- **Item art is lint-checked now** — every procedurally drawn item in the game (weapons, gear, consumables, materials — 366 renders across every system) is checked in CI against the pixel craft standard: hue-shifted ramps, selective outlines, cluster discipline, and a ban on banded shading. The standard that made item art read richer yesterday now fails the build if it ever regresses.
- **Launchers and beam rifles are hand-drawn now** — the last two weapon families get the sniper's authored treatment: the launcher's feed drum, box magazine, carry handle, and warhead, and the beam rifle's lit spine channel, twin prongs, and power cells are drawn once, well, and assembled from your actual part rolls. Every variant, element, and rarity of both families is refreshed — in your bag, on the big inspect card, and in your hunter's hands — and the Field Manual's pictures match.
- **Dead weight overboard** — the stage's retired vector fallback scene and an unused area-background component are deleted outright: the pixel stage is the only stage now, with no dormant second scene waiting behind it. The game's logo file also ships at a quarter of its old weight (the lossless master stays in the repo for store use) — same logo, same picture, less to download.
- **Pistols, SMGs, and shotguns are hand-built now too** — following the sniper's lead, three more weapon types are drawn from hand-authored part art: every barrel, grip, receiver, magazine, chamber, and sight variant is a drawn piece, assembled by the same rules. The rolled parts still pick which pieces your gun is built from, and maker, element, and rarity dress them as before — a shotgun's pump is a drawn piece now as well.
- **The last smooth-vector art is gone** — skill-tree nodes, your profile trend lines, the consumable ring, the workbench's spark bursts, and the little icons that rise off a kill when loot lands are all drawn in the game's pixel hand now, and they lint under the same craft standard as item art. They show exactly what they showed before — they just finally match everything around them. A long-retired fallback stage that had been riding in the build unused went out the same door.
- **Roaming moves like the boss fights now** — the Home stage while you roam renders on the same WebGL stage (PixiJS) the boss fights use: your hunter's poses blend instead of snapping, shots, dodges, and kills play out as one continuous motion, and the vista drifts behind it all. Same scene, same enemies, same loot beats — only the motion changed. Devices that can't create a WebGL context keep the previous stage automatically.
- **Extraction works the site now** — while a pass runs, your hunter works the sift rig on the Home stage in a steady dig-and-sift rhythm instead of holding one frozen pose for ten minutes, and when a pass lands, what it dug up rises off the rig — each material and essence shown at the count it settled — while the workspace below keeps the written record as always.
- **Endless fights play on the main stage now** — a Chaos Chamber run owns the Home stage for its whole duration: the next encounter stands in its own arena between depths, and each fight plays up top on the same stage the boss fights use. The Chamber panel below keeps depth, escrow, banking, and the result, and no longer runs a second fight picture of its own. (The stage had been stuck on the camp picture for the length of a run — that fall-through is fixed, and a regression test guards it.)
- **The world is hand-drawn now, and it moves** — every roaming backdrop has been re-authored in the game's pixel craft: layered bands drawn for each area — dust devils and ember drift in the Dustwaste, aurora over the Prismatek reactor dome, the HelixWorks gate lit from inside — and as you roam, the view now travels across the country instead of sitting on one framed picture, each layer sliding at its own depth. Camp got the same treatment: idle time is spent at a real camp now, your hunter at the fire, crates and supplies where the camp keeps them, smoke and fireflies doing their slow work. The swap also cut about 2.7 MB of painted backdrop out of the download — the drawn world weighs almost nothing.

## 2026-11-06 — Gear reads faster, the Manual moves in

- **Item art has depth now** — weapons, shields, and gear are shaded with hue-shifted ramps: shadows lean blue-violet, highlights run warm, and an item's outline takes the darker shade of the form it borders instead of one uniform black edge. Same items, same shapes — they read richer, above all on the big inspect and reveal renders. The wiki's item pictures are refreshed to match.

- **Boss fights move like a game now** — the boss fight stage renders on a WebGL stage (PixiJS) instead of layered page elements: poses blend instead of snapping, the gun arm overshoots and settles after recoil, the boss crouches into its telegraph before it strikes, and impacts freeze for a beat inside the phase. Same sprites, same pacing, same outcomes — only the motion changed. Devices that can't create a WebGL context keep the previous stage automatically.
- **Boss fights play on the main stage now** — the boss stands on Home's stage while you prep, and the fight itself plays up top where you're already looking, boss HP plate riding the stage. The encounter panel below keeps boss selection, stances, and the result. (The stage had been stuck on the roaming picture during boss fights — that wiring is fixed, and a regression test now guards it.)

- **The Field Manual is the wiki now** — the Hunter tab's manual renders this game's actual wiki pages natively, in the rig's own instrument styling: every page bundled with the build, pictures loading only when a page opens, body-text search across all 35 pages, and links that walk you page to page. The old guided tour is retired — the manual it pointed at is the real thing now.
- **Gear rows lead with level** — inventory rows now open with the item's level as its own column, the element badge sits in open space beside the item's picture (nothing rides on the art itself), and long names wrap to two lines instead of truncating. The compare button finally pairs properly: tap one item's compare button to arm it, tap another's to open the side-by-side — the button also answers taps in its neighborhood now, and shows an amber armed state with a hint bar while it waits.
- **Sorting tells the truth** — the inventory sort menu groups its options: general sorts (rarity, item level, newest, name, and more) above per-kind sorts drawn from real stats — weapon DPS that is genuinely DPS, shield HP, ordnance payload, class-mod node boosts, relic values. Picking a kind sort scopes the list to that kind, with a one-tap return to everything.
- **Gear opens fast** — row art now composes as it scrolls into view instead of all at once on open: the same pictures, byte for byte, without the cold-open stall.
- **The Loadout header carries the vehicle** — Loadout's vehicle is a button in the panel's top-right corner, the bottom vehicle strip is gone, and the consumable belt's rules live behind a small **?** beside its label instead of taking up the page.
- **Bulk scrap dismisses on tap** — confirming a bulk scrap clears the selection instantly; the payout lands when the server answers, and a failed batch restores every item.
- **A workshop jam is fixed** — finishing a crafted skin part could jam an account's workshop so every visit errored. The jam is cleared: stuck cosmetic parts now deliver as cosmetics, no gear is minted from them, and one bad row can never block a whole workshop again.

## 2026-11-05 — Standings becomes a telemetry deck

- **Standings reads as instruments now** — the page behind the Hunter tab's Standings door is rebuilt as a telemetry deck: squared rack panels, inset readout wells, and lamps instead of cards. The settlement record leads with a lit **PAYOUT · AUTO — NO CLAIM** lamp over the same promise as always — race rewards pay themselves at settlement; the record just shows what landed, with totals in a readout bank. The global board's channel selector now prints **your rank on every channel** for the period you're viewing, each row carries its movement against the previous reading and a meter against the leader's value, and your own reading pins to the foot of the board when it falls outside the rows shown. The weekly races run as numbered channels, and last week's finals archive in their own panel. Nothing about the numbers changed — same boards, same races, same settlement — only how they're read.

## 2026-11-05 — What's yours, claimed by hand

- **Your streak pays when you claim it** — the daily login streak no longer pays out on its own when you open the game. The day's reward waits on Home behind a real **Claim** button; tap it and the celebration shows what you actually got. Leave it unclaimed and the reward expires at the day rollover (00:00 UTC) — the streak day itself still counts either way.
- **Offline earnings wait for you, too** — what your hunter earns while you're away is no longer paid out silently the moment you open the game. It is held, and Home's offline button shows the true held amount; tap it and the Return Sheet pays exactly what accumulated, exactly once. The math is unchanged — same windows, same caps — only the paying moved to your tap. Home's top also trades its repeated level block for two honest buttons: your cache keys ride on the cache button as a count bubble, and the level display becomes a real progress bar showing how far into the level you are.
- **Numbers move where you can see them** — when a counted resource in the top bar rises — credits, scrap, keys — the counter pulses as it climbs, so gains never happen silently; drops stay quiet. Two things that used to happen without a word now announce themselves on Home: a **Sold** chip when one of your market listings sells, showing what you actually netted after the fee, and a **Bench ready** chip when a bench job finishes.
- **The Workshop lives on Home** — crafting has moved in full to Home's Craft mode: recipes, the queue, collecting, banked bench time, and repair and service jobs all work there. Gear drops its Workshop stop for a slim bench status strip — running, queued, and ready counts — that taps through to the bench, and the Garage still starts repairs, with its status and a door to Home's bench alongside. The bench itself is untouched: same jobs, same timers, same payouts.
- **Auto-salvage actually salvages now** — the Settings rule used to save politely and do nothing at all. It is now kept on your profile and enforced by the server, on roaming claims and offline settlements only: a drop at or under your rarity ceiling and quality cap is recycled the moment it lands, at exactly the manual salvage payout, Scavenger bonuses included. The ceiling stops at Epic — a Legendary can never be auto-salvaged at any layer — and boss loot, cache contents, market goods, and crafted items are never touched, nor was anything already in your bag. The Settings card also gains the On/Off and Scrap/Materials switches it always should have had.
- **The market is players only** — the seeded NPC stock is gone from Buy and Sell for good: every listing in the lane is another player's, the seed that stocked it is removed, and accepts of NPC listings are refused outright. When the seed retired, the live shelf held eleven seeded listings and no player ones; the lane now shows the market exactly as it is. Seller labels follow the seller, so a player re-listing gear they bought from the vendor reads as a player listing, as it should. The vendor's own shop is unchanged.
- **The cache reveal is one page** — opening a cache no longer cuts away to a second screen. The reveal moment plays exactly as it did, and as it settles, the full stat deck docks below it on the same page: DPS, every affix written out rather than counted, a legendary effect's name and its description, class-mod bonuses by skill name — the same deck the Gear inspect sheet shows, drawn from the same source, so the two can never disagree. Open Another and Collect sit below the deck.
- **Under the hood** — a set of roaming-claim tests that quietly depended on the calendar (they broke the day the hot area rotated) now pin their clock; claim payouts themselves were verified correct throughout and did not change.
- **Papercut pass** — the Field Manual's tour tells the truth now: every roaming area is open from Level 1 (the danger rating is a warning, never a wall), and boss attempts are deliberate — you open Boss Prep and launch them yourself, roaming never triggers one. The cache reveal card and the stat deck print crit the same way, from one formatter, so the same weapon can no longer read 10.3% in one place and 10% in another. Standings rows label what they count (kills, credits, K/D at two decimals) and the selected board reads as selected. A boss-verify request with a missing difficulty stance is refused cleanly instead of erroring, and the vendor answers "Not offered by the vendor today" — its stock rotates daily — instead of claiming an item doesn't exist. Ironwood finally gets its "an" wherever copy names a maker.

## 2026-11-05 — The Hunter tab becomes a menu

- **The Hunter tab opens on a menu, not a rail** — the row of stop chips is gone. The tab now leads with a hero plate carrying your level, XP, and whatever is waiting — skill points to spend, race rewards banked, your research course and its progress — above a set of boss-arena plate doors that print their own live status. The **Skill Trees** door leads: a progress ladder per tree and your unspent points as a big gauge, right on the door. Research heroes your course progress, Standings carries the count of race rewards you haven't seen yet, and Collections shows your legendary cores. The **Wardrobe** gets a door and a room of its own at the foot of the menu, and your full profile — trophy shelf, lifetime record, totals & sources — sits behind the wide **Profile & Record** door. The Skill Trees behind their door wear the same plate look, points and respec included. Nothing moved house: every stop the rail carried is behind its door, one tap in.
- **Home tells you when skill points are waiting** — a chip under Home's claim row appears while you have unspent skill points and says how many; tap it and you land on the trees. It disappears the moment every point is spent.

## 2026-11-04 — Your hunter fills his stage

- **The Loadout hunter stands tall** — on the Gear page, your hunter used to shrink to about a third of his stage so the whole of a long gun fit inside the frame. The figure now fills the stage: the hunter is the subject, and a long weapon runs past the frame's right edge like a portrait, grip and receiver in view. Equipping or clearing a weapon no longer changes his size, and wide stages elsewhere in the game render exactly as before.

## 2026-11-04 — Elemental Coating can be made

- **Elemental Coating joins the bench** — the coating existed in the game's files with no way to earn it: no recipe, no vendor stock, no rotation. It now crafts at the bench like the other elemental ammo — Scrap, Ballistic Parts, and Void Essence, twenty minutes a batch — as the ungated baseline beneath Prismatek's gated Prism Coating. Its quality rolls like every crafted consumable, and quality now genuinely deepens its shield and armor break in a boss fight: the numbers were printed on the item before, but the fight never read them. It stays off the vendor's shelves and off the player market — if you want one, you make it.

## 2026-11-04 — Every screen reads the same hunter

- **Gear shows everything you own** — the Gear tab now lists every item on your account: the Starter Pistol, roaming drops, cache finds, and boss loot alike, with the starter in its slot from the moment you collect it. Drops earned while roaming appear in your inventory as they land.
- **One DPS, everywhere** — Home, the Gear header, and your slot cards all print the same DPS figure for your loadout. Boss surfaces price that same loadout against the boss in front of you and say so on the label: the picker's **Your DPS vs Tyrant** chip and the prep stage's **Eff. DPS** are the same number.
- **Danger warnings price your real loadout** — area warnings run their duel math on the gear you actually have equipped. A fresh hunter holding the Starter Pistol reads Dustwaste Frontier as the starter area it is, not a death sentence.
- **Profile, honest in the small** — K/D no longer prints 0.00 next to a deathless record (no deaths yet reads **—**); **Active Time** accrues your real foreground play; Hunter level/XP and Mastery XP/levels sit in their own labeled groups, as the separate systems they are; Wardrobe craftable rows print each part's real craft time; and a Trophy Shelf weapon you currently have equipped carries its **Equipped** mark.
- **Kills credit the weapon that made them** — the server's kills-by-weapon and kills-by-element records now name the gun you were actually holding (primary first, then secondary, then heavy) instead of filing every kill under "unarmed." Kills recorded before this fix stay as they were — history isn't rewritten.

## 2026-11-04 — One bench, and builds that staff your contracts

- **Home, re-stacked** — the mode rail (Area · Roam · Boss · Endless · Extract · Craft) now runs above the stage, and the consumable belt takes the rail's old spot directly under the stage, above the workspace: your modes lead the screen, and your loaded consumables sit between the rundown and the panel.
- **One bench** — the Workshop's three benches are now a single bench that is simply yours. The old workshop tools did not vanish: they joined the relic family as permanent, equippable relics with their effects intact, and the Lab's quality touch survives as a top-end crafting relic. Anyone who owned a second or third bench was refunded in full.
- **Bench time** — watch a rewarded ad in the app to bank an hour of bench time, up to 24 hours banked. While time remains, the bench runs 3 jobs at once with 15 queued; the bank drains only while the extra lanes are working, and running dry never interrupts a job mid-craft.
- **Dispatch: start from a build** — staffing a contract no longer means re-ticking the same spare set by hand. Pick an offer, tap one of your saved builds, and its dispatchable gear (or its vehicle, for courier work) arrives pre-picked. Anything that cannot go — equipped, listed, out on another contract, tied up in a service job, or gone since the build was saved — is named with its reason and how to free it. The build itself stays a simple list: starting from one equips, reserves, and sends nothing.
- **Builds have a face** — saved loadouts are called builds everywhere now, and every build carries a pixel glyph you pick yourself from the game's glyph sheet (existing builds start with the gun mark). Your glyph rides the build chip, the Saved Builds sheet, and the report that confirms an apply — a build is recognizable at a glance, not just by its name.

## 2026-11-03 — Profiles, the Gear Split, and the weapon marriage

- **Showcase your hunter** — pin up to three favorite weapons on your Trophy Shelf, tap any hunter in the weekly Standings to open their profile, and read the full record in the redesigned profile pop-up.
- **The Gear page, merged** — Loadout and Workshop share one page in the Split layout: hunter and guns on one side, accessories beneath, the Garage in place, and weapon names that print in full instead of trailing off.
- **Workshop: Make-now first** — the Workshop opens on what you can craft right now, with one-gate-away and locked work below it, and every card carrying its real costs up front.
- **The weapon marriage** — every weapon card in the game is now drawn by one pixel system from the gun itself: its maker's design language, its element lit along the barrel, its own rolled parts. Legendary weapons resolve to their bespoke art on every surface, audited type by type so a legendary's art always matches the weapon it drops as — and the old vector weapon renderer is retired.
- **Your hunter holds your gun** — the Loadout-stage hunter visibly carries the equipped weapon, fitted to the stage instead of clipped by it.
- **Streak, celebrated properly** — the login-streak reward lands as a poster plate while your credits tick up in the Strip; a claimed day reads honestly, with nothing left to "claim" by hand.
- **The market stays player-run** — NPC stock in Buy is basic Common gear only, in every kind; anything above Common is another player's listing.
- **Gates keep falling** — consumable recipes no longer ask your level: meet the bench, the research, and the materials, and the job queues.
- **Sign-in, in the game's own art** — the sign-in banner is now a pixel wasteland landscape. Behind the scenes, product analytics (GA4) landed to watch retention and the core loops.
- **Bosses show themselves** — boss prep now opens on a portrait plate of the boss itself, standing on its own arena, with its weakness chip and mechanic up front; the picker rows, the fight header, and the defeat screen carry the same creature at every size. The old letter-emblem badges are retired.
- **Data Slots is gone** — the vendor's slot machine has been removed: the Market rail is back to six stops and the Home deck loses its Slots card. Pulls were always settled on the spot — wager in, prize out, in the same moment — so no player had anything stored with the machine, and nothing was owed or lost in the removal.

## 2026-11-02 – 2026-11-03 — The evening batch: every "no" explains itself

- **Every blocker carries its remedy** — across the service boards and beyond, a control that refuses now says why and what would unblock it: the missing material, the exact shortfall, the door that fixes it.
- **Areas are open** — level locks on roaming areas are gone. The picker warns with real duel math — how fast you would kill, how fast you would fall — and always lets you roam anyway.
- **Vehicles are pure market goods** — no equip level at all: if you can buy it, you can drive it, and the Garage shows only what you own.
- **Cosmetic gates fall too** — the first gate-removal step stripped level requirements from cosmetic recipes.
- **Batch salvage** — scrap a whole pile in one pass behind a rarity-threshold sheet: one settlement, one summary, and Legendaries never bulk-salvage.
- **The stage, rebalanced** — the area plate leaves the scene, your effective stats ride a band on the stage, Home event pop-ups shrink to headline cards, and returning to the app lands you instantly back in your live action.
- **Standings tell the truth** — weekly race rewards were always auto-paid; the panel now shows your weekly earnings instead of pointing at a claim that never existed.
- Also: the Gear grid's List→Grid freeze is fixed.

## 2026-11-02 — Skins wave 1 and the drift-fix pass

- **Skins wave 1** — cosmetic skin parts are craftable from scrap, equippable in the Wardrobe, and tradeable on the market once unequipped; social renders of your hunter wear them.
- **The drift-fix pass** — five composition fixes folding scattered chrome into the game's one-strip, one-stage language: the resource Strip, stage-first Home, listings-first Market, the Hunter identity panel, and the Gear constellation with the Garage in place.
- **A pure player market for weapons** — NPC vendor weapons left the Buy/Sell lanes entirely. The vendor keeps its staples; weapon prices are set by players alone.
- **The new icon** — the app icon is the cache itself, cracked open with gold light on vibrant rust.
- **On the stage** — Action controls float on the stage (the controls row is gone), and the foreground sync now runs on the game's own 3-second tick.

## 2026-11-02 — The art lands: A10, parts, and the character rebuild

- **A10: the finished art** — all 122 placeholder sprites replaced with finished pixel art: hunters, enemies, bosses, gear — the works.
- **The parts character** — the hunter is rebuilt on a parts system: an empty frame that gear and skins replace over, part by part. It is the foundation skins and loadout rendering now stand on.
- **Legendaries keep their word** — a legendary drop is constrained to the weapon type its bespoke art depicts; the art and the item always agree.
- **Endless is a fixed ladder** — the same depths for every hunter, re-anchored so a stronger hunter tears through the early depths by being stronger.
- **The record completes** — your profile now tracks lifetime deaths, credits earned and spent, and kills by element.
- Also under the hood: the hunter carries only the equipped weapon, cache crates rise only for real cache grants, boss encounters and the roaming ledger received server fixes, "Tech Fragments" is simply **Tech** now, and corner badges meet the 11px floor.

## 2026-11-02 — The four-tab redesign

- **Four tabs** — the app reorganized around Home, Gear, Market, and Hunter: Home merges the Board and the Action stage, Cache Rank folds into Hunter, and every screen carries a rail of stops inside its tab.
- **Motion, Wave D** — claim pulses, Market stop transitions, and list entrances give the new layout its movement.
- **Post-QC fixes** — the playtest's findings landed the same day: a Standings profile crash, dead rail stops, a string-hygiene sweep, layout sizing, affordances, and the papercut pile.
- Under the hood: the design document itself was repaired and completed, so the system the redesign follows is written down whole.

## 2026-11-01 – 2026-11-02 — The runway: resources, boards, and icons

- **Resources join the market** — Cache Fragments, legendary cores, and essences are sellable on the player market like everything else in your inventory.
- **Service boards grow up** — the Repair and Shield-Tech boards get the market's full browse toolkit: filters, sorting, search, and a card face that prints what each job needs from you.
- **Pixel icons** — the 52-icon pixel foundation lands, purging emoji and glyph iconography from the interface.
- **The wiki grows tables** — Wiki Phase 3: the Reference annex is generated from the game's own constants and gated against drift in CI.
- Under the hood: the design system was locked in as DESIGN.md and PRODUCT.md — the conformance rule every later slice in this changelog followed.

## 2026-11-01 — The wiki, phases 1 and 2

- This wiki: first a full set of skeleton pages for every major system, with the publish pipeline that keeps the wiki synced from the game repo — now filled in with complete player guides for getting started, the Board, progression, leaderboards and streaks, and the start and meta systems.

## 2026-11-01 — Expansion run 2, plus the Board redesign

- **Research** — a parallel education track: enroll in timed courses beside your main action for permanent bonuses and scholarship mastery.
- **Contracts Board** — rotating daily and weekly work orders with claimable rewards, now surfaced from the Board's top bar.
- **Manufacturer Standing** — six independent reputation ladders, one per manufacturer.
- **Shield-Tech services** — a recalibration board plus a self-service lane for shield work.
- **Data Slots** — the vendor's slot machine, with three bet tiers.
- **Guest visibility** — guests now see everything with real data (market, boards, standings); only transacting asks for sign-in, and guests craft freely.
- **Dashboard top redesign** — the level button carries your XP progress bar, and the streak and contracts icons sit on the top bar with pop-ups and claimable badges you can see without scrolling. The while-you-were-away recap moved into the level sheet, and short absences under five minutes no longer pop it up.
- Also in this stretch: the daily cache box lane (one free box a day, up to ten a day in total), the daily login streak, and weekly leaderboards all landed as part of the expansion program below.

## 2026-10-31 – 2026-11-01 — The 32-unit expansion run

The largest single expansion in the game's history, landing across one weekend:

- **The post-campaign game** — six new post-campaign bosses, [[Endless Mode]] with depth records, [[Collections]] with legendary cores, and a trophy-shelf profile.
- **Occupations grow up** — crafting as a full timed occupation with benches and gear frames, Extraction, Dispatch missions, repair services on an open board, and a Reforge bench for rerolling affixes.
- **Build depth** — the Fixer skill tree (the fourth tree), per-tree action skills, Cache Rank's permanent level-earned bonuses, shield behaviors, and keystone skills.
- **World systems** — vehicles as real gear with fuel and condition, a deeper player market with price intelligence, a rotating vendor with an Item of the Day and buyback, and live economy tuning behind the scenes.

## 2026-10-30 — Phase 0 truth pass and the pacing baseline

- **Truth fixes** — the boss loop wired end to end, one consumable contract across roaming and offline play, one HP formula, server-recorded deaths and resurrection, respec made reachable, and mastery fed by real play.
- **Pacing baseline** — the XP curve stretched to its long-term shape (level 100 is a roughly two-year climb for regular play), the offline cap became earned by level, boss XP raised, and the 5% market sale fee introduced as the economy's credit sink.

## 2026-10-29 – 2026-10-30 — Pixel conversion and the Route B move

- **Pixel art conversion** — the game's art rebuilt as pixel art in five waves: the asset pipeline and Dustwaste diorama, hunter movement and boss fights at the new pacing, the loot moment (rarity beams and drop cards, with the full legendary treatment), bespoke legendary weapon sprites, and pixel weapons across inventory, market, and workshop.
- **Route B** — the game moved onto its own server and database, with guest and Google identity handled in-house. Players kept their accounts and progress; the move is why sign-in is now Google and guest, with no third-party auth in between.

<!-- GENERATED from master merge history (git log, first-parent) via scripts/wiki-gen/changelog.ts, scripts/wiki-gen/changelog-ledger.json — do not edit by hand -->
<!-- wiki-gen:changelog-ledger -->
### Merge ledger

_Every pull request merged since 2026-11-01 (PR #262), recorded exactly as merged — 291 merges. This ledger is the completeness record behind the themed entries above it: if a merge shipped, it is listed here. Generated from master's merge history; see `docs/WIKI.md`._

**2026-11-13** — 1 merge

- #576 — fix(market): listings fetch propagates failures — X-07 error state reachable (#568)

**2026-11-12** — 53 merges

- #500 — fix(auth): guest→Google link promotes the account in place (audit A-01)
- #501 — fix(hunter): class-mod boosts no longer phantom-spend skill points (audit HTR-02)
- #502 — fix(chef): localhost previews resolve same-origin, never the production Chef (audit H-01)
- #503 — fix(hunter): majors/keystone charge their listed cost everywhere (audit HTR-01, migration 0089)
- #504 — Fix the Pixi roam enemy vanishing after its walk-in
- #505 — fix(session): chefClient transport refreshes once on 401 and retries (audit A-06)
- #506 — fix(contracts): reroll carries the claim's verified-account gate (audit A-03)
- #508 — fix(auth): linking a Google identity bound elsewhere refuses with a conflict (audit A-12)
- #509 — Bulwark torso: paint out the cyan chest slash (the #495 fix, second plate)
- #510 — fix(cosmetics): cc_cosmetics_view reads tier as the string union (audit G-F4)
- #511 — fix(vendor): sell quotes use the server-composed buyback rate (audit G-F3)
- #512 — Fix cache-decrypt hang: bounded transport + snapshot save off the reveal path
- #513 — fix(hunter): Totals' boss DPS + Shield Break come from the boss sim (audit HTR-05)
- #514 — fix(progression): level cap 100 in both XP implementations (audit HTR-06)
- #515 — fix(skills): two-step respec confirmation + zero-spend refusal (audit HTR-07)
- #516 — perf(hunter): render only the active Hunter stop (lazy sections)
- #517 — fix(auth): logout revokes with a reason; only rotated-token reuse nukes (audit A-05 partial)
- #518 — fix(routes): verified-account refusal is 403 on the gameplay surface too (audit A-04)
- #519 — fix(auth): bootstrap failure is a terminal state with Retry (audit X-08)
- #520 — fix(shell): keep tab screens alive + code-split screens (tab-switch latency)
- #521 — fix(market): load failures are retryable error states, never an empty market (audit X-07)
- #522 — fix(auth): sign-out and account switches clear the offline recap + local snapshot (audit A-08)
- #523 — fix(auth): web AuthScreen mirrors the lock prompt — no dead Google CTA (audit A-02)
- #524 — fix(home): occupation switches disclose the displacement (audit H-02)
- #525 — Shield remounts to the torso in aim/recoil (far-arm suppression follow-up to #498)
- #526 — fix(strip): remedy chip sizes to content; rundown shares follow the labels (audit H-04 + X-06)
- #527 — Gear list render fix: windowing, thumb-density row art, fitted-base cache
- #528 — fix(copy): trim paragraph-law violations; the scan now covers Home + Gear (audit X-05 + G-F7)
- #529 — fix(layout): the 11px type floor — named labels fixed, repo-wide census gate (audit X-03)
- #530 — fix(layout): the audited small buttons meet the 44px tap law (audit X-04)
- #531 — fix(android): exclude the session store from backups and device transfers (audit A-09)
- #532 — Boss telegraphs (C3): the special's wind-up warning on the fight stage
- #533 — WebGL context loss routes to the DOM fallback instead of freezing the stage (X-01/A-07)
- #534 — fix(hunter): Totals health labeled Effective HP; dead survival term removed (audit HTR-03 sub-fixes)
- #535 — fix(workshop): pause copy keys to the boss phase — prep is not a fight (audit H-05)
- #536 — fix(bootstrap): initial bundle fires once per session — in-flight join + settled guard (audit H-06)
- #537 — fix(garage): one derived yield — the card obeys the empty tank (audit G-F6)
- #538 — fix(market): stack per-unit label prints the exact price (audit M-2)
- #539 — fix(hunter): skill node art renders at its native 30px (audit HTR-08)
- #540 — fix(cosmetics): look resolution exposes missingParts (audit HTR-09)
- #541 — fix(endless): Chamber failure strip gains a Retry (audit X-09)
- #542 — fix(auth): gate table stops denying guests the view (audit A-11)
- #543 — fix(web): boot fallback says 'You're offline' offline (audit A-10 partial)
- #544 — fix(auth): in-memory store refuses owned-email identity create (audit A-13)
- #545 — fix(market): Cancel Listing drops the transact guard (audit A-14)
- #548 — docs(mechanics): M-3 — market listing carries the 25-scrap deposit
- #553 — fix(stats): HTR-04 — Hunter crit display shows the fight number (primary + skill nodes)
- #554 — fix(auth): hunter-name prompt defers — play first, ask when it matters (audit G-F5)
- #555 — HTR-03: one canonical HP pool — Thick Skin into roaming, offline gate multiplier removed
- #556 — Audit fixes: smoother Home motion, paused hidden stages, accurate displayed numbers
- #559 — fix(cache): cache reveal's settled deck presents — stage yields its height when the moment ends
- #563 — fix(manual): Links LCD test waits on the corpus, not a stale census pin (issue #551)
- #565 — fix(chef): seed the roaming combat rolls — de-flake the Med Kit (Refined) contract check (#552)

**2026-11-11** — 16 merges

- #484 — Boss setup-diversity (slice C2): mechanic legs collect + Bishop composite; CryoAmmo re-read measured and dropped
- #485 — INT-7: Top-Choice cache screen — painted crate, opened ignition frame, buried prop swap
- #486 — INT-9: painted masters for nav sigils, calendar hero, drop-rise markers
- #487 — INT-6 Vistas go plain: the 8 master paintings ship whole, band system retired
- #488 — Top-Choice INT-8: chrome + brand integration (Wave 14)
- #489 — INT-5: Top-Choice vehicles + set pieces — adopted paintings ship
- #490 — INT-3 (hero): adopted Wave 8 painterly part masters at 4x definition
- #491 — INT-1 Weapons: adopted Top-Choice paintings — production sprite layer + wiki re-point
- #492 — INT-10 (icons): the functional paintings — fixed set + baked state variants
- #493 — INT-4: Top-Choice consumables + materials land; Cache Fragment deleted
- #494 — Top-Choice INT-2: gear renders as adopted paintings (shields, relics, class mods, ordnance)
- #495 — SI torso: paint out the cyan chest slash (reads as a third arm)
- #496 — Painted weapon renderer — Top-Choice paintings as the weapon render (renderer slice)
- #497 — Aim/recoil poses: far arm braces under the gun arm instead of dangling
- #498 — Suppress the far arm in aim/recoil: strict side view draws one arm
- #499 — Reveal Corona: physical light in the cache loot moment (Impeccable direction A) + header law

**2026-11-10** — 15 merges

- #469 — Anim-replay loop: deterministic replay + B2 metrics + CI workflow (Track A baseline)
- #470 — Anim fix iteration: enemy approach + walk articulation, stride saturation, loop-instrument repairs
- #471 — Vehicle chip on Home's Strip, right of the 7/7 (owner decision 2026-11-10)
- #472 — Tuning T4 — Boss first-attempt discount (D4/P10)
- #473 — Tuning T2 (D2): consumable magnitudes — ammo up, survival heals to % of pool, ordnance riders ×4
- #474 — Tuning T1R — Passive shield recharge (owner ruling 2026-11-10)
- #475 — Tuning T5 — Elite dial 12% → 18% (P2, owner ruling 2026-11-10)
- #476 — Tuning T6 — Overclock Serum (P6 tempo consumable, owner ruling 2026-11-10)
- #477 — Tuning T3 — scrap portfolio (D3/P7+P8): repriced recipe Scrap legs + 25-Scrap listing deposit [migration 0087, do not merge before live apply]
- #478 — Boss cadence C1: cadence engine + prep Attack Pattern block (owner D1–D8)
- #479 — Logo swap: adopt the Top-Choice re-render on every surface
- #480 — feat(branding): splash screens carry the adopted logo
- #481 — Resume device probe: lifecycle/WebGL/ticker instrumentation (DEVICE-PROBE-SPEC)
- #482 — Prism Coating ruling captured in ECONOMY.md; buried-cache retire stopped — asset is live
- #483 — Light kit: productionize the reveal's smooth light

**2026-11-09** — 2 merges

- #467 — AL-4: Activity Log full trace pass — every action leaves a record
- #468 — Owner ruling: one ad rail on every platform (iOS included)

**2026-11-08** — 12 merges

- #455 — V4 — the 26 bespoke legendaries join the authored grammar
- #456 — Changelog catch-up — V4 legendaries (#455)
- #457 — M4c — Presence: panel scenes inherit their vista; the stall cycle
- #458 — Favicon recompress — 374 KB → 143 KB (PR #446 logo treatment)
- #459 — Hero polish — the ranked list executed (Bulwark dome first), interior only
- #460 — Land V2 set pieces and seat wiring
- #461 — Motion M2a: FK leg resolver + stride spec
- #462 — ThrowTech heap polish — debris heap re-authored to the Dustwaste density standard
- #463 — Motion M2b — the travel beat + pan (Motion Reboot closes)
- #464 — docs: repair PRODUCT.md against post-2026-11-01 rulings
- #465 — docs: fix stale free-daily-cache line in DESIGN.md §3 (abolished by 0082)
- #466 — F6: Pixi roam stage enemy rig follows the current target

**2026-11-07** — 20 merges

- #435 — test(pixel): Pxl Craft Sweep S2 — lint gate (pxl semantics + banding) over 366 real renders
- #436 — feat(pixel): One Grammar — the stage holds the card render (held mode); pixel path retires from the stage
- #437 — Hero Pass H1: head-system unification — maker helms delisted to the Standing lane, Hood re-authored
- #438 — Motion Reboot M1: the work cycle — bench modes work the bench
- #439 — docs(wiki): Changelog catch-up — 2026-11-07 entry for #435
- #440 — docs(wiki): Changelog — One Grammar, work cycle, maker-helm lane
- #441 — Migration 0086: retire maker-helm recipes from the craft catalog (H1 follow-through)
- #442 — Pxl Craft Sweep S4 — small items unified onto one core + thumb form pass
- #443 — S5: authored bases pilot — the sniper (Pxl Craft Sweep)
- #444 — Pxl S3: gear-engine craft pass — selout, broken-edge toolkit, wear ladder, Absorb rewrite
- #445 — Hero pxl ship: converted character lands (38 sprites), palette unification, death sprites deleted
- #446 — V5 small fixes: logo recompressed, AreaBackground + SVG fallback diorama deleted
- #447 — Bench slice: V2 bench re-author + M4b item-on-the-bench (seat, rise, salvage beat)
- #448 — SVG closure: last vector surfaces to pixel, fallback diorama killed
- #449 — S5 scale-up batch 2: authored bases — launcher + beam (Pxl Craft Sweep)
- #450 — Weapon authored bases, batch 1: Pistol, SMG, Shotgun (S5 pattern)
- #451 — Motion Reboot M2: Home ROAM stage on Pixi (pilot standard)
- #452 — Motion M4a — extraction works the site: sift cycle + settled finds rise on the main stage
- #453 — Motion Reboot M3: endless fights come home to the main stage
- #454 — V1 Vista Landing — authored vistas replace the zone paintings (bands + pan + ambient, camp idle)

**2026-11-06** — 10 merges

- #425 — Fix cosmetic-craft workshop brick: migration 0085 kind filter + finalizer defense
- #426 — Field Manual: the repo wiki, rendered natively in-app (guided tour retired)
- #427 — Changelog 2026-11-06 — Field Manual, gear rows, workshop jam fix
- #428 — Claim-overlap guard: overlapping claim windows pay only the unsettled suffix
- #429 — Pixi Motion Pilot: WebGL boss fight stage (DOM fallback kept) — DO NOT MERGE, owner video approval pending
- #430 — Changelog: Pixi boss stage (for #429)
- #431 — fix(boss): the boss fight's home is the main stage (One-Stage Law, F5 closed)
- #432 — Changelog: boss fights on the main stage (for #431)
- #433 — feat(pixel): pxl craft sweep S1 — hue-shifted ramp root, selective outline, dead sheen lift deleted
- #434 — docs(changelog): item-art depth entry for S1 (#433)

**2026-11-05** — 34 merges

- #386 — Daily login streak: TRUE CLAIM — record holds, tap Claim pays (migration 0079)
- #391 — The Trade: equip comparison in the inspect sheet + class-mod truth fix
- #393 — Pure player market: Buy/Sell are solely player listings (supersedes #317)
- #394 — Market compact list rows — Buy/Sell one-line treatment (Gear list sibling)
- #395 — Cache reveal: one page — stage stays, full stat deck below (no phase swap)
- #396 — Changelog: 2026-11-05 entry (streak claim, pulse, pure market, one-page reveal)
- #397 — Cache lane rebuild: daily budget dies, fragments abolished, keys are the only cache currency (migration 0082)
- #398 — Fix combat-stats saves dying on fractional play seconds (bigint)
- #399 — Playtest papercut batch — nine verified items (copy, formatting, error truth) + migration 0084
- #400 — Home two buttons + offline earnings HOLD-AND-CLAIM (migration 0083)
- #401 — Hunter tab: Arena Plates menu (owner pick A)
- #402 — Fix claim row crushing CACHE/OFFLINE in badged states (wrap + content floors)
- #403 — Claim row goes icon-only on one line (owner ruling, supersedes #402 wrap)
- #404 — Collections in Register B (Instrument Panel) — Hunter sub-page real build
- #405 — Profile & Record in Register B — Service Telemetry (Instrument Panel)
- #406 — Hunter Research stop — Instrument Panel register (owner pick B)
- #407 — Cache Rank in the Instrument Panel register (owner pick B)
- #408 — Standings in the Instrument Panel register (owner pick B)
- #409 — Wardrobe in Register B — The Fitting Console (Instrument Panel)
- #410 — Claim row design fix: one instrument rail, 26px hero icons in their keys' accents
- #411 — chore: make the TypeScript gate real — triage 530 latent app errors (node 204, server 64)
- #412 — Fix Workshop bench cause bar NaN — real progress + recipe label (F7)
- #413 — F2: fragment refusal carries a real error code in the Pg write store
- #414 — Fix Standings channel crash: units from canonical LEADERBOARD_METRIC_UNITS (F4)
- #415 — fix(F3): cache-key remainder round-trips through the gameplay stores
- #416 — Fix cache-rank golden beam: add the missing GRAMMAR.beamWidthPx.low tier (F8)
- #417 — fix(auth): F1+F6 — restore auth failure-path diagnostics (triage #411)
- #418 — Redraw the streak flame glyph so it reads as a flame at 20px
- #419 — Give the daily streak its own icon: a pixel calendar
- #420 — Bulk scrap: dismiss on confirm, settle in the background
- #421 — feat(gear): grouped inventory sort taxonomy with kind scoping
- #422 — Loadout de-texting: vehicle header button, belt ? hint, no-paragraphs law
- #423 — perf(gear): viewport-deferred art composition for inventory lists
- #424 — Gear list row V1 (LV column, bare art, badge beside thumb) + compare button fix

**2026-11-04** — 18 merges

- #372 — Econ 9: bench collapse + relic merger (migration 0073)
- #373 — SB-3: dispatch Start from a build — prefill + flag report
- #374 — SB-2: Builds identity — presets→builds rename + §7 pixel glyph per build
- #375 — Econ 10: bench time — banked hours widen the bench (migration 0075)
- #376 — Home rail swap: mode rail above the stage, belt in its vacated slot (owner ruling 2026-11-04)
- #377 — Gear/DPS/Profile truth fix — one read model, one DPS, honest Profile
- #378 — 0076: cc_record_kill_stats kill attribution reads the real weapon slots
- #379 — Elemental Coating: crafting recipe (0077) + boss-sim break wiring
- #380 — Wiring package: boss sim reads consumable defs + Grenade merge + Rush Ticket repair scope (migration 0077)
- #382 — Consumable item art: real pixel sprites for all 43 types (runtime compositor)
- #383 — Fix Gear tab freeze: compositor caches could never hit (compose ran before the cache lookup)
- #384 — Home stage + mode rail rework: Roam is the area door, Stop takes the stage corner, one-stage law for Extract
- #385 — feat(gear): true compact list view — one line per item, 46px rows (owner ruling 2026-11-04)
- #387 — Gear doll fit: the hunter fills his stage (frame-fit, not armed-extent)
- #388 — test(claim): pin route clock in amount-pinning claim tests; add deliberate hot-area payout pins
- #389 — Crafting consolidation: the Workshop lives on Home (owner ruling 2026-11-04)
- #390 — feat(strip+announce): pulse-on-increase + Sold / bench-ready announcement chips (eye-leading pass)
- #392 — Auto-salvage: profile-owned rule, Chef claim-settlement enforcement (migration 0080)

**2026-11-03** — 58 merges

- #310 — feat(stage): the ribbon becomes the effective-stats band (+ Loadout door)
- #315 — Foreground resume: land instantly back in the live action
- #316 — Areas: remove level locks — duel-based danger warning instead of a wall
- #317 — Market scope: NPC Buy presence is basic/Common-only across all gear kinds
- #318 — Profiles: hand-pinned Trophy Shelf, reachable hunter profiles, redesigned pop-up (migration 0058)
- #319 — feat(gear): the merged Gear page — Exec C, the Split
- #320 — Weapon pixel program slice 1 — the marriage: card-density compositor with FORGE grammars, all card surfaces wired
- #321 — Streak poster plate: celebration rebuild (direction A + wallet tick) — audit D1–D7
- #322 — Analytics: GA4 via Firebase Analytics — screens, core-loop events, retention plumbing
- #323 — Sign-in banner: pixel-art wasteland landscape replaces the procedural SVG hero
- #324 — Gate-removal step 2: consumable recipes lose their player-level requirements (0057)
- #325 — Loadout truth: the hunter holds the equipped weapon — armed actor fits its stage width
- #326 — Workshop redesign Direction A — Make-now first
- #327 — Weapon pixel slice 2: legendary parity audit + wiring (24 agree, 1 owner-ruled, 0 open)
- #328 — Weapon marriage slice 3: retire the legacy SVG weapon renderer
- #329 — Gate removal step 3: research courses drop hunter-level prerequisites (migration 0059)
- #330 — Wiki wrap-up W1: Research, Dispatch, Contracts pages
- #331 — Wiki W2: Changelog backfill (Nov 2–3) + Phase 4 automation — merge ledger & staleness tripwire
- #332 — Wiki W4: image pipeline + legendary plates pilot
- #333 — Wiki W3 — freshness fixes (areas law, Shield-Tech gate wording, Crafting recount, Economy ranks)
- #334 — Gear marriage slice 0 — shared gear compositor core
- #335 — Wiki W5: illustrated Reference — weapon frames, element reads, gear, consumables, materials
- #336 — QB-1: Quick-Buy server fill + the Workshop pop-up (migration 0060)
- #337 — Gear marriage slice 2: ordnance to pixel (form = effect class)
- #338 — Gate-removal step 4: bench unlocks drop hunter level — price + materials are the gate (migration 0061)
- #339 — Gear marriage slice 3: class mods to pixel (4 tree grammars, Fixer family, nodeBoost pips)
- #340 — Gear marriage slice 1 — shields to pixel (behavior grammar)
- #341 — Gear marriage slice 4 — relics to pixel (name-form grammar)
- #342 — feat(wiki): W6 — illustrated world (bosses, areas, vehicles, skins)
- #343 — Gate-removal step 5: dispatch courier tiers read the class tier index (G7, migration 0062)
- #344 — Wiki W7 — UI plates + Getting-Started depth pass (wrap-up complete)
- #345 — Quick-Buy QB-2: + sheet on Repair Board, Shield-Tech Board, and Garage
- #346 — Gear marriage slice 5 — retire the SVG island (final gear slice)
- #347 — Gate-removal step 6: offline cap re-carried to Research (+ extraction rider)
- #348 — Quick-Buy QB-3: dispatch fuel line + boss/endless belt mounts
- #349 — Economy slice 1 — Silver Tongue fee floor (uplift clamped to the fee)
- #350 — Economy slice 2 — delete dead cache scaffolding (cc_draw_item + second/third-drop tables, migration 0065)
- #351 — Economy Slice 4 — production law-fixes (§9): catalyst wired, tools permanent, furnace lever live, batch comment truth
- #352 — Relic SALVAGE adoption — broken-tone forms, wear budget, rubble footprints (relic-salvage-v2)
- #353 — Economy slice 3: salvage previews quote the live award
- #354 — STUFF: the materials pixel system — formed objects for all 26 goods, ResourceIcon deleted (C-2)
- #355 — Fodder HP plate lift — in-stage, level with the hunter plate (owner device ruling 2026-11-03)
- #356 — Econ slice 4 follow-up: re-pin 0067 settler parity + dropped-signature guard (test-only)
- #357 — Fix idle tick desync after offline settle (F1+F2) — claims land within one cycle of return
- #358 — Item-moment reveal: the item rises through radiating stepped light, stat deck lands staged
- #359 — Quick-Buy QB-4: tint Chromaweave + reforge core mounts
- #360 — AL-1: drop receipts — the game records what drops, where, and at what odds (recording only)
- #361 — Econ 8: dispatch board reroll — credit-priced re-deal of the daily slate (§7.3, migration 0068)
- #362 — Saved Builds SB-1: truthful build apply — one server op (cc_apply_build, 0066)
- #363 — Boss identity: the Arena Plate — the boss presents itself (C-4)
- #364 — Economy slice 5 — the Scrap Merge (brief §3): one tradeable Scrap, migration 0069 draft
- #365 — Home consolidation — hero rundown, Next Move, belt-row bike chip, icon-only stage controls (HELD FOR OWNER REVIEW)
- #366 — AL-2: Activity Log read API (GET /api/activity-log/me)
- #367 — Econ 6: vendor drops Scrap + scrap meters (0071)
- #368 — Econ 7: the per-recipe Scrap-cost lever (economy brief §4)
- #369 — AL-3: Activity Log screen (stream, receipts + odds sheet, two doors)
- #370 — Slots removal: Data Slots deleted end-to-end (migration 0074)
- #371 — Home feedback fixes: Next Move removed, two-row rundown with percentage-over-base deltas

**2026-11-02** — 44 merges

- #270 — feat(market): Market v2 — rail of stops, Rep Desk weekly claim surface, seller hunter names
- #271 — feat(home): Home composition — §4 order, mode rail, Weekly claimables, Return Sheet
- #272 — fix(market): rail conforms to DESIGN §2 (7 stops, Sell segments) + tab→stop deep-link for Slots
- #273 — feat(gear): Gear v2 — rail of stops, Garage as a stop (F1), real affixes on cards
- #274 — feat(motion): animation polish — ClaimPulse on claimables, Market stop transitions, list entrances; Sample-B untouched
- #275 — fix(qc): Standings profile crash (null K/D) + Home mode rail switching/dismissal
- #276 — fix(qc): string hygiene — human labels everywhere, respec copy truth, wrap-not-clip
- #277 — fix(qc): layout — strip container-fit, sheet content height, ticker lane, Buy card wrap
- #278 — fix(qc): affordances — Research briefs, visible Spend, Collections masking, honest web sign-in copy
- #279 — fix(qc): papercuts — badge clipping, header collisions, diorama title, dev copy, search noun
- #280 — fix(pixels): loadout truth — the hunter carries only the equipped weapon
- #281 — Loot-visual honesty: the cache crate rises only for real cache grants
- #282 — art: replace 122 placeholder sprites with finished pixel art
- #283 — feat(profile): close the lifetime stat gaps — deaths, credits earned/spent, kills by element (0051)
- #284 — fix(chef): JSON-encode boss attempt loot for the applier — every boss start 500'd
- #285 — fix(legendary): S5 — legendary drops pin to the weapon type their art depicts
- #286 — chore(rename): TechFragments display name is now 'Tech' — internal id unchanged
- #287 — fix(ui): corner badges meet the 11px floor — badges bigger, floor unmoved
- #288 — feat(pixel): parts system M1 — parts model, anchor compositor, Standard Issue set
- #289 — fix(chef): JSON-encode roaming events for cc_record_roaming_events — Pg ledger writes silently failed
- #290 — fix(endless): the fixed ladder — depth-anchored encounters, growth retune, drop luck on milestone drops (0052)
- #291 — feat(parts): M2 — atomic surface swap to the parts compositor, old rig deleted
- #292 — Parts System M3: gear mounts on the parts actor + completed FX anchor chain
- #293 — Drift-fix F1 — the Strip: one-row resource bar replaces the six-card header
- #294 — Drift-fix F2: stage-first Home composition — slim plates + status ribbon, standby Roam panel
- #295 — New app icon: the cache, cracked open (owner-picked 2026-11-02)
- #296 — Drift-fix F3: Market composition — listings-first Buy, compact Vendor, compressed board/Slots chrome
- #297 — Parts M4: skin parts as craftables + wave-1 social renders
- #298 — Drift-fix F4: Hunter composition — trophy in the identity panel, one Now feed
- #299 — Drift-fix F5: Gear composition — loadout doll, tight constellation, wallet de-duplicated, Garage vehicle sprites
- #300 — Pure player market: NPC vendor weapons leave the Buy/Sell lanes
- #301 — Action controls float on the stage — controls row deleted (owner ruling)
- #302 — Action heartbeat 60s -> 1s foreground sync (owner cadence)
- #303 — Heartbeat cadence: align the Action sync to the 3s game tick
- #304 — Service boards: every blocker carries its remedy (assumption-gaps S2 + G8)
- #305 — Compact Home event pop-ups: headline-only cards, hero numbers
- #306 — Gear grid perf: fix the List→Grid switch freeze (memoized cards, no layout projection, shared defs once)
- #307 — Vehicles are pure market goods — no equip level gate, Garage owned-only, fuel/condition remedy clarity
- #308 — Stage overlay rebalance: area plate off the scene, controls top-left, HP plates at the actors' bases
- #309 — Standings earnings panel: fix the badge's dead-end (race rewards auto-pay; the record now exists)
- #311 — Remedy slice C: counters, buried guidance, dead-end empties (assumption-gaps G4/G5/G6/G7/G9/G10)
- #312 — Batch salvage: rarity-threshold sheet, one settlement, one summary (0054)
- #313 — Remedy slice B (G3): can't-afford Buy prints its shortfall; slots tiers print their reason
- #314 — Gate-removal step 1: cosmetic recipe level requirements removed (migration 0055)

**2026-11-01** — 8 merges

- #262 — docs: design lock-in — DESIGN.md + PRODUCT.md + AGENTS.md conformance rule
- #263 — feat(wiki): Phase 3 — generated reference tables, freshness gate, page-map check to fail mode
- #264 — feat(market): fragments, legendary cores, and essences become sellable (migration 0050)
- #265 — feat(ui): pixel icon foundation — 52-icon set productionized, emoji/glyph purge app-wide
- #266 — feat(market): service-board parity — filters, sorting, search, requirements on repair + shield-tech boards
- #267 — feat(hunter): Hunter v2 — Standings door with live badge, real Collections screen, rail arrangement
- #268 — docs(design): restore truncated DESIGN.md tail — §§7–11 (icon table, surfacing, motion, mock defects)
- #269 — feat(nav): four tabs — Home/Gear/Market/Hunter; Home merges Board+Action; Rank folds to Hunter standings
<!-- /wiki-gen:changelog-ledger -->

---

_Source of truth: `wiki/Changelog.md`, merged PR titles on `master`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
