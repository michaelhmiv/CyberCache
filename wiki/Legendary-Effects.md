# Legendary Effects

A **legendary effect** is a named signature behavior that a Legendary
weapon can carry on top of its affixes — one effect per weapon, rolled
when the weapon is generated. Effects are build-defining: they change
how a boss fight pays out, how your scrap flows, or how a defeat stings,
and hunting a specific effect on a specific frame is a core endgame
loop (the hunt is tracked in [[Collections]]).

## Where effects come from

There are **25 legendary effects** in the game. They are gated by boss
tier — the deeper the boss, the wider the pool:

- **8 effects** unlock from boss tier 1.
- **12 more** join the pool from boss tier 4.
- **5 more** join from boss tier 7.

Effects roll on Legendary weapons from **boss drops** — that is the
only live source. Weapons forged from a [[Caches|cache]] never carry
an effect, and neither do crafted ones (below). That exclusivity is
deliberate: an effect is the mark of a legendary you fought for.

Workshop-[[Crafting|crafted]] weapons never carry an effect: crafting is
capped at Epic, and no crafting process adds one. [[Gear|Reforge]] never
adds, removes, or changes an effect either — it is part of the weapon's
identity.

## Read effects honestly: three kinds of "works"

Not every effect's description is simulated the same way, and the game
does not hide that. When you judge an effect, know which kind it is:

- **Fully live.** The mechanic does exactly what the text says, in the
  real game systems — boss loot, roaming claims, salvaging, refunds.
- **Simulated proxy.** The described mechanic depends on a system the
  boss engine doesn't have (per-hit chains, charge refunds, DoT stacks),
  so the boss simulator approximates its value as a flat combat bonus.
  The weapon is genuinely stronger in boss fights — just by the
  approximation, not by the literal mechanism.
- **Partial.** Part of the text is wired exactly and part is proxied or
  has no counterpart yet. The classic case is anti-heal: some bosses
  simply have no healing mechanic for an effect to eat, so that half of
  the text currently does nothing while the other half works in full.

The generated table in [[Reference-Legendary-Effects]] lists every
effect with its status, so you can check any weapon before you build
around it.

## Examples

These descriptions are the game's own words for six representative
effects:

- **Debt Collector** (tier 1, fully live) — "Each failed attempt vs.
  the same boss grants +3% win chance next time, stacking to a cap of
  +30%." Losing to a boss makes the rematch measurably kinder.
- **Armor Eater** (tier 1, partial) — "Corrosive procs reduce boss
  repair/healing by 50% and grant +20% armor break contribution." The
  armor-break half is wired for Corrosive weapons; the anti-heal half
  waits on bosses that heal.
- **Second Opinion** (tier 4, fully live) — "On boss victory, the loot
  roll happens twice. You keep the stronger weapon; the other is
  auto-scrapped." Two rolls, keep the best, scrap the rest — no
  inventory chore.
- **Borrowed Time** (tier 4, proxy) — "Once per boss attempt, if you
  would fail the Survival Check, auto-consume 1 Med Kit and pass
  instead." In the simulator this runs as a flat survival bonus; no Med
  Kit is actually consumed.
- **Market Crash** (tier 4, fully live) — "This weapon's scrap value is
  4x normal when recycled." A farming and cleanup tool: the multiplier
  applies to scrap when you recycle the weapon itself.
- **Jackpot** (tier 7, fully live) — "Every 150th
  enemy killed by this weapon drops a Cache Key fragment." Roaming with
  a Jackpot primary slowly prints cache keys.

Other effects bend victory credits, refund consumables on defeat, boost
scrap from kills, strengthen your Secondary weapon's contribution, or
trade raw elemental damage for a drawback — Glass Sun's "+50% Fire
damage, but -30% Shield effectiveness" is the honest shape of the tier:
power with a price.

## Hunting an effect

- Effects are tied to boss tiers, so farm the tier that unlocks the one
  you want — see [[Bosses]] for the roster and their dedicated drops.
- A Legendary weapon's effect is fixed at generation. If you want a
  different effect, you need a different weapon.
- Every effect you obtain for the first time fills an entry in
  [[Collections]] — all 25 are collectible.
- Salvaging an effect-carrying Legendary weapon pays one extra
  legendary core (see [[Collections]]), which is exactly why effect
  weapons are the most valuable salvage in the game — and why you
  usually shouldn't.

The full 25-effect table — name, exact trigger text, source, minimum
boss tier, and implementation status — is a generated table and lives
in [[Reference-Legendary-Effects]].

---

_Source of truth: `src/constants/legendaryEffects.ts`, `src/lib/legendaryEffects.ts`. Last synced from the repo `wiki/` directory — see `.sync-sha` for the master commit this page was published from._
