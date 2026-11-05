# Changelog

Per-release notes for CyberCache, newest first. Entries are written by hand in the same PR as any release, grouped by day and theme. The merge ledger at the foot of this page is generated from master's merge history (Wiki Phase 4) and lists every pull request the entries summarize — and the freshness gate fails if a master merge ever lands without this page catching up, so the list cannot silently lapse again.

## 2026-11-05 — What's yours, claimed by hand

- **Your streak pays when you claim it** — the daily login streak no longer pays out on its own when you open the game. The day's reward waits on Home behind a real **Claim** button; tap it and the celebration shows what you actually got. Leave it unclaimed and the reward expires at the day rollover (00:00 UTC) — the streak day itself still counts either way.
- **Offline earnings wait for you, too** — what your hunter earns while you're away is no longer paid out silently the moment you open the game. It is held, and Home's offline button shows the true held amount; tap it and the Return Sheet pays exactly what accumulated, exactly once. The math is unchanged — same windows, same caps — only the paying moved to your tap. Home's top also trades its repeated level block for two honest buttons: your cache keys ride on the cache button as a count bubble, and the level display becomes a real progress bar showing how far into the level you are.
- **Numbers move where you can see them** — when a counted resource in the top bar rises — credits, scrap, keys — the counter pulses as it climbs, so gains never happen silently; drops stay quiet. Two things that used to happen without a word now announce themselves on Home: a **Sold** chip when one of your market listings sells, showing what you actually netted after the fee, and a **Bench ready** chip when a bench job finishes.
- **The Workshop lives on Home** — crafting has moved in full to Home's Craft mode: recipes, the queue, collecting, banked bench time, and repair and service jobs all work there. Gear drops its Workshop stop for a slim bench status strip — running, queued, and ready counts — that taps through to the bench, and the Garage still starts repairs, with its status and a door to Home's bench alongside. The bench itself is untouched: same jobs, same timers, same payouts.
- **Auto-salvage actually salvages now** — the Settings rule used to save politely and do nothing at all. It is now kept on your profile and enforced by the server, on roaming claims and offline settlements only: a drop at or under your rarity ceiling and quality cap is recycled the moment it lands, at exactly the manual salvage payout, Scavenger bonuses included. The ceiling stops at Epic — a Legendary can never be auto-salvaged at any layer — and boss loot, cache contents, market goods, and crafted items are never touched, nor was anything already in your bag. The Settings card also gains the On/Off and Scrap/Materials switches it always should have had.
- **The market is players only** — the seeded NPC stock is gone from Buy and Sell for good: every listing in the lane is another player's, the seed that stocked it is removed, and accepts of NPC listings are refused outright. When the seed retired, the live shelf held eleven seeded listings and no player ones; the lane now shows the market exactly as it is. Seller labels follow the seller, so a player re-listing gear they bought from the vendor reads as a player listing, as it should. The vendor's own shop is unchanged.
- **The cache reveal is one page** — opening a cache no longer cuts away to a second screen. The reveal moment plays exactly as it did, and as it settles, the full stat deck docks below it on the same page: DPS, every affix written out rather than counted, a legendary effect's name and its description, class-mod bonuses by skill name — the same deck the Gear inspect sheet shows, drawn from the same source, so the two can never disagree. Open Another and Collect sit below the deck.
- **Under the hood** — a set of roaming-claim tests that quietly depended on the calendar (they broke the day the hot area rotated) now pin their clock; claim payouts themselves were verified correct throughout and did not change.

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

_Every pull request merged since 2026-11-01 (PR #262), recorded exactly as merged — 136 merges. This ledger is the completeness record behind the themed entries above it: if a merge shipped, it is listed here. Generated from master's merge history; see `docs/WIKI.md`._

**2026-11-05** — 8 merges

- #386 — Daily login streak: TRUE CLAIM — record holds, tap Claim pays (migration 0079)
- #391 — The Trade: equip comparison in the inspect sheet + class-mod truth fix
- #393 — Pure player market: Buy/Sell are solely player listings (supersedes #317)
- #394 — Market compact list rows — Buy/Sell one-line treatment (Gear list sibling)
- #395 — Cache reveal: one page — stage stays, full stat deck below (no phase swap)
- #396 — Changelog: 2026-11-05 entry (streak claim, pulse, pure market, one-page reveal)
- #397 — Cache lane rebuild: daily budget dies, fragments abolished, keys are the only cache currency (migration 0082)
- #398 — Fix combat-stats saves dying on fractional play seconds (bigint)

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
