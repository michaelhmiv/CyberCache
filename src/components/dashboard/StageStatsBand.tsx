import React, { useEffect, useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  useActiveBuffsStore,
  useActivityStore,
  useIdleStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import { useNow } from '@/hooks/useNow';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import { buildStageStatsBand, type StageBandJob } from '@/lib/stats/stageStatsBand';
import { statToneTextClass } from '@/components/stats/statToneStyles';
import { getRoamingArea } from '@/constants/roamingAreas';
import {
  conditionFraction,
  effectiveVehicleYield,
  vehicleAffixTotals,
  vehicleBurnPerTick,
  vehicleMaterialBonusChance,
} from '@/lib/vehicles/vehicles';
import { effectiveOfflineCapHours } from '@/content/offlineCap';
import { getResearchState } from '@/lib/chef/chefClient';
import {
  EXTRACTION_DEEP_GEAR_FACTOR,
  EXTRACTION_PASS_MS,
  expectedPassDamage,
  extractionGearFactor,
  extractionSurvivalPool,
  resolveExtractionLevers,
  type ExtractionShieldFacts,
} from '@/content/extraction';
import type { BossDef } from '@/types/boss';
import type { Weapon } from '@/types/items';

/**
 * The stage's stats band — the content of the diorama's bottom
 * ribbon (owner direction 2026-11-02). The ribbon used to narrate
 * the latest tick event ("+1 BallisticParts Field sweep recovered
 * BallisticParts"); the feed cards below the stage carry events
 * now, so the ribbon shows the player's EFFECTIVE STATS for the
 * action they're in: the hero number is the effective value, and
 * where modifiers moved it off base, the delta prints beside it
 * smaller, green for gains and red for losses — "this is a numbers
 * game… we need to lean into that."
 *
 * Display only: every number derives from the canonical summaries
 * (buildCharacterStatSummary / buildCharacterMechanicsSnapshot,
 * assembled with the same inputs DashboardDeck uses) and the
 * shared content helpers — the band computes no gameplay outcome.
 * The band is a horizontal scroller at honest type sizes
 * (DESIGN.md §6: scroll, never shrink), flush at the inline start
 * with an edge fade, and the Loadout door is pinned at the band's
 * end, always reachable, ≥44dp.
 */
export const StageStatsBand: React.FC<{
  /** The boss the stage is set against (boss_fight context). */
  boss?: BossDef | null;
  onOpenLoadout: () => void;
}> = ({ boss, onOpenLoadout }) => {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const skills = useSkillStore();
  const survival = useSurvivalStore();
  const workshop = useWorkshopStore();
  const activeBuffsStore = useActiveBuffsStore();
  const kind = useActivityStore((s) => s.current.kind);
  const selectedAreaId = useIdleStore((s) => s.selectedRoamingAreaId);
  const now = useNow();

  // The AFK cap's earned hours come from Research completions —
  // Chef-owned state, read like the ResearchChip reads it. Until the
  // read lands (or if the Chef is unreachable) the band shows the
  // base-only cap; settlement itself is always server-derived.
  const [researchCapHours, setResearchCapHours] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (!cancelled) setResearchCapHours(result.research.bonuses.offlineCapBonus);
      })
      .catch(() => {
        // Chef unreachable: base-only display.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = useMemo(() => {
    const area = getRoamingArea(selectedAreaId);
    const weapons = [loadout.getWeapon('primary'), loadout.getWeapon('secondary'), loadout.getWeapon('heavy')]
      .filter((w): w is Weapon => !!w);
    const shield = loadout.getShield();
    const skillBonuses = skills.getBonuses();
    const activeBuffs = activeBuffsStore.buffs.filter((buff) => buff.expiresAt > now);
    const bossContext = kind === 'boss_fight' ? (boss ?? undefined) : undefined;
    const summaryInput = {
      player,
      weapons,
      shield,
      classMod: loadout.getClassMod(),
      relic: loadout.getRelic(),
      ordnance: loadout.getOrdnance(),
      spentSkills: skills.spent,
      boss: bossContext,
      activeBuffs,
      consumableMods: buildConsumableInventoryMods(player.consumables),
      consumableInventory: player.consumables,
      medKitBuffer: survival.medKitBuffer,
    };
    const summary = buildCharacterStatSummary(summaryInput);
    const snapshot = buildCharacterMechanicsSnapshot(summaryInput);

    // Vehicle facts — the same helpers and the same tank source
    // (player.vehicleFuel) VehicleStatusLine reads.
    const vehicle = loadout.getVehicle();
    const fuel = player.vehicleFuel;
    let vehicleFacts = {
      equipped: false,
      active: false,
      factor: 1,
      potentialFactor: 1,
      fuelUnits: fuel,
      fuelTicks: 0,
      inactiveReason: null as 'empty' | 'worn' | null,
      scannerPct: 0,
      cargoChance: 0,
    };
    if (vehicle) {
      const fraction = conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax);
      const potentialFactor = effectiveVehicleYield(vehicle, fraction, 1, skillBonuses.vehicleYieldBonus ?? 0);
      const active = fuel > 0 && fraction > 0;
      const burn = vehicleBurnPerTick(vehicle, skillBonuses.vehicleFuelBonus ?? 0);
      vehicleFacts = {
        equipped: true,
        active,
        factor: active ? potentialFactor : 1,
        potentialFactor,
        fuelUnits: fuel,
        fuelTicks: active && burn > 0 ? Math.floor(fuel / burn) : 0,
        inactiveReason: active ? null : fuel <= 0 ? 'empty' : 'worn',
        scannerPct: vehicleAffixTotals(vehicle).scannerPct,
        cargoChance: vehicleMaterialBonusChance(vehicle),
      };
    }

    // Crafting facts from the workshop server view.
    const server = workshop.server;
    const activeJobs = (server?.jobs ?? []).filter((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused');
    const running = activeJobs.find((j) => j.state === 'running') ?? activeJobs[0];
    const runningJob: StageBandJob | null = running
      ? {
          name: running.name,
          bench: running.bench,
          kind: running.kind,
          recipeId: running.recipeId,
          state: running.state,
          unitsTotal: running.unitsTotal,
          unitsCompleted: running.unitsCompleted,
          unitDurationMs: running.unitDurationMs,
          remainingMs: running.remainingMs,
          catalystMaterialId: running.catalystMaterialId,
        }
      : null;
    const benchesFree = Math.max(
      0,
      (server?.benches ?? 1) - new Set(activeJobs.map((j) => j.bench)).size,
    );

    // Extraction pass facts — the content math the panel previews
    // with, priced from the equipped shield + selected area.
    const shieldFacts: ExtractionShieldFacts | null = shield
      ? { hp: shield.hp, mitigation: shield.mitigation, element: shield.element }
      : null;
    const extractionFacts = {
      passMs: EXTRACTION_PASS_MS,
      gearFactor: extractionGearFactor({ level: player.level, shield: shieldFacts, area, levers: resolveExtractionLevers() }),
      pool: extractionSurvivalPool(player.level, shieldFacts),
      expectedPassDamage: expectedPassDamage(area, shieldFacts),
      deepGateFactor: EXTRACTION_DEEP_GEAR_FACTOR,
    };

    // The standby AFK cap — the one formula, with the Settings
    // screen's limiter semantics (stored value counts only inside
    // 1–24; anything else is no limiter).
    const storedLimiter = player.offlineCapHours >= 1 && player.offlineCapHours <= 24 ? Math.floor(player.offlineCapHours) : null;
    const offlineCapHours = effectiveOfflineCapHours({
      researchCapHours,
      bonusHours: Math.max(0, Math.floor(skillBonuses.offlineCapBonus ?? 0)),
      userCapHours: storedLimiter,
    });

    return buildStageStatsBand({
      kind,
      summary,
      snapshot,
      weapons,
      area,
      survival: {
        currentHp: survival.currentHp,
        maxHp: survival.maxHp,
        shieldHp: survival.shieldHp,
        isDead: survival.isDead,
      },
      vehicle: vehicleFacts,
      boss: bossContext ? { recommendedPower: bossContext.recommendedPower, dps: bossContext.dps } : null,
      crafting: {
        runningJob,
        benchesFree,
        masteries: server?.masteries ?? {},
        playerLevel: player.level,
      },
      extraction: extractionFacts,
      offlineCapHours,
    });
  }, [player, loadout, skills, survival, workshop.server, activeBuffsStore.buffs, now, kind, selectedAreaId, boss, researchCapHours]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" data-testid="stage-stats-band">
      <div className="relative min-w-0 flex-1">
        <div
          data-testid="stage-stats-scroller"
          className="flex items-center gap-3 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {entries.map((e) => (
            <span key={e.key} className="flex items-baseline gap-1" data-testid={`stage-stat-${e.key}`}>
              <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">{e.label}</span>
              <span className={`text-[13px] font-black leading-tight ${statToneTextClass[e.tone]}`}>{e.display}</span>
              {e.delta && (
                <span
                  className={`text-[11px] font-black leading-tight ${e.delta.tone === 'green' ? 'text-green' : 'text-red'}`}
                  data-testid={`stage-stat-${e.key}-delta`}
                >
                  {e.delta.display}
                </span>
              )}
            </span>
          ))}
        </div>
        {/* §6 scroll affordance: edge fade at the scroll end. */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent" />
      </div>
      <button
        type="button"
        onClick={onOpenLoadout}
        data-testid="stage-stats-loadout"
        className="bl-secondary flex min-h-[44px] shrink-0 items-center gap-1.5 px-3 py-2 text-[11px] font-black text-amber"
      >
        <PxIcon name="diamondIn" size={13} />
        Loadout
      </button>
    </div>
  );
};
