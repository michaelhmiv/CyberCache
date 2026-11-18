import React, { useMemo } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { statToneRailClass, statToneTextClass } from '@/components/stats/statToneStyles';
import { useActivityStore, useEndlessRunStore, useLoadoutStore, usePlayerStore, useSurvivalStore } from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { buildHeroRundown, type HeroRundownModel } from '@/lib/stats/heroRundown';
import { endlessEncounterForDepth, ENDLESS_MILESTONE_EVERY } from '@/content/endless';
import { HeroBuffLine } from './HeroRundown';

/**
 * The chamber rundown (first-screen fix R2, owner-approved layout
 * 2026-11-17) — the black zone under the stage, answered for the
 * Chaos Chamber while an endless run holds the Home slot.
 *
 * Grammar: the bench rundown's (PR #610) — the shipped zone's
 * bordered well, 11px labels, 15px heroes, fact cells with
 * hairline dividers, one slim vitals line, the buff line at the
 * foot. The run's money decision rides the zone:
 *
 *   header — depth cleared, the escrow AT RISK as the hero;
 *   fact cells — NEXT depth, DEATH PAYS (the death rule's percent
 *     of the escrow, floored — the same figure the panel's escrow
 *     card states in prose), MILESTONE depth;
 *   next line — the encounter waiting at the next depth, named,
 *     with the player's best depth;
 *   BANK & LEAVE as the zone's foot, carrying the full payout.
 *
 * Data: the run view EndlessPanel publishes to the endless-run
 * slice (the panel stays the flow's sole owner; banking travels
 * back as a request the panel executes through its own handler).
 * Display only here — nothing in this component mutates anything.
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

export const ChamberRundown: React.FC = () => {
  const kind = useActivityStore((s) => s.current.kind);
  const run = useEndlessRunStore((s) => s.view);
  const requestBank = useEndlessRunStore((s) => s.requestBank);
  const vitals = useVitalsModel();

  if (!run) return null;

  const nextDepth = run.depthReached + 1;
  const next = endlessEncounterForDepth(nextDepth, run.startLevel);
  const nextMilestone = Math.ceil(nextDepth / ENDLESS_MILESTONE_EVERY) * ENDLESS_MILESTONE_EVERY;
  const deathPays = Math.floor((run.escrowCredits * run.deathPayoutPercent) / 100);

  return (
    <div
      data-testid="chamber-rundown"
      className="relative border-2 border-t-0 border-border bg-surface/95 shadow-[0_10px_22px_rgba(0,0,0,0.45)]"
    >
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
          data-testid="chamber-bank"
          onClick={requestBank}
          disabled={run.busy}
          className="bl-primary min-h-[48px] w-full px-4 text-[11px] font-black uppercase tracking-wider disabled:opacity-50"
        >
          Bank &amp; Leave — {run.escrowCredits.toLocaleString()} cr · {run.escrowXp.toLocaleString()} XP · {run.escrowScrap.toLocaleString()} scrap
        </button>
      </div>
      <HeroBuffLine activityKind={kind} />
    </div>
  );
};
