import React, { useMemo } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { statToneRailClass, statToneTextClass } from '@/components/stats/statToneStyles';
import { useActivityStore, useExtractionRunStore, useLoadoutStore, usePlayerStore, useSurvivalStore } from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { useNow } from '@/hooks/useNow';
import { buildHeroRundown, type HeroRundownModel } from '@/lib/stats/heroRundown';
import { getRoamingArea } from '@/constants/roamingAreas';
import { signatureMaterialForArea } from '@/content/roamingEvents';
import { HeroBuffLine } from './HeroRundown';

/**
 * The extract rundown (first-screen fix R2, owner-approved layout
 * 2026-11-17) — the black zone under the stage, answered for the
 * extraction delve whenever the extraction view is open.
 *
 * Extraction is a VIEW over another occupation's screen: its
 * first screen is this zone, and a sticky bar inside the panel
 * below could never reach it (the panel head starts below the
 * fold there). Grammar: the bench rundown's (PR #610) — the
 * shipped zone's bordered well, 11px labels, 15px heroes, fact
 * cells with hairline dividers, one slim vitals line, the buff
 * line at the foot.
 *
 *   header — the site's signature material, site + method, the
 *     WORKING / PAUSED state word, the next-pass countdown as
 *     the hero;
 *   fact cells — GEAR FACTOR (red while degraded), PER PASS
 *     draws, MASTERY level;
 *   the Deep Delve warning as its own line whenever a deep
 *     delve's factor is below ×0.80 — INCLUDING PAUSED, which is
 *     exactly when the panel below never prints it (its own
 *     degraded line requires the delve to be active) and exactly
 *     when the player weighs resuming;
 *   RESUME as the zone's foot while paused, carrying the pass
 *     number and the time left on it. It resumes the SAVED delve
 *     as-is; changing site or method stays with the panel.
 *
 * Data: the state view ExtractionPanel publishes to the
 * extraction-run slice (the panel stays the flow's sole owner;
 * resume travels back as a request the panel executes through
 * its own start path). The countdown interpolates between the
 * panel's reads exactly the way the panel itself interpolates —
 * from the published read anchor — and decides nothing.
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

const formatClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

export const ExtractRundown: React.FC = () => {
  const kind = useActivityStore((s) => s.current.kind);
  const view = useExtractionRunStore((s) => s.view);
  const requestResume = useExtractionRunStore((s) => s.requestResume);
  const vitals = useVitalsModel();
  const now = useNow();

  if (!view || !view.state.hasState) return null;

  const { state } = view;
  const preview = state.preview;
  const area = getRoamingArea(state.passAreaId ?? state.areaId ?? undefined);
  const signature = signatureMaterialForArea(area.id);
  const methodLabel = state.passMethod === 'deep' ? 'Deep Delve' : 'Surface Sweep';
  const degraded = state.passMethod === 'deep' && (preview?.gearFactor ?? 1) < 0.8;
  // The panel's own interpolation: accrued time advances between
  // reads only while the delve is active; paused, it is frozen.
  const accruedDisplay = state.active
    ? Math.min(state.passMs, state.accruedMs + Math.max(0, now - view.readAt))
    : state.accruedMs;
  const remainingMs = Math.max(0, state.passMs - accruedDisplay);
  const passNumber = (state.finalizedPasses ?? 0) + (state.pendingPasses ?? 0) + 1;

  return (
    <div
      data-testid="extract-rundown"
      className="relative border-2 border-t-0 border-border bg-surface/95 shadow-[0_10px_22px_rgba(0,0,0,0.45)]"
    >
      <div className="flex min-h-[44px] items-center gap-2 px-2 py-2">
        {signature ? (
          <PixelMaterial id={signature.materialId} size={30} />
        ) : (
          <span className="flex items-center justify-center border border-border bg-bg text-amber" style={{ width: 30, height: 30 }}>
            <PxIcon name="pick" size={19} />
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
              {formatClock(remainingMs)}
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
        <div
          data-testid="extract-rundown-warning"
          className="border-t border-border/60 px-2 py-1.5 text-[11px] font-black uppercase leading-snug text-amber"
        >
          Deep Delve paying as Surface — factor below ×0.80
        </div>
      )}
      <VitalsLine model={vitals} />
      {/* The zone carries the action on this surface (the chamber
          zone's BANK precedent): while the delve is paused, Resume
          is the zone's foot. While it works, the panel below
          carries the controls — no dead button rides the zone. */}
      {!state.active && (
        <div className="border-t border-border/60 px-2 py-2">
          <button
            type="button"
            data-testid="extract-resume"
            onClick={requestResume}
            disabled={view.starting}
            className="bl-primary min-h-[48px] w-full px-4 text-[11px] font-black uppercase tracking-wider disabled:opacity-50"
          >
            Resume — Pass {passNumber} · {formatClock(remainingMs)} left
          </button>
        </div>
      )}
      <HeroBuffLine activityKind={kind} />
    </div>
  );
};
