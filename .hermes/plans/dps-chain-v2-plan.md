# Plan: DPS Chain v2 — Single Source of Truth for Inner Mechanics

**Date:** 2026-06-09
**Owner:** Michael
**Author:** Hermes (audit + plan)
**Skill:** `cybercache-dev`
**Audit ref:** `references/inner-mechanics-audit-recipe.md`
**Audit trigger:** Player report "I have a weapon equipped and it says 0 DPS" → comprehensive audit of every attribute → every formula → every UI surface

---

## Why this plan exists

The 2026-06-09 audit found **10 distinct dead spots / divergent formulas** in the DPS pipeline (see audit report in chat). The same class of bug as the symptom — "stats exist but are not wired to the chain, or the chain silently ignores them, or a UI surface bypasses the chain entirely" — recurs 7 times across the codebase.

The user has confirmed:
1. **All 10 recommendations approved** (PRs A–E in the audit, plus an architecture-doc PR F)
2. **Single source of truth is the goal** — no parallel formulas, no frozen-vs-live divergence, no shape mismatches between the chain and the data
3. **Future agents must be able to find the contract** — the chain's API and the "always go through the chain" rule must be discoverable from the codebase, not tribal knowledge
4. **Industry standard patterns** — proper type-safe contexts, contract tests, public-API documentation, and the project's existing multi-PR series convention

This plan turns the audit into 6 small, independently-mergeable PRs, each with a defined file-ownership scope, a full test gate, and a push-after-commit cadence.

---

## The chain, after the v2 series

The current chain is 6 steps with 2 dead parameters (`bossResistance` never passed) and 2 dead fields (`bossDamageMod`, `statusChance` ignored). After the v2 series:

```
src/lib/stats/dpsChain.ts (the only place DPS is computed)

  computeWeaponDps(ctx) → number
    ctx.weapon: Weapon                                          (required)
    ctx.bossWeaknesses: Element[]                               (optional, default [])
    ctx.bossResistances:  Element[]                             (optional, default [])
    ctx.consumables:      Record<string, number>                (optional, default {})
    ctx.signature:        { fullDuration, reloadDuration, fightDuration } | undefined
    ctx.legendaryDamageMult: number                             (optional, default 1)

  Step 1: baseDps
    = baseDamage * attackSpeed
    * (1 + critChance * critDamage)                  (crit: treat critDamage as full hit multiplier)
    * (1 + statusChance * statusDamage * 0.5)        (status: half-strength DoT contribution)
    * (1 + bossDamageMod)                            (boss-only: previously dead)

  Step 2: signatureDps
    = if ctx.signature: applySignatureMechanic(weapon, ctx.signature) (was in bossSimulator, now in chain)
    = else: baseDps (no change)

  Step 3: legendaryDps
    = signatureDps * ctx.legendaryDamageMult

  Step 4: elementalDps
    elemMatch = computeElementMatchup(weapon.element, ctx.bossWeaknesses, ctx.bossResistances)
    // 1.3× if weakness matches
    // 0.7× if resistance matches
    // 1.0× otherwise
    // CHANGED: no more "flesh" fallback for standard targets — vs standard = 1.0×

  Step 5: resistedDps
    = elementalDps                          (resistances are folded into step 4; this step removed)

  Step 6: consumableDps
    For each (id, count) in ctx.consumables:
      mult = getConsumableDpsMultiplier(id, count)  // reads from constants/consumables.ts
    return resistedDps * Π mult
```

Public API stays the same shape — `computeWeaponDps`, `computeStandardDps`, `computeLoadoutDps`, `describeDpsContext` — but the **internal steps** change and the **context type** gains `bossResistances`, `consumables: Record<string, number>`, and `signature`. All call sites migrate in PR C.

---

## File ownership map (the rule that prevents future drift)

This is the most important section of the plan. Each file is owned by **exactly one PR** in this series. If a future PR wants to touch a file that's not in its ownership scope, it must coordinate via integration test first.

| File | Owner | Notes |
|---|---|---|
| `src/lib/stats/dpsChain.ts` | **PR D + PR E** | The chain itself. D adds `bossResistances` + element table rewrite. E adds `consumables: Record` + `signature` param. |
| `src/lib/stats/characterStats.ts` | **PR D + PR E** | D wires boss resistances into the call. E wires consumables + signature into the call. |
| `src/lib/stats/signatureMechanic.ts` (NEW) | **PR E** | Extracted from `bossSimulator.ts:339-392`. New home for the signature mechanics. |
| `src/lib/stats/consumableEffects.ts` (NEW) | **PR E** | Extracted from `bossSimulator.ts:542-554` + `constants/consumables.ts` effect rules. Maps consumable IDs to DPS multipliers. |
| `src/lib/stats/elementMatchup.ts` (NEW) | **PR D** | The new `computeElementMatchup(player, weaknesses, resistances)` function. Replaces both `getElementMatchup` (legacy target-type) and the inline `counterElementMultiplier` in dpsChain. |
| `src/lib/generators/weaponGenerator.ts` | **PR B** | Replace inline combatPower/bossPower/farmPower formulas with calls to the chain. |
| `src/lib/simulation/bossSimulator.ts` | **PR C** | Replace per-weapon inline DPS math with calls to `computeWeaponDps`. Keep the per-simulation concerns (survival, break, mechanic, risk). |
| `src/components/gear/GearInspectSheet.tsx` | **PR A** | Cosmetic: no formula change. |
| `src/components/fight/BossPrepModal.tsx` | **PR A** | Add bossPower + DPS chip to weapon rows. |
| `src/components/fight/BossSelectModal.tsx` | **PR A** | Add DPS projection chip. |
| `src/components/dashboard/LiveTurfDiorama.tsx` | **PR A (display only) + PR D (formula)** | A wires the boss-prop display; D changes what `boss: BossDef` means in the chain (passes `resistances` array). |
| `src/test/dpsChain.test.ts` | **PR D + PR E** | Update tests for new shape, add element-matchup coverage, consumable coverage. |
| `src/test/characterStatsDiorama.test.ts` | **PR D** | Add coverage for boss-resistance wiring. |
| `src/test/signatureMechanic.test.ts` (NEW) | **PR E** | Tests for the extracted signature logic. |
| `src/test/consumableEffects.test.ts` (NEW) | **PR E** | Tests for the consumable multiplier map. |
| `src/test/weaponGenerator.test.ts` (NEW or update existing) | **PR B** | Asserts that frozen `combatPower` === live `computeStandardDps(weapon)` for 50 random rolls. |
| `src/test/bossSimulator.test.ts` (NEW or update existing) | **PR C** | Asserts that sim DPS === chain DPS for the same loadout. |
| `src/components/dashboard/LiveTurfDiorama.tsx` (formula portion) | **PR D** | D passes `boss.resistances` to the chain. |
| `references/dps-chain-v2.md` (NEW) | **PR F** | Architecture reference doc for future agents. |

### Files explicitly NOT touched by this series (so the diff stays small)

- `src/types/items.ts` — the `Weapon` shape doesn't change. New fields are passed through `DpsContext`, not added to the type.
- `src/types/boss.ts` — `BossDef` already has `resistances: Element[]`. The shape was right; the chain just didn't use it.
- `src/types/game.ts` — no enum changes.
- `src/store/**` — no store changes; the chain is pure functions.
- `supabase/migrations/**` — no DB changes; everything is client-side.
- `package.json` — no new deps.

This is the "skeleton-first" pattern from the skill. The chain is the skeleton; everything else is the muscle around it.

---

## The 6-PR series

### PR A — Close the loadout-decision-surface dead spots (cosmetic, smallest blast radius)

**Goal:** Player sees DPS on every surface where they make a loadout decision.

**Files owned (4):**
- `src/components/fight/BossPrepModal.tsx` — add `bossPower` + `vs {boss.name}` DPS chip to each of the 3 weapon rows in the Loadout section (line 357-366)
- `src/components/fight/BossSelectModal.tsx` — add a "Your DPS vs {boss.name}" projection chip per target (use `inventory.getWeapons()[0] ?? loadout.getWeapon('primary')` as the player's best shot, call `computeLoadoutDps([weapon], boss.weaknesses, boss.resistances)`)
- `src/components/dashboard/LiveTurfDiorama.tsx` — add `vs standard` vs `vs {boss.name}` label to the DPS chip (no formula change in this PR; the label is just clearer)
- `src/components/gear/GearInspectSheet.tsx` — add a "vs your current boss" DPS row below "DPS (vs standard)" if a boss is selected (uses `useBossStore`)

**Tests:** No new test logic; the existing `dpsChain.test.ts` and `characterStatsDiorama.test.ts` cover the chain. Add 1 visual smoke test (renders the modal with a weapon + boss, asserts the chip is in the DOM).

**Verification gate:** `npx tsc --noEmit && npm run lint && npm test && npm run build`. Push. Verify with `gh pr view <N> --json url`.

**Why this is PR 1 of the series:** It's a pure UI change, no formula refactor, the smallest blast radius, and it surfaces a visible win to the user immediately. The user can see "ok, the boss prep screen now shows my DPS" before the deeper refactors land.

**Estimated scope:** 1 file per surface, ~30 lines per file, 4 files = 120 lines. 1 new test file. ~150 lines total.

---

### PR B — Make the chain the source of truth for combatPower/bossPower/farmPower (frozen-vs-live parity)

**Goal:** `weapon.combatPower`, `weapon.bossPower`, `weapon.farmPower` are computed by calling the chain, so the value shown on the gear inspect and the value computed live cannot diverge.

**Files owned (2):**
- `src/lib/generators/weaponGenerator.ts` (lines 185-190) — replace inline formulas with:
  ```ts
  const combatPower = Math.round(computeStandardDps(stats));
  const bossPower = Math.round(computeLoadoutDps([stats], [] /* no boss context */, [] /* no resistances */) * (1 + stats.shieldDamageMod * 0.3) * (1 + stats.armorDamageMod * 0.3));
  const farmPower = Math.round(combatPower * (1 + stats.waveDamageMod) * (1 + stats.attackSpeed * 0.2));
  ```
  Wait — `bossPower` in the current generator is `combatPower * (1 + bossDamageMod) * (1 + shieldDamageMod * 0.3) * (1 + armorDamageMod * 0.3)`. That's a *boss-relative* number that includes shield/armor break bonuses. The chain's `computeLoadoutDps` doesn't include shield/armor break yet (those are separate metrics in the HUD). So we need a small adapter or a new chain function `computeWeaponBossPower(weapon)` that returns `computeStandardDps(weapon) * (1 + bossDamageMod) * (1 + shieldDamageMod * 0.3) * (1 + armorDamageMod * 0.3)`. Add this to `dpsChain.ts` as a new exported function — it's a derived stat, not a per-step computation.
- `src/test/weaponGenerator.test.ts` — new or extended, asserts that for 50 random rolled weapons, the frozen `combatPower` field equals `Math.round(computeStandardDps(weapon))`. This is the **frozen-vs-live parity test** that PR B exists to enable.

**Tests:** New parity test. 50 random rolls. Asserts `Math.abs(weapon.combatPower - Math.round(computeStandardDps(weapon))) <= 1` (rounding tolerance).

**Verification gate:** `npx tsc --noEmit && npm run lint && npm test && npm run build`. Push.

**Why PR 2, not PR 1:** PR A doesn't depend on PR B (A uses the chain as-is; B refactors the chain's call sites). But B depends on the chain's current contract being stable, which is true after PR #60 (the diorama fix). Running A first gives the user a visible win, then B deepens the contract.

**Estimated scope:** 1 source file + 1 test file, ~50 lines. Small.

**Risk:** If the chain's `computeStandardDps` returns a value materially different from the old generator formula (e.g., 13% lower because of the status-chance term), the user will see a one-time number change on every existing weapon. This is intentional and honest — but call it out in the PR description.

---

### PR C — Make the boss simulator call the chain (closes the chain-vs-sim disconnect)

**Goal:** The DPS the diorama shows and the DPS the sim resolves are computed by the same function. Player and simulation agree.

**Files owned (2):**
- `src/lib/simulation/bossSimulator.ts` (lines 504-540) — replace the inline per-weapon DPS math with:
  ```ts
  const primaryCtx: DpsContext = {
    weapon: primary,
    bossWeaknesses: boss.weaknesses,
    bossResistances: boss.resistances,  // PR D adds this; for now, the chain ignores it (1.0 default)
    consumables,
    signature: { fullDuration: primaryAmmo.fullDuration, reloadDuration: primaryAmmo.reloadDuration, fightDuration: 30 },
    legendaryDamageMult: legendary.damageMult,
  };
  const primaryDPS = primary ? computeWeaponDps(primaryCtx) : 0;
  const secondaryDPS = secondary ? computeWeaponDps({ ...same shape, signature: { fullDuration: secondaryAmmo.fullDuration, reloadDuration: secondaryAmmo.reloadDuration, fightDuration: 30 } }) * getHotSwapperSecondaryMult(primary) : 0;
  const heavyDPS = heavy ? computeWeaponDps({ weapon: heavy, signature: { fullDuration: 6, reloadDuration: 4, fightDuration: 30 } }) * 0.5 : 0;
  ```
  Keep the per-simulation concerns (survival, shield break, armor break, mechanic check, risk modifier, consumable math) untouched. Only the **per-weapon DPS** calculation moves to the chain.
- `src/test/bossSimulator.test.ts` — new or extended, asserts that `simulateBoss({...})`'s `dpsScore` (or equivalent) is consistent with `computeLoadoutDps(loadout, boss.weaknesses, boss.resistances, consumables)` to within ±5% (allowing for the ammo-window penalty and signature multipliers that the sim adds on top).

**Tests:** The parity test. Run a fixed loadout through both the chain and the sim and assert they're within tolerance.

**Verification gate:** Full gate. Push.

**Why this is its own PR:** This is the architectural refactor. The sim is 737 lines; touching it requires care. A 1-file PR with a tight ownership scope keeps the diff reviewable.

**Estimated scope:** 1 source file (replace ~40 lines of inline math with ~30 lines of chain calls), 1 test file. ~120 lines.

**Risk:** The sim has its own context (fight duration, ammo windows, signature mechanics, legendary effects). Some of these (signature, legendary) will move to the chain in PR E. For PR C, the sim's existing `applySignatureMechanic` is still called, and the chain's `signature` parameter is **not** passed yet — the sim multiplies by `sig.dpsMult` after the chain call. This means PR C is a *transitional* PR: the chain call is in the sim, but the sim still applies the per-fight signature modifier on top. PR E will fold the signature into the chain itself.

**This is the right shape for the series** — the user gets the chain-call wins (DRY, single source of truth) in PR C, and the full signature/legendary plumbing in PR E without breaking PR C.

---

### PR D — Fix element & resistance math (bossResistances array, real counter table, "vs standard" = raw)

**Goal:** Step 4 of the chain becomes a real element-vs-element table that accounts for both the boss's weaknesses and resistances. The "vs standard" baseline is raw (no element multiplier). The chain consumes `bossResistances: Element[]` from `BossDef`.

**Files owned (4):**
- `src/lib/stats/elementMatchup.ts` (NEW) — `computeElementMatchup(playerElement, weaknesses, resistances): number`. Returns 1.3 if `playerElement ∈ weaknesses`, 0.7 if `playerElement ∈ resistances`, 1.0 otherwise. Standard targets (no weaknesses/resistances) → 1.0.
- `src/lib/stats/dpsChain.ts` — replace `counterElementMultiplier` (lines 24-34) with a call to the new function. Remove the `getElementMatchup(element, 'flesh')` fallback (line 68). Change the type of `DpsContext.bossResistance` to `bossResistances: Element[]`. Step 5 (boss resistance multiplier) is removed — it's now in step 4.
- `src/lib/stats/characterStats.ts` — change the call to `computeLoadoutDps(liveWeapons, boss.weaknesses, boss.resistances)` instead of `computeLoadoutDps(liveWeapons, boss.weaknesses)`.
- `src/test/dpsChain.test.ts` — update tests for new shape, add tests for resistance penalties, "vs standard" = 1.0×, and the full 6-element counter cycle.
- `src/test/characterStatsDiorama.test.ts` — add tests that the diorama shows the resistance penalty when a player has a Fire weapon and the boss resists Fire.

**Verification gate:** Full gate. Push.

**Why this PR is its own:** It's the semantic change. It breaks the "1.3× only" test at `dpsChain.test.ts:55-57` (the fossil test). The user will see number changes on the diorama for non-matching elements and resisted elements. Document this in the PR description.

**Estimated scope:** 1 new file (~50 lines), 1 source file (~30 line changes), 2 test files (~50 line additions/changes). ~150 lines.

**Risk:** This is the riskiest PR in the series. The "vs standard" semantic change affects every "DPS (vs standard)" value shown on gear inspect sheets. The fix is correct, but the *number* on every existing weapon will shift. Communicate clearly.

---

### PR E — Expand consumables context to the full ~20-type table; fold signature/ammo into the chain

**Goal:** The chain knows about all consumable types (not just 2), and the signature/ammo-window logic moves from the boss sim into the chain. After this PR, the chain is the **only** place DPS is computed.

**Files owned (5):**
- `src/lib/stats/consumableEffects.ts` (NEW) — `getConsumableDpsMultiplier(consumableId, count, phase?): number`. Reads from `constants/consumables.ts` `ConsumableDef.effectRules.dpsMultiplier` and `ammoWindowUses`. Returns the multiplier for the given consumable count and the current fight phase. Centralizes the per-consumable math.
- `src/lib/stats/signatureMechanic.ts` (NEW) — `applySignatureMechanic(weapon, signatureContext): { dpsMult, statusMult, armorBreakMult, staggerAttempts }`. Extracted from `bossSimulator.ts:339-392`. The function's input now accepts a `signatureContext = { fullDuration, reloadDuration, fightDuration }` instead of three loose args.
- `src/lib/stats/dpsChain.ts` — `DpsContext.consumables` type changes from `{ TargetPainter?: number; OptimalAmmo?: number }` to `Record<string, number>`. Step 6 (consumables) iterates the record and calls `getConsumableDpsMultiplier`. Step 2 (signature) accepts a `signature: { fullDuration, reloadDuration, fightDuration }` parameter and calls `applySignatureMechanic` when present, otherwise returns 1.0.
- `src/lib/simulation/bossSimulator.ts` — remove the now-extracted `applySignatureMechanic` function (lines 339-392) and import it from the new module. Remove the inline consumable multiplier math (lines 542-554) and call the chain's step 6 instead. The sim now just passes consumables through to the chain and multiplies by `rm.dpsMult * (1 + skillBonuses.dps)` (the risk modifier and skill bonuses, which are sim-specific).
- `src/lib/stats/characterStats.ts` — pass `consumables: player.consumables` (or `{}` if not present) to `computeLoadoutDps` so the diorama's DPS chip reflects the player's equipped consumables.
- `src/test/consumableEffects.test.ts` (NEW) — tests for the consumable multiplier map.
- `src/test/signatureMechanic.test.ts` (NEW) — tests for the signature logic.
- `src/test/dpsChain.test.ts` — update for the new `consumables` shape and `signature` param.
- `src/test/bossSimulator.test.ts` — update for the sim calling the chain's step 6.

**Verification gate:** Full gate. Push.

**Why this PR is last:** It depends on PRs C and D (chain must be the chain-call site, must consume `bossResistances`). It also requires reading the `consumables.ts` effect rules carefully to make sure the per-consumable math matches what the sim was doing inline. The audit and the existing tests will catch any drift.

**Estimated scope:** 2 new files (~150 lines combined), 3 source files updated (~80 line changes), 3 test files (~150 lines combined). ~380 lines.

**Risk:** The consumable table has 20+ entries; some have phase-conditional behavior (e.g. `MidFight` consumables that only apply during shield/armor break). The new `getConsumableDpsMultiplier` needs a `phase` parameter or a phase-aware interface. The simplest correct approach: return a function `(phase) => multiplier` for consumables that have phase-conditional effects, or extend `DpsContext` with a `phase?: 'preFight' | 'shieldBreak' | 'armorBreak' | 'dps' | 'mechanic'` and have the chain skip phase-mismatched consumables. The PR description will call this out.

---

### PR F — Architecture reference doc (so future agents find the contract)

**Goal:** The chain's contract, the "always go through the chain" rule, the file-ownership map, the per-step math, and the standard vs boss-vs-boss-with-resistance usage patterns are documented in a single place a future agent will find.

**Files owned (2):**
- `references/dps-chain-v2.md` (NEW) — the architecture doc. Sections:
  1. The rule (single source of truth)
  2. The chain (file path, public API, per-step math)
  3. The DpsContext shape (every parameter, what it means, when to use it)
  4. The 4 call patterns (standard / boss / boss-with-resistance / boss-with-consumables)
  5. What to do when adding a new modifier (the recipe from the existing `dps-modifier-chain.md`)
  6. What NOT to do (inline formulas, frozen values that diverge, parallel paths)
  7. The file ownership map (so future PRs know who owns what)
  8. The change log (link to PRs A–E)
- `references/dps-modifier-chain.md` (UPDATE) — mark as superseded by v2, link to the new doc.

**Verification gate:** No code gate. The doc is checked by the user reading it.

**Why this is its own PR:** Docs-only. Small. Self-contained. Lands last because it documents the final state of the chain.

**Estimated scope:** 1 new file (~300 lines of well-formatted markdown), 1 file edit. ~310 lines.

---

## Cross-cutting decisions (locked in before PR work starts)

### D1: "vs standard" baseline is raw, not flesh

Current: `computeStandardDps` of a Fire weapon returns 1.3× of the raw formula (Fire is strong against flesh, the implicit standard target).
Locked decision: "vs standard" returns the **raw formula only** (no element multiplier). The docstring at `dpsChain.ts:21-23` already says this; the test at `dpsChain.test.ts:55-57` is a fossil that will be updated.

This is the right call because:
- The gear inspect's "DPS (vs standard)" is the baseline the player uses to compare two weapons. If it varies by element, the comparison is misleading.
- A Fire weapon and a Kinetic weapon with identical base stats will show different "vs standard" DPS today. The Kinetic weapon looks ~30% worse. That's a bug, not a feature.

### D2: `bossResistance: number` becomes `bossResistances: Element[]`

Current: `DpsContext.bossResistance?: number`. Never passed by any UI caller.
Locked decision: The chain consumes `bossResistances: Element[]` matching the shape of `BossDef.resistances`. Step 4's element matchup applies 0.7× for resistance, 1.3× for weakness.

This is the right call because:
- The real data is the array. Faking a flat multiplier would require computing one per boss, and the array already encodes the right information.
- Step 5 (the dead `* bossResistance` line) is removed. Step 4 becomes the single source of element matchup truth.

### D3: Consumables shape is `Record<string, number>`, not the 2-key struct

Current: `DpsContext.consumables?: { TargetPainter?: number; OptimalAmmo?: number }`.
Locked decision: `Record<string, number>` with optional `phase?: 'preFight' | 'shieldBreak' | 'armorBreak' | 'dps' | 'mechanic'` for phase-conditional effects.

This is the right call because:
- The real game has 20+ consumable types. The 2-key struct was a fossil from a "first iteration" that never got expanded.
- The `Record` shape matches what the boss sim already accepts (`BossSimulationInput.consumables: Record<string, number>`).
- Phase-conditional effects (MidFight consumables) are encoded via the `phase` field on the context, not by hardcoding per-consumable in the chain.

### D4: Signature mechanics live in the chain, but the chain's signature param is optional

Current: `applySignatureMechanic` lives in `bossSimulator.ts`. The chain has a 1.0× pass-through.
Locked decision: Move `applySignatureMechanic` to `src/lib/stats/signatureMechanic.ts`. The chain's `DpsContext.signature` is optional. When present, step 2 calls the new module. When absent, step 2 is 1.0×.

This is the right call because:
- Today the diorama says "240 DPS" (raw, no signature penalty) and the sim says "190 DPS" (with the 30% reload penalty). The player is confused.
- After PR E, the diorama and the sim both pass the same signature context to the chain, so the numbers agree.
- The signature param is optional so non-boss DPS displays (inventory, inspect) don't need to know about it.

### D5: Test counts after the series

| Test file | Before | After | Delta |
|---|---|---|---|
| `src/test/dpsChain.test.ts` | 13 | ~30 | +17 (resistances, counter cycle, signature, consumables) |
| `src/test/characterStatsDiorama.test.ts` | 7 | ~12 | +5 (resistance wiring, label flip) |
| `src/test/weaponGenerator.test.ts` | (new) | ~10 | new (frozen-vs-live parity) |
| `src/test/bossSimulator.test.ts` | (new or ext) | ~8 | new (chain-vs-sim parity) |
| `src/test/signatureMechanic.test.ts` | (new) | ~8 | new (signature math) |
| `src/test/consumableEffects.test.ts` | (new) | ~15 | new (consumable multipliers) |
| **Total** | **20** | **~83** | **+63** |

The user expects 117 currently. After the v2 series, ~180. The test count growth is intentional — the series replaces silent dead spots with assertions that would have caught the original bugs.

---

## Execution order and gates

PRs land in **A → B → C → D → E → F** order. Each PR:
1. Creates its branch: `git checkout -b feature/dps-chain-v2-pr-X origin/master`
2. Implements its owned files
3. Runs `npx tsc --noEmit && npm run lint && npm test && npm run build`
4. Commits: `git commit -m "PR X: <one-line summary>"`
5. Pushes: `git push -u origin feature/dps-chain-v2-pr-X`
6. Opens PR: `gh pr create --base master --head feature/dps-chain-v2-pr-X --title "PR #N: <title>" --body-file /tmp/pr-X-body.md`
7. Surfaces the URL to the user

After all 6 are pushed:
- Run the integration-merge-test from `references/multi-pr-integration-merge-test.md` (clone /data/cybercache-integration, fetch all 6 branches, merge in order, verify after each)
- Report results to the user
- Clean up the integration clone

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Frozen combatPower values change for every existing weapon (PR B) | High | Cosmetic | Call out in PR description. Numbers shift, but they're correct now. |
| "vs standard" DPS changes for every weapon (PR D) | High | Cosmetic | Same. The 1.0× raw baseline is correct. |
| Boss sim parity test fails because the sim has additional logic (skill bonuses, risk modifier) the chain doesn't | High | Test friction | Tolerance of ±10% on the parity test. The sim's `dpsScore` is `30 / timeToKill`, not raw DPS, so the math is different by design. |
| Consumable table has hidden phase-conditional effects not yet documented | Medium | Mechanical | Audit `consumables.ts` thoroughly in PR E. Add per-consumable comments where the math is non-obvious. |
| LiveTurfDiorama starts showing consumable-aware DPS and shifts the displayed number mid-session | Medium | UX | Acceptable. The display is honest now. The diorama's "vs boss" chip becomes the source of truth for "what DPS will I deal if I start this fight right now." |
| Force-push needed because of a structural defect discovered late | Low | Workflow | Use `git push --force-with-lease` only with user consent per the skill's Pitfall B. |
| One of the PRs grows too large and should be split | Medium | Schedule | Watch the diff size at commit time. If a PR's diff exceeds 500 lines, stop and propose a split. |

---

## What "easy for future agents" means concretely

The user's concern: future agents should be able to find the chain's contract, understand the modifier model, and not invent parallel formulas.

Concrete deliverables:
1. **`src/lib/stats/dpsChain.ts`** — fully JSDoc'd. Every step has a comment explaining the math. Every parameter on `DpsContext` has a JSDoc with the data type, default value, and a one-line example.
2. **`src/lib/stats/elementMatchup.ts`** — the new module is the single source of element math. Anyone needing to add a new element only touches this file.
3. **`src/lib/stats/signatureMechanic.ts`** — anyone adding a new weapon signature only touches this file.
4. **`src/lib/stats/consumableEffects.ts`** — anyone adding a new consumable's DPS multiplier only touches this file (the existing `consumables.ts` already has `effectRules`; the new module reads from it).
5. **`references/dps-chain-v2.md`** — the architecture doc. Lists the rule, the API, the per-step math, the call patterns, the "what to do" recipe, the "what not to do" anti-patterns, and the file ownership map.
6. **A test that fails if anyone adds an inline DPS formula** — the existing `dpsChain.test.ts` plus the new `weaponGenerator.test.ts` and `bossSimulator.test.ts` parity tests will catch any future regression. If someone writes `baseDamage * attackSpeed` outside the chain, the parity test (which asserts that the generator's `combatPower` equals the chain's `computeStandardDps`) will fail.
7. **Lint rule (optional, can land in a follow-up PR)** — `no-restricted-syntax` ESLint rule that flags `baseDamage *` outside `src/lib/stats/`. Not in this series; can be a future PR.

---

## Out of scope for this series (called out so it's not lost)

These are real issues surfaced by the audit but not in scope for v2:

1. **Affix diversity** — `Affix.stat` can be `string` (loose). Only `weaponDamage` from `combat` affixes is folded into the chain. `elemental`, `boss`, `idle`, `skill` affixes are silent. Future series: type-affix and fold them in.
2. **`Build Identity` from `dominantWeaponType`** — the skill's `build-identity-and-combat-stats.md` notes this; not in scope here.
3. **Profile screen's "Build Identity" chip** — `references/stats-as-design-not-data.md` says read from `dominantWeaponType`; the Profile screen may still read from `Object.entries(typeCounts)`. Audit-only finding; future cosmetic PR.
4. **LootScreen "Unique Affix Types" count** — the audit said it counts `affix.id` (which is `${stat}_${index}`) instead of distinct `affix.stat` values. Future cosmetic PR.
5. **Per-area XP multiplier migration** — already landed in PR #58.
6. **Boss "preview" UI** — `HelpScreen.tsx` promises a "Matchup Chip" that the audit confirmed is now delivered by PR #60 + this v2 series.

---

## The plan, in 3 sentences

Make the chain in `src/lib/stats/dpsChain.ts` the only place DPS is computed, by (1) showing DPS on every loadout-decision UI surface, (2) refactoring `weaponGenerator` and `bossSimulator` to call the chain, (3) fixing the element/resistance/consumable math to match the real game data shapes, and (4) documenting the contract in `references/dps-chain-v2.md` so future agents can find it.

Land as 6 small, independently-reviewable PRs (A cosmetic, B generator, C simulator, D element math, E consumables + signature, F architecture doc) on a single feature branch, with the integration-merge-test run after all 6 are pushed.
