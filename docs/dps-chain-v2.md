# DPS Chain v2 — Architecture Reference

The single source of truth for "damage per second" in CyberCache. Every UI
surface that shows DPS (gear inspect, loadout screen, dashboard chips,
boss prep, boss select, LiveTurfDiorama) **MUST** go through this chain.
Do not compute DPS inline anywhere else.

> **If you are an agent adding or modifying any DPS-related code, read
> this doc first.** The chain's contract is here. The plan that produced
> it is in `.hermes/plans/dps-chain-v2-plan.md` (untracked, meta-only).

## 1. The rule

**All DPS math lives in `src/lib/stats/dpsChain.ts`.** No component,
screen, or simulator should inline a `baseDmg * spd * (1 + crit * critDmg) * …`
formula. The chain is a single function (`computeWeaponDps`) that takes a
context and returns a number. Every DPS surface calls it.

The audit (June 2026) found seven places where this rule was violated.
PRs A–E fixed each one. PR F (this doc) makes the rule discoverable.

**Why this rule exists:** when two surfaces use two different formulas,
they disagree. The player sees "you will not defeat the boss before
timeout" in one place and "your best DPS vs this boss is X" in another,
and X doesn't match the timeout. The chain eliminates the disagreement
by making one function the only path.

## 2. The chain

- **File:** `src/lib/stats/dpsChain.ts`
- **Public API:**
  - `computeWeaponDps(ctx: DpsContext): number` — single weapon vs a target context
  - `computeLoadoutDps(weapons, bossWeaknesses?, bossResistances?, consumables?): number` — sum across a loadout
  - `computeStandardDps(weapon, legendaryDamageMult?): number` — "vs standard target" baseline (no element multiplier, no consumables, no ammo loss, no legendary if not passed)
  - `describeDpsContext(weapon, context): string` — human label for a context (UI display)
- **Signature mechanic:** `src/lib/stats/signatureMechanic.ts` (consumed by the chain's step 2)
- **DPS-relevant consumable table:** `DPS_CONSUMABLE_EFFECTS` in `signatureMechanic.ts` (consumed by the chain's step 6)

### Step order (multiplicative, applied to the previous result)

| # | Step                       | Source                              | Notes                                              |
|---|----------------------------|-------------------------------------|----------------------------------------------------|
| 1 | Raw DPS                    | `weapon.baseDamage`, etc.            | `baseDmg * spd * (1 + critChance * critDamage)`    |
| 2 | Signature DPS mult         | `applySignatureMechanic(weapon, …)`  | Was 1.0× no-op pre-PR-E. Now consumes the per-weapon signature. |
| 3 | Legendary damage mult      | `legendaryDamageMult` param          | Default 1.0×.                                      |
| 4 | Element matchup            | `counterElementMultiplier(…)`        | 3-state: weakness 1.3×, resistance 0.7×, else 1.0×. |
| 5 | Ammo-window efficiency     | `ammoEfficiency` param               | Caller-provided, default 1.0×. Sim pre-computes via `calculateAmmoWindows`. |
| 6 | Pre-fight consumables      | `DPS_CONSUMABLE_EFFECTS` table       | Only TargetPainter / OverchargeStim / IncendiaryAmmo / VoidAmmo affect DPS. Other consumables are survival/break/loot concerns (stays in sim). |

> **"vs standard target" = steps 1, 2, 3 only.** No element multiplier,
> no consumables, no ammo loss. Pre-PR-D this returned 1.3× for Fire
> weapons (a legacy flesh-fallback bug). PR D fixed it: standard
> baseline is the same for every element. Verified by
> `dpsChain.test.ts > computeStandardDps`.

## 3. The `DpsContext` shape

```ts
type DpsContext = {
  weapon: Weapon;                              // required
  bossWeaknesses?: Element[];                  // default []
  bossResistances?: Element[];                 // default []
  consumables?: Record<string, number>;        // default {} — full consumables table
  legendaryDamageMult?: number;                // default 1
  ammoEfficiency?: number;                     // default 1.0
};
```

| Field              | When to pass it                                                                                  |
|--------------------|--------------------------------------------------------------------------------------------------|
| `weapon`           | Always.                                                                                          |
| `bossWeaknesses`   | When the target has stored weakness elements. Read from `BossDef.weaknesses`.                    |
| `bossResistances`  | When the target has stored resistance elements. Read from `BossDef.resistances`. (Empty = neutral.) |
| `consumables`      | When the player has selected DPS-affecting consumables. Pass the full `Record<string, number>`; the chain filters. |
| `legendaryDamageMult` | When the primary weapon has a legendary bonus. Sim reads from `applyLegendaryEffects(...).damageMult`. |
| `ammoEfficiency`   | When the fight has an ammo window. Sim pre-computes via `ammoEfficiencyFromWindows` and passes it in. |

**Removed (do not use):**
- ~~`bossResistance: number`~~ — replaced by `bossResistances: Element[]` in PR D.
- ~~`consumables: { TargetPainter?: number; OptimalAmmo?: number }`~~ — replaced by `Record<string, number>` in PR E.

## 4. The 4 call patterns

### Pattern A: "vs standard target" (gear inspect, dashboard, loadout screen)

```ts
import { computeStandardDps } from '@/lib/stats/dpsChain';

const dps = computeStandardDps(weapon, legendaryDamageMult);
```

Use this whenever there is **no target context** — the player is comparing
two weapons, or the screen has no boss loaded, or the metric is the
weapon's raw contribution.

### Pattern B: "vs boss" (boss prep, boss select, LiveTurfDiorama with boss)

```ts
import { computeLoadoutDps } from '@/lib/stats/dpsChain';

const dps = computeLoadoutDps(liveWeapons, boss.weaknesses, boss.resistances);
```

Use this when a boss is selected and the metric should reflect that
boss's element matchup (1.3× for counter element, 0.7× for resisted element).

### Pattern C: "vs boss with consumables" (boss prep, full sim path)

```ts
import { computeLoadoutDps } from '@/lib/stats/dpsChain';

const dps = computeLoadoutDps(liveWeapons, boss.weaknesses, boss.resistances, consumables);
```

Same as Pattern B but the player has DPS-affecting consumables equipped
(TargetPainter, OverchargeStim, IncendiaryAmmo, VoidAmmo). Pass the full
consumables table; the chain filters to DPS-relevant keys.

### Pattern D: per-weapon inside the boss simulator

```ts
import { computeWeaponDps } from '@/lib/stats/dpsChain';
import { ammoEfficiencyFromWindows } from '@/lib/simulation/bossSimulator'; // or similar

const ammoEff = ammoEfficiencyFromWindows(primaryAmmo.fullDuration, primaryAmmo.reloadDuration, 30);
const chainDps = computeWeaponDps({
  weapon: primary,
  bossWeaknesses: boss.weaknesses,
  bossResistances: boss.resistances,
  consumables,
  legendaryDamageMult: legendary.damageMult,
  ammoEfficiency: ammoEff,
});
```

The sim multiplies `chainDps` by per-slot contribution (secondary ×
`getHotSwapperSecondaryMult()`, heavy × 0.5) and player-level modifiers
(rm.dpsMult × (1 + skillBonuses.dps)) on top. **The chain never sees
those** — they are not per-weapon properties.

## 5. Adding a new modifier — the recipe

If you need to add a new DPS-affecting modifier (e.g., a new boss
mechanic, a new consumable type, a new weapon stat), follow this recipe:

1. **Identify the step.** Which of the 6 steps does it belong in?
   - Per-weapon property → step 2 (signature), 3 (legendary), or new step.
   - Boss context → step 4 (element matchup) or new step.
   - Per-fight input → step 5 (ammo) or new step.
   - Consumable → step 6 (consumables table).

2. **Update `DPS_CONSUMABLE_EFFECTS` if it's a consumable.** Add the
   type as a key with the multiplier. The chain's step 6 reads from
   this table — no per-consumable code changes needed.

3. **Add a step to the chain.** Insert the new multiplier between the
   existing steps, with a JSDoc comment explaining the order rationale
   (why this step goes between X and Y).

4. **Update the call sites.** If the new modifier is a per-slot loadout
   concern (e.g., a new ammo-window rule), it stays in the sim — the
   sim pre-computes the new input and passes it to the chain. If it's
   a per-weapon property, add it to `Weapon` type and to
   `computeWeaponDps`'s call sites.

5. **Write the contract test.** Add a test to `src/test/dpsChain.test.ts`
   that asserts the new step applies correctly. If the modifier
   interacts with existing steps (e.g., "this consumable only works
   against Fire bosses"), add a test for the composition.

6. **Update the visible shifts doc.** If the new step changes the
   standard-target surface, note it in the PR description so the
   user can verify in the browser.

7. **Run the gate.** `npx tsc --noEmit`, `npm run lint`, `npm test`,
   `npm run build`. All must be clean.

## 6. What NOT to do

The audit found these specific anti-patterns. Do not reintroduce them.

- **❌ Inline DPS formulas in components or screens.** Use
  `computeWeaponDps` / `computeLoadoutDps` / `computeStandardDps`. A
  `baseDmg * spd * (1 + crit * critDmg)` in a `.tsx` file is a
  regression.
- **❌ The legacy `getElementMatchup(element, 'flesh')` call.** The
  chain used to do this as a "no boss = flesh fallback" trick. It
  silently returned 1.3× for Fire weapons, which made the "vs
  standard" surface element-dependent. The fallback is gone in PR D.
  If you need a no-boss baseline, use `computeStandardDps` (returns
  1.0× for every element).
- **❌ Frozen power scores that diverge from the live chain.** Pre-PR-B,
  `weapon.combatPower` was computed by the weapon generator and never
  re-derived. The diorama and the chain could disagree. PR B fixed this
  by making the chain the single source. **Do not cache DPS values
  on the Weapon type** — call the chain instead.
- **❌ The legacy `bossResistance: number` parameter.** Replaced by
  `bossResistances: Element[]` in PR D. If you see a flat-multiplier
  resistance, model it as a synthetic resistance element.
- **❌ Per-slot contribution in the chain.** Secondary × 0.3, heavy ×
  0.5 are loadout-decision concerns. The chain doesn't know which
  slot a weapon is in. The sim multiplies per-slot on top.
- **❌ Risk / skill multipliers in the chain.** Same reason — those
  are player-level concerns. The sim multiplies them on the
  loadout-total, not the per-weapon DPS.

## 7. File ownership map

| File                                      | Owns                                                                 |
|-------------------------------------------|----------------------------------------------------------------------|
| `src/lib/stats/dpsChain.ts`               | The chain (single source of truth). The 6 steps. `DpsContext` shape. |
| `src/lib/stats/signatureMechanic.ts`      | `applySignatureMechanic` (per-weapon). `DPS_CONSUMABLE_EFFECTS` table. |
| `src/lib/stats/characterStats.ts`         | Dashboard chip math. Calls `computeLoadoutDps` for boss-relative.    |
| `src/lib/generators/weaponGenerator.ts`   | Weapon generation. Calls `computeStandardDps` for `combatPower`.     |
| `src/lib/simulation/bossSimulator.ts`     | Per-fight DPS. Calls `computeWeaponDps` per weapon, multiplies per-slot / risk / skill on top. |
| `src/lib/legendaryEffects.ts`             | `applyLegendaryEffects` (consumed by the sim, not the chain).        |
| `src/components/dashboard/LiveTurfDiorama.tsx` | UI display of the chain's output. No inline DPS math.          |
| `src/components/fight/BossPrepModal.tsx`  | UI display of the chain's output. No inline DPS math.                |
| `src/components/fight/BossSelectModal.tsx` | UI display of the chain's output. No inline DPS math.               |
| `src/components/gear/GearInspectSheet.tsx` | UI display of the chain's output. No inline DPS math.               |
| `src/test/dpsChain.test.ts`               | Contract tests for the chain. Asserts all 6 steps and the new 3-state counter table. |
| `src/test/weaponGenerator.test.ts`        | Parity test: weaponGenerator's combatPower equals `computeStandardDps(weapon)`. 5,400 combinations. |
| `src/test/bossSimulator.test.ts`          | Parity test: the sim's per-weapon DPS equals the chain's value. 6 tests. |
| `src/test/bossSimulator-resistance.test.ts` | PR D regression test: sim consumes `bossResistances` correctly.    |
| `src/test/bossSimulator-pr-e.test.ts`     | PR E integration test: sim reflects chain's new signature / consumables / ammoEfficiency. |
| `docs/dps-chain-v2.md`                    | This document. The architecture reference. Update when the chain changes. |

**If you change the chain:** update this doc, update the JSDoc at the
top of `dpsChain.ts`, and add a test. The contract is here so future
agents can find it.

## 8. Change log (PRs A–F)

- **PR A (#60)** — closed the BossPrepModal/BossSelectModal 0-stat-display
  bug. Pure UI: added a `computeLoadoutDps` call site so the modals show
  the boss-relative DPS chip.
- **PR B** — `weaponGenerator.combatPower` now calls `computeStandardDps`.
  The chain is the single source of `combatPower`. +12.6% number shift
  for baseline weapons (visible on standard-target displays; honest
  correction of the legacy `1 + statusChance * 0.5` formula).
- **PR C (#62)** — `bossSimulator.ts` per-weapon blocks now call
  `computeWeaponDps`. Closed the chain-vs-sim disconnect. The sim still
  multiplies per-slot / risk / skill on top. **The 1.3× counter-element
  bonus now actually applies** (it was silently 1.0× pre-PR-C because of
  the broken `getElementMatchup(element, 'flesh')` call).
- **PR D (#63)** — chain's element math is now 3-state (1.3× weakness,
  0.7× resistance, 1.0× else). `bossResistances: Element[]` replaces
  the legacy `bossResistance: number`. "vs standard" = raw (no element
  multiplier for any element). −23% visible shift for Fire weapons on
  the standard-target surface.
- **PR E (#64)** — chain now consumes signature mechanic, full
  consumables table, and ammo-window efficiency. Three new chain steps.
  Boss sim's `dps *=` blocks and inline `applySignatureMechanic` calls
  are gone — the chain is the single source. +11.8% visible shift for
  SMG weapons on the standard-target surface (overheat signature).
- **PR F (this doc)** — architecture reference. Future agents can find
  the contract.

### Audit reference

The full audit that produced this series is in
`.hermes/plans/dps-chain-v2-plan.md` (untracked, meta-only). It contains
the locked decisions D1–D4, the 7 dead-spots found, the file-ownership
map, and the per-PR scope. The plan is not committed to any branch
because it is meta-documentation, not source.
