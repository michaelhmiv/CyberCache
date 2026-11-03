/**
 * Per-item salvage feedback from the LIVE verified recycle result
 * (cc_recycle_item via verifiedOps.recycleItem).
 *
 * What the server actually pays (migration 0053, the latest
 * restatement): Scrap on every recycle; legendary cores when a
 * Legendary is salvaged; and ONE bonus material — only for Common
 * items, only with King of Scrap keystone points, on a
 * 0.25 × points chance. It does NOT pay the broad material/essence
 * yield of the local calculateSalvageYield formula (that formula
 * belongs to the retired local scrapItem path, which UI salvage
 * must not use — AGENTS.md).
 *
 * The per-item call sites used to build their feedback with every
 * material field zeroed, so a bonus material the server DID pay
 * never appeared in the toast. This mapper is the one place the
 * server result becomes display yield — it names exactly what was
 * paid, nothing more.
 */
import type { SalvageYield } from '@/constants/salvageRules';

/** Bonus-material id → the fixed yield field that prints it. */
const BONUS_FIELD: Record<string, 'scrapAlloy' | 'ballisticParts' | 'reactiveComponents' | 'techFragments'> = {
  ScrapAlloy: 'scrapAlloy',
  BallisticParts: 'ballisticParts',
  ReactiveComponents: 'reactiveComponents',
  TechFragments: 'techFragments',
};

export function salvageYieldFromRecycleResult(result: Record<string, unknown>): SalvageYield {
  const bonusMaterial = typeof result.bonus_material === 'string' ? result.bonus_material : null;
  const field = bonusMaterial ? BONUS_FIELD[bonusMaterial] : undefined;
  const y: SalvageYield = {
    scrapValue: Number(result.scrap_award ?? 0) || 0,
    scrapAlloy: 0,
    ballisticParts: 0,
    reactiveComponents: 0,
    techFragments: 0,
    voidDust: 0,
    essences: {},
    legendaryCores: Number(result.cores_award ?? 0) || 0,
  };
  if (field) y[field] = 1;
  return y;
}
