# Boss Activity Enforcement

Boss prep and boss fight resolution are now treated as productive world activities rather than loose modal-only actions.

## Enforced in this PR

Boss combat resolution requires the selected boss to be the active `boss_prep` activity first.

The boss prep modal can sync the current boss into active prep. Once combat is initiated, the modal transitions the activity to `boss_fight` before resolving the attempt.

After the attempt is resolved, the active activity is cleared back to standby. The result remains visible in the modal, but the productive boss activity is no longer left running after rewards, defeat progression, pity updates, and consumable use are applied.

## Activity states used

- `boss_prep`: the player is actively preparing for a specific boss.
- `boss_fight`: the player is actively resolving combat against that boss.
- `idle_standby`: the modal returns here after the fight result is applied.

## Design rule

No boss victory, defeat, reward roll, consumable spend, unlock, pity update, or boss attempt log should occur unless the user has transitioned through the active boss activity path.

This keeps public activity, dashboard visuals, and actual progression aligned.
