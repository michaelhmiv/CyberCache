# CyberCache QA Checklist

Use this checklist to verify every user-facing mechanic works end-to-end after changes.

## Pre-flight
```bash
cd /data/cybercache
npm run dev
# Open http://localhost:5173 in a mobile-viewport (480px) browser window
```

## Fresh Start Journey

- [ ] Clear localStorage (Settings → Reset All Save Data → Confirm)
- [ ] Reload page — app loads with empty inventory
- [ ] FightScreen shows "Welcome, Gunrunner!" first-time card
- [ ] "Farming Active" card visible with rates: XP, Drops, Key Frags
- [ ] Credits start at 5,000
- [ ] Cache Keys start at 3
- [ ] Within ~30 seconds, a loot item drops
- [ ] Drop appears in "Recent Cache Drop" section
- [ ] **Bottom nav stays visible across all 5 tabs**

## Navigation Shell

- [ ] Tapping Fight/Loadout/Loot/Market/More switches tabs
- [ ] Bottom nav bar remains visible on all 5 tabs
- [ ] More → Data Cache opens cache screen WITH bottom nav still visible
- [ ] More → Skill Trees opens skills WITH bottom nav still visible
- [ ] More → Fusion Lab, Vendor, Workshop, Profile, Settings, Guide all keep nav
- [ ] "← Back" returns to More screen
- [ ] Boss Select modal is FULL SCREEN (hides nav)
- [ ] Boss Prep modal is FULL SCREEN (hides nav), with close button

## Loot & Inventory

- [ ] Loot tab shows ALL gear types: Weapons, Shields, Class Mods, Relics, Ordnance
- [ ] Type filter pills (All/Weapons/Shields/Mods/Relics/Ordnance) filter correctly
- [ ] Rarity filters show correct rarity-colored borders
- [ ] "Equipped" filter shows items in current loadout
- [ ] "Tradeable" filter shows unlocked + unequipped items
- [ ] "Scrap" filter shows Common + Uncommon items
- [ ] Tapping an item opens detail modal with type-appropriate stats
- [ ] Weapon detail shows: baseDmg, attackSpeed, critChance, critDmg, etc.
- [ ] Shield detail shows: HP, rechargeRate, mitigation
- [ ] ClassMod detail shows: treeBonus, nodeBoosts
- [ ] Ordnance detail shows: damage, element, effect
- [ ] Relic detail shows: affixes count
- [ ] "Lock" button toggles lock state
- [ ] "Unlock" button toggles lock state
- [ ] "Scrap" button shows confirmation if item is equipped or locked
- [ ] "List on Market" button navigates to Market tab (or shows if it works)
- [ ] "Equip" button works for non-weapons; navigates to loadout for weapons

## Loadout

- [ ] 7 gear slots visible: Primary, Secondary, Heavy, Ordnance, Shield, Class Mod, Relic
- [ ] 3 consumable slots: Pre-Fight, Mid-Fight, Emergency
- [ ] Tapping a slot opens equip drawer with ONLY valid items
- [ ] Primary/Secondary shows all weapons
- [ ] Heavy shows only Launcher + Shotgun weapons
- [ ] Shield shows only shield items
- [ ] Class Mod shows only class mod items
- [ ] Ordnance shows only ordnance items
- [ ] Relic shows only relic items
- [ ] Empty slot shows "how to get items" message
- [ ] Boss intel card shows when a boss is selected
- [ ] Compare view shows when replacing an equipped item
- [ ] Auto-equip Best button fills empty slots
- [ ] Consumable select shows owned count
- [ ] Zero-owned consumables show "Not available"

## Boss Selection & Combat

- [ ] FightScreen → Tap "Current Target" card → Boss Select opens
- [ ] Boss Select shows all 7 Region 1 bosses
- [ ] "dune_tyrant" is unlocked, rest show "LOCKED"
- [ ] Tap Dune Tyrant → selects it as target
- [ ] "TARGET" badge appears on selected boss
- [ ] Prepare Boss opens BossPrepModal for the SELECTED boss
- [ ] BossPrep shows: HP, Shield, Armor stats
- [ ] Shows weaknesses (green) and resistances (red)
- [ ] Shows mechanic description
- [ ] Shows win chance as a percentage
- [ ] Win chance is **deterministic** — same loadout = same preview
- [ ] Survival/break/DPS reasons shown
- [ ] Loadout snapshot shows equipped weapons
- [ ] Consumable slots editable
- [ ] Risk selector works (Conservative/Balanced/Greedy/AllIn)
- [ ] "INITIATE COMBAT" runs the fight
- [ ] Victory shows "BOSS DEFEATED" with credits + XP
- [ ] Victory unlocks the next boss in sequence
- [ ] Defeat shows "DEFEATED" with death fee and recommendations
- [ ] "Fight Again" resets to prep screen
- [ ] Actual combat result is random (different from preview)
- [ ] Pity counter increments on both victory and defeat

## Boss Progression

- [ ] Defeat Dune Tyrant (Tier 1) → Siltstalker unlocks
- [ ] Defeat Siltstalker → Heap Guard unlocks
- [ ] Defeat Heap Guard → Ashgut unlocks
- [ ] Continue through all 7 bosses
- [ ] Defeating all shows "region cleared" (all defeated in selector)
- [ ] Defeated bosses can be re-fought

## Caches

- [ ] Chest/Data Cache screen accessible from More tab
- [ ] Shows current keys + fragment progress
- [ ] Fragment bar shows X/5
- [ ] "OPEN CACHE" uses 1 key
- [ ] Decrypting animation plays (~2s)
- [ ] Items revealed with staggered animation
- [ ] Odds displayed match actual roll logic (Rare 60%, Epic 32%, Legendary 8%)
- [ ] Bonus drop info shown (40% second, 15% third)
- [ ] "Cache-Forged" modifier info shown
- [ ] "Open Another" button if keys remain
- [ ] Item actions on revealed items: Equip, Lock, Scrap
- [ ] From FightScreen, "Open Caches" button navigates to chest

## Market

- [ ] Market tab loads with "Local NPC Market" subtitle
- [ ] Buy tab shows ~25 seeded NPC listings
- [ ] Seller names visible on each listing
- [ ] "Buy Now" works (credits deducted, item received)
- [ ] Sell tab shows all unlocked items
- [ ] Listing sets price, shows 10% fee
- [ ] "List" button creates listing (item removed from inventory)
- [ ] My Listings shows active player listings
- [ ] "Cancel Listing" returns item to inventory
- [ ] History shows buy/sell transactions

## Skills

- [ ] Skill Trees accessible from More tab
- [ ] Three trees toggleable: Gunslinger, Demolition, Scavenger
- [ ] Points available = (player level - 1) - spent
- [ ] Cannot spend more points than earned
- [ ] Small nodes can be ranked up to maxPoints
- [ ] Major nodes require prerequisites
- [ ] Keystone requires major nodes
- [ ] Respec costs credits and refunds all points
- [ ] Skill bonuses affect boss simulation preview

## Consumables

- [ ] Vendor (More → Consumable Vendor) sells all consumables
- [ ] Buying deducts credits, adds to inventory
- [ ] Owned count shown per consumable
- [ ] Workshop (More → Workshop) can craft consumables
- [ ] Materials display shows 5 materials + 5 essences
- [ ] Crafting requires materials and time
- [ ] Consumables can be used in boss prep

## Zone Progression

- [ ] Zone bar shows current stage
- [ ] "New zone every 5 levels" text visible
- [ ] Zone changes enemy type label at stages 4 and 7
- [ ] Zone idle credits increase with higher zones
- [ ] Credits actually earn during idle farming

## Formula Traceability

- [ ] Win chance display deterministic for same loadout
- [ ] Cache odds displayed match code (60/32/8)
- [ ] Scrap yield matches rarity × level × quality formula
- [ ] Crafting costs match recipe definitions

## Post-victory Flow

- [ ] After boss victory: credits added, XP added
- [ ] Next boss unlocked message visible
- [ ] Loot generated from boss drop table
- [ ] Can immediately fight next boss
- [ ] Can re-fight same boss (shows "DEFEATED" badge)

## General Polish

- [ ] No dead/clickable buttons that do nothing
- [ ] Every visible stat affects something or is labeled as flavor
- [ ] Every visible system has entry point → action → result
- [ ] Empty states have helpful messages
- [ ] All modals have close/back actions
- [ ] Bottom nav never disappears except full-screen modals
