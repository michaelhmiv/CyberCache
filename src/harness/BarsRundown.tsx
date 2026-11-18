import React, { useMemo } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { statToneRailClass, statToneTextClass } from '@/components/stats/statToneStyles';
import { useLoadoutStore, usePlayerStore, useSurvivalStore } from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { buildHeroRundown, type HeroRundownModel } from '@/lib/stats/heroRundown';
import { endlessEncounterForDepth, ENDLESS_MILESTONE_EVERY } from '@/content/endless';
import { getRoamingArea } from '@/constants/roamingAreas';
import { signatureMaterialForArea } from '@/content/roamingEvents';
import { BARS_ENDLESS_RUN, BARS_EXTRACTION_STATE } from './barsSeed';

/**
 * R2 bars-render: the rundown-zone treatments (presentation
 * only, dash/bars-render — never merged).
 *
 * Grammar: the approved Craft V1 bench rundown (PR #610) — the
 * shipped zone's bordered well, 11px labels, 15px heroes, fact
 * cells with hairline dividers, one slim vitals line. The two
 * treatments below answer the zone for their mode the way the
 * bench rundown answers it for Craft:
 *
 *   ChamberRundown (Endless run) — the run's money decision
 *     rides the zone: escrow at risk as the hero, next depth /
 *     death payout / next milestone as fact cells, and a BANK
 *     button carrying the full payout as the zone's foot.
 *   ExtractRundown (Extraction view) — the paused delve's
 *     facts ride the zone: next-pass countdown as the hero,
 *     gear factor / per-pass draws / mastery as fact cells,
 *     the Deep Delve ×0.80 warning as its own line (the panel
 *     prints it only while the delve is active; a paused delve
 *     is exactly when the player weighs resuming), and a
 *     Resume button as the zone's foot — Extraction is a view
 *     over another occupation's screen, so its first screen is
 *     the zone's, and a sticky bar inside the panel cannot
 *     reach it (the panel head starts below the fold there).
 *
 * Data: both read ./barsSeed — today the panels hold this
 * state in component useState (from getEndlessMe /
 * getExtractionState); no store carries it. The production
 * build lifts run state into a slice (extractionFeedSlice is
 * the precedent) and these components take props from it.
 * The shared buff line is omitted here: with the seeded state
 * nothing is active, so the shipped line renders nothing —
 * production zones carry it exactly as the bench rundown does.
 *
 * Display only; the BANK button is an affordance study — it
 * performs no action in the rendering.
 */

function useVitalsModel(): HeroRundownModel {
  const survival = useSurvivalStore();
  const playerLevel = usePlayerStore((s) => s.level);
  const shieldHp = useLoadoutStore((s) => s.getShield()?.hp ?? 0);
  const { summary, snapshot, weapons, primary, skillBonuses } = useCharacterStatSummary(null);
  useSyncSurvivalMaxHp(playerLevel, shieldHp);
  return useMemo(
    () =>
      buildHeroRundown({
        summary,
        snapshot,
        weapons,
        primary,
        skillBonuses,
        survival: {
          currentHp: survival.currentHp,
          maxHp: survival.maxHp,
          shieldHp: survival.shieldHp,
          isDead: survival.isDead,
        },
        bossContext: false,
      }),
    [summary, snapshot, weapons, primary, skillBonuses, survival],
  );
}

const VitalsLine: React.FC<{ model: HeroRundownModel }> = ({ model }) => (
  <div className="flex items-stretch border-t border-border/60">
    <div className="min-h-[44px] min-w-0 flex-[1.5] px-2 py-1.5">
      <span className="flex items-baseline justify-between gap-1">
        <span className="text-[11px] font-black uppercase text-text-muted">HP</span>
        <span className={`whitespace-nowrap text-[15px] font-black leading-tight ${statToneTextClass[model.hp.tone]}`}>
          {model.hp.display}
        </span>
      </span>
      <span className="mt-1 block h-1 w-full bg-bg" aria-hidden>
        <span className={`block h-full ${statToneRailClass[model.hp.tone]}`} style={{ width: `${Math.round(model.hp.fraction * 100)}%` }} />
      </span>
    </div>
    <div className="flex min-h-[44px] min-w-0 flex-[0.75] items-center justify-between border-l border-border/60 px-2 py-1.5">
      <span className="text-[11px] font-black uppercase text-text-muted">Shield</span>
      <span className={`whitespace-nowrap text-[15px] font-black leading-tight ${statToneTextClass[model.shield.tone]}`}>
        {model.shield.display}
      </span>
    </div>
  </div>
);

const FactCell: React.FC<{ label: string; value: string; valueCls?: string }> = ({ label, value, valueCls }) => (
  <div className="min-h-[44px] min-w-0 flex-1 border-l border-border/60 px-2 py-1.5 first:border-l-0">
    <span className="block truncate text-[11px] font-black uppercase text-text-muted">{label}</span>
    <span className={`block truncate whitespace-nowrap text-[15px] font-black leading-tight ${valueCls ?? 'text-text-primary'}`}>{value}</span>
  </div>
);

const zoneCls = 'relative border-2 border-t-0 border-border bg-surface/95 shadow-[0_10px_22px_rgba(0,0,0,0.45)]';

export const ChamberRundown: React.FC = () => {
  const vitals = useVitalsModel();
  const run = BARS_ENDLESS_RUN;
  const nextDepth = run.depthReached + 1;
  const next = endlessEncounterForDepth(nextDepth, run.startLevel);
  const nextMilestone = Math.ceil(nextDepth / ENDLESS_MILESTONE_EVERY) * ENDLESS_MILESTONE_EVERY;
  const deathPays = Math.floor((run.escrowCredits * run.deathPayoutPercent) / 100);

  return (
    <div data-testid="chamber-rundown" className={zoneCls}>
      <div className="flex min-h-[44px] items-center gap-2 px-2 py-2">
        <span className="flex items-center justify-center border border-border bg-bg text-fuchsia" style={{ width: 30, height: 30 }}>
          <PxIcon name="infinity" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-black uppercase text-text-muted">Chamber</span>
            <span className="text-[11px] font-black uppercase text-amber">At Risk</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-black text-text-primary">Depth {run.depthReached} cleared</span>
            <span className="whitespace-nowrap text-[15px] font-black leading-tight text-text-primary">
              {run.escrowCredits.toLocaleString()}
              <span className="ml-1 text-[11px] font-black uppercase text-text-muted">cr escrow</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex border-t border-border/60">
        <FactCell label="Next" value={`Depth ${nextDepth}`} />
        <FactCell label="Death pays" value={`${deathPays.toLocaleString()} cr`} />
        <FactCell label="Milestone" value={`Depth ${nextMilestone}`} />
      </div>
      <div className="border-t border-border/60 px-2 py-1 text-[11px] font-bold leading-snug text-text-muted">
        Next: <span className="text-text-secondary">{next.name}</span>
        <span className="text-text-muted"> · Lv.{next.level} {next.kind === 'boss' ? 'boss' : 'pack'} · best depth {run.bestDepth}</span>
      </div>
      <VitalsLine model={vitals} />
      <div className="border-t border-border/60 px-2 py-2">
        <button
          type="button"
          className="bl-primary min-h-[48px] w-full px-4 text-[11px] font-black uppercase tracking-wider"
        >
          Bank &amp; Leave — {run.escrowCredits.toLocaleString()} cr · {run.escrowXp.toLocaleString()} XP · {run.escrowScrap.toLocaleString()} scrap
        </button>
      </div>
    </div>
  );
};

const formatClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

export const ExtractRundown: React.FC = () => {
  const vitals = useVitalsModel();
  const state = BARS_EXTRACTION_STATE;
  const preview = state.preview;
  const area = getRoamingArea(state.passAreaId ?? state.areaId);
  const signature = signatureMaterialForArea(state.passAreaId ?? state.areaId);
  const methodLabel = state.passMethod === 'deep' ? 'Deep Delve' : 'Surface Sweep';
  const degraded = state.passMethod === 'deep' && (preview?.gearFactor ?? 1) < 0.8;

  return (
    <div data-testid="extract-rundown" className={zoneCls}>
      <div className="flex min-h-[44px] items-center gap-2 px-2 py-2">
        {signature ? (
          <PixelMaterial id={signature.materialId} size={30} />
        ) : (
          <span className="flex items-center justify-center border border-border bg-bg text-amber" style={{ width: 30, height: 30 }}>
            <PxIcon name="layers" size={19} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-black uppercase text-text-muted">Extraction</span>
            <span className={`text-[11px] font-black uppercase ${state.active ? 'text-green' : 'text-red'}`}>
              {state.active ? 'Working' : 'Paused'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-black text-text-primary">
              {area.name} — {methodLabel}
            </span>
            <span className="whitespace-nowrap text-[15px] font-black leading-tight text-text-primary">
              {formatClock(state.passMs - state.accruedMs)}
              <span className="ml-1 text-[11px] font-black uppercase text-text-muted">next pass</span>
            </span>
          </div>
        </div>
      </div>
      <div className="flex border-t border-border/60">
        <FactCell
          label="Gear factor"
          value={`×${(preview?.gearFactor ?? 0).toFixed(2)}`}
          valueCls={degraded ? 'text-red' : 'text-text-primary'}
        />
        <FactCell label="Per pass" value={`~${preview?.drawsPerPass ?? 0} draws`} />
        <FactCell label="Mastery" value={`Lv. ${state.mastery.level}`} />
      </div>
      {degraded && (
        <div className="border-t border-border/60 px-2 py-1.5 text-[11px] font-black uppercase leading-snug text-amber">
          Deep Delve paying as Surface — factor below ×0.80
        </div>
      )}
      <VitalsLine model={vitals} />
      {/* The zone carries the action on this surface (the
          chamber zone's BANK precedent): Extraction is a view
          over another occupation's screen, so its first screen
          is the zone's — a sticky bar inside the panel cannot
          reach it (the panel head starts below the fold). The
          button resumes the SAVED delve as-is; changing method
          or site stays with the panel's own start button beside
          the method doors. Affordance study — no action wired. */}
      <div className="border-t border-border/60 px-2 py-2">
        <button
          type="button"
          className="bl-primary min-h-[48px] w-full px-4 text-[11px] font-black uppercase tracking-wider"
        >
          Resume — Pass {(state.finalizedPasses ?? 0) + (state.pendingPasses ?? 0) + 1} · {formatClock(state.passMs - state.accruedMs)} left
        </button>
      </div>
    </div>
  );
};
