# CyberCache UI Aesthetic Implementation Checklist

This PR turns the Borderlands-inspired direction into a concrete mobile UI pass. The goal is not to copy any Borderlands screen directly. The goal is to translate the badlands looter-shooter visual language into CyberCache's idle-game structure.

## Global rules

- Use thick black outlines, clipped corners, and crooked sign geometry instead of rounded SaaS cards.
- Keep the base palette dark, dusty, amber, red, and scrap-metal neutral.
- Use rarity colors for loot and reward emphasis, not for every panel.
- Use short field-station labels: bounty, turf, cache, bench, hunter, field manual, vendor yard.
- Keep every component usable at mobile widths from 360px to 480px.
- Use horizontal scroll only where it is intentional: route strips, skill boards, item strips, and tab rails.
- Do not change reward logic, Supabase persistence, probabilities, or gameplay formulas in this visual pass.

## Coverage map

### App shell
- Bottom nav becomes a chunky mobile bounty tab rail.
- Screen wrapper gets a badlands backdrop.
- Sub-screen header becomes a field-station title plate.
- Verification and auth errors use the same card language.

### Dashboard
- Bounty Board home surface.
- Mobile HUD resource chips.
- Level strip with XP progress.
- Numbers-up telemetry for XP, loot, cash, scrap, keys, fragments, and level-up changes.
- Current turf or boss target as the center focus.

### Fight
- Uses global badlands cards and mobile surface rules.
- Fight should be the active field board: route, patrol state, boss target, recent loot, combat log.
- Boss-related UI should trend toward title-card/target-poster styling in future iterations.

### Inventory
- Gear Yard hub with backpack, loadout, supply, and bench tabs.
- Summary counters use pinned stat plates.
- Cache action is visually promoted as a reward action.

### Loadout / Loot / Vendor subviews
- Covered by global card, button, input, and mobile surface rules.
- Should continue moving toward equipment-screen, item-card, and vending-machine metaphors in future passes.

### Mastery / Skill trees
- Mastery Board hub.
- Skill Tree board uses mobile horizontal scroll intentionally.
- Nodes use heavy outlines, branch-like tiers, point counters, and selected-node detail panel.

### Chest / Data Cache
- Covered by global badlands card, button, and modal surface rules.
- Should remain a reward reveal flow rather than a form-like interaction.

### Market
- Covered by global vendor-yard surface rules for cards, filters, tabs, inputs, buttons, and toast.
- Future polish should push this further toward vending-machine shelves and price tags.

### Workshop
- Covered by global bench/work-ticket surface rules for cards, queues, filters, progress strips, and buttons.
- Future polish should push active queues further toward physical job tickets.

### Profile
- Hunter Dossier page with account plate, XP strip, stats, collection patch, and account tools.

### Settings
- Options Board page with compact, thumb-safe setting buttons.
- Danger/reset state uses the same badlands warning-card language.

### Help
- Field Manual page with briefing cards.

### Auth
- Load Hunter / Create Hunter terminal instead of generic login.
- Mobile-first with large primary actions and clipped input panels.

## QA checklist

- Dashboard opens and scrolls at mobile width.
- Fight opens, passive ticker still runs, manual field sweep still works, boss target controls still open.
- Inventory tabs switch: Gear, Loadout, Supply, Bench.
- Chest opens/reveals/collects without layout overflow.
- Market buy/sell/history/listing controls remain tappable.
- Mastery overview and Skill Trees tabs work.
- Profile settings/help/sign-out actions remain reachable.
- Settings toggles and reset flow remain tappable.
- Help screen remains readable.
- Auth guest/register/login/recovery modes remain usable.
- No horizontal overflow except intentional scroll strips/boards.
- CI must pass tests, mechanics validation, build, and lint before merge.
