# Button Wiring Audit — CyberCache

Date: 2026-06-16
Branch: `fix/button-wiring-audit`

## Scope

Audited every JSX `button` and `motion.button` under `src/` for basic responsiveness wiring:

- A live button must have an activation handler (`onClick`, pointer/mouse activation) or be an intentional submit button.
- Intentionally inactive buttons must be explicitly disabled/`aria-disabled`.
- Loadout equip/unequip must sync against the server-authored loadout state and must not leave stale client slot references when the backend returns only changed item rows.

## Audit results

Automated AST scan found 187 button-like elements.

Findings:

1. **One dead enabled button**
   - `src/screens/MarketScreen.tsx` buy-tab filter icon button had no `onClick`, no `type`, and was not disabled.
   - Impact: visually tappable control gave no feedback or behavior.

2. **Loadout RPC sync had a stale-row fallback gap**
   - The current backend migration already returns `loadout` snapshots from `cc_equip_item` / `cc_unequip_slot`, validates slot compatibility, and returns cleared items.
   - The client sync path still needed a defensive fallback for older/partial RPC payloads: when a server item row arrives as `equipped_slot = null`, clear that item from any local slot; when an item row arrives equipped in a slot, clear the same item from all prior local slots before setting the new slot.
   - Impact: if Supabase returns only the changed item row, tapping to move a weapon between loadout slots can look like nothing happened or leave duplicate/stale local slot state until a full refresh.

## Implementation plan

1. Add a regression audit that fails CI on enabled dead buttons.
2. Wire the Market filter icon to clear active buy filters and show feedback.
3. Surface loadout RPC failures inside the gear picker sheet and show busy labels while an equip/unequip request is in flight, instead of leaving the user staring at an unchanged picker.
4. Harden `syncVerifiedResult` item-row fallback so loadout slot state is corrected even when an RPC payload lacks the newer `loadout` snapshot.
5. Add targeted loadout sync tests for:
   - moving an equipped item between slots from a single item row,
   - clearing an unequipped item row from stale local slots,
   - honoring the server `loadout` snapshot as final truth.
6. Run targeted tests, full test suite, build, lint, architecture guard, and TypeScript.
7. Create a PR, wait for checks, then merge to `master` if green.

## Verification contract

This audit is now enforced by `src/test/buttonWiringAudit.test.ts`. New dead enabled buttons should fail `npm test` with the exact file/line/snippet.
