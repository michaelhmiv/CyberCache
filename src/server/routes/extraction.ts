/**
 * Extraction routes (Extraction occupation, migration 0033).
 *
 *   GET /api/extraction/state — settle, then state + preview
 *
 * Trust model (the #207 pattern): identity comes from the JWT only.
 * The read SETTLES FIRST — accrual under the settlement window plus
 * finalization of every completed pass — then renders state from
 * server records: the extraction_state row, the player's mastery,
 * and a preview priced by the content owner
 * (src/content/extraction.ts) from the CURRENT loadout. Starting,
 * switching, and stopping extraction ride the ordinary activity
 * path (POST /api/activity/set with kind 'extraction'); the start
 * gates live in cc_set_active_action (0033) — verified account, no
 * standing death record, unlocked area, Deep Delve mastery — not
 * here. This route starts nothing and trusts nothing from a body
 * (there is no body).
 *
 * The preview's gear factor is a PRICING readout (what a pass
 * settling now would pay and why), never a readiness or win-chance
 * figure — extraction has no opponent to read out.
 */
import type { Request, Response } from 'express';
import type { AuthConfig } from '../auth/routes';
import type { EconomyConfig } from '../economy/config';
import type { ChefGameplayStore } from '../gameplay/store';
import {
  EXTRACTION_PASS_MS,
  extractionPreview,
  resolveExtractionLevers,
  type ExtractionLeverValues,
  type ExtractionMethod,
} from '../../content/extraction';
import { cacheRankBonuses } from '../../content/cacheRank';
import { HOT_AREA_MATERIAL_BONUS, isHotArea } from '../../content/hotArea';
import { getAuthenticatedChefPlayer, sendRouteError } from './chefRouteAuth';

export type ExtractionConfig = AuthConfig & {
  economyConfig?: EconomyConfig;
  /** Clock override (tests pin the hot-area day). */
  now?: () => Date;
};

async function extractionLevers(config: ExtractionConfig): Promise<ExtractionLeverValues> {
  if (!config.economyConfig) return resolveExtractionLevers();
  const values = await config.economyConfig.snapshot();
  return resolveExtractionLevers(values);
}

function nowOf(config: ExtractionConfig): Date {
  return config.now ? config.now() : new Date();
}

export function createGetExtractionHandler(store: ChefGameplayStore, config: ExtractionConfig) {
  return async function handleGetExtraction(req: Request, res: Response): Promise<void> {
    try {
      const playerId = getAuthenticatedChefPlayer(config, req);
      const now = nowOf(config);
      const economyValues = config.economyConfig ? await config.economyConfig.snapshot() : undefined;
      const levers = await extractionLevers(config);
      const hotAreaMaterialBonus =
        typeof economyValues?.hotAreaMaterialBonus === 'number'
          ? economyValues.hotAreaMaterialBonus
          : HOT_AREA_MATERIAL_BONUS;

      // Facts the settle prices Cache Rank from (server records).
      const profile = await store.getSettlementProfile(playerId);
      const cacheRankXpFraction = cacheRankBonuses(profile?.cache_rank_spends, economyValues).xp;

      // Settle first: accrual under the lazy window + finalization
      // of completed passes. A player who never started has no
      // state row and settles nothing.
      const settled = await store.settleExtraction(playerId, {
        levers,
        hotAreaMaterialBonus,
        maxAdvanceMs: null,
        cacheRankXpFraction,
        now,
      });

      const [state, facts, activeAction] = await Promise.all([
        store.getExtractionState(playerId),
        store.getExtractionFacts(playerId),
        store.getActiveAction(playerId),
      ]);

      const active = activeAction?.active_action === 'extraction';
      const method: ExtractionMethod = state?.method === 'deep' ? 'deep' : 'surface';
      const preview = state && facts
        ? extractionPreview({
            areaId: state.area_id,
            method,
            level: facts.player_level,
            masteryLevel: facts.mastery_level,
            shield: facts.shield_hp > 0 || facts.shield_mitigation > 0
              ? { hp: facts.shield_hp, mitigation: facts.shield_mitigation, element: facts.shield_element }
              : null,
            isHot: isHotArea(state.area_id, now),
            levers,
            hotAreaMaterialBonus,
          })
        : null;

      res.json({
        verified: true,
        extraction: {
          active,
          hasState: state != null,
          areaId: state?.area_id ?? null,
          method: state?.method ?? 'surface',
          passAreaId: state?.pass_area_id ?? null,
          passMethod: state?.pass_method ?? 'surface',
          accruedMs: state?.accrued_ms ?? 0,
          passMs: EXTRACTION_PASS_MS,
          pendingPasses: state?.pending_passes.length ?? 0,
          finalizedPasses: state?.finalized_passes ?? 0,
          totalXpAwarded: state?.total_xp_awarded ?? 0,
          mastery: {
            level: facts?.mastery_level ?? 1,
            xp: facts?.mastery_xp ?? 0,
          },
          preview,
          settled: {
            advancedMs: settled.advancedMs,
            xpAwarded: settled.xpAwarded,
            materials: settled.materials,
            essences: settled.essences,
            passes: settled.passes,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[chef] extraction state failed:', message);
      sendRouteError(res, 'Extraction state failed', err);
    }
  };
}
