/**
 * AreaPicker — THE area picker (Phase 1 consolidation).
 *
 * One shared area list for every entry point: the Dashboard's area
 * sheet and the Fight tab's area sheet both render AreaPickerList;
 * they differ only in callbacks (Dashboard selects; the Fight tab
 * selects and can start roaming the tapped area). CurrentAreaChip is
 * the persistent "you are here" chip for the main play surfaces —
 * tapping it opens whichever sheet the host screen wires up.
 *
 * Canonical vocabulary: these are "Areas" everywhere (never zones,
 * turfs, or routes).
 */
import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { ChevronDown } from 'lucide-react';
import { useIdleStore } from '@/store/slices/idleSlice';
import {
  ROAMING_AREAS,
  getRoamingArea,
  type RoamingAreaDef,
} from '@/constants/roamingAreas';
import { getAreaVisual } from '@/constants/areaVisuals';
import { hotAreaIdForDate } from '@/content/hotArea';
import {
  assessAreaDanger,
  currentHunterDangerStats,
  type AreaDangerAssessment,
} from '@/lib/combat/areaDanger';

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

/** Damage figures read as whole numbers once they're worth counting. */
function fmtDamage(n: number): string {
  return n >= 10 ? String(Math.round(n)) : n.toFixed(1);
}

/** A duel duration in ticks (3s each), spelled out in both units. */
function fmtTicks(t: number): string {
  if (!Number.isFinite(t)) return 'never';
  return `${t} ticks (~${t * 3}s)`;
}

/**
 * The danger warning (owner ruling 2026-11-02 — warning, never a
 * wall). Intel only: the duel numbers from areaDanger, no win-chance,
 * no readiness score. "Roam anyway" ALWAYS proceeds.
 */
const DangerWarning: React.FC<{
  area: RoamingAreaDef;
  assessment: AreaDangerAssessment;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ area, assessment, onConfirm, onCancel }) => {
  const { tier, baseline, threat, extremeKillTime } = assessment;
  const lethal = tier === 'lethal';
  return (
    <div
      className={`relative mt-3 border-2 p-2.5 ${lethal ? 'border-red bg-red/10' : 'border-amber bg-amber/10'}`}
      data-testid={`area-danger-warning-${area.id}`}
      role="alertdialog"
      aria-label={`Danger warning for ${area.name}`}
    >
      <div className={`text-xs font-black uppercase tracking-wide ${lethal ? 'text-red' : 'text-amber'}`}>
        {lethal ? 'You will die here — fast' : extremeKillTime && !threat ? 'Slow hunting' : 'Dangerous for your build'}
      </div>
      <p className="mt-1 text-[11px] leading-snug text-text-primary">
        {lethal && (
          <>
            A {baseline.monsterName} hits you for ~{fmtDamage(baseline.monsterDamagePerTick)} a tick.
            Your pool (HP + shield) is {Math.round(baseline.hunterPool)} — about {fmtTicks(baseline.ticksToDie)}.
            {Number.isFinite(baseline.ticksToKill)
              ? <> Dropping one takes you ~{fmtTicks(baseline.ticksToKill)}.</>
              : <> Your damage can't drop one at all.</>}{' '}
            You die before your first kill,
            and roaming pays nothing while you're dead here — a kill is what re-arms your earnings.
          </>
        )}
        {!lethal && threat && (
          <>
            You can handle the {baseline.monsterName} here, but the {threat.monsterName} ({threat.kind})
            out-duels you: ~{fmtDamage(threat.monsterDamagePerTick)} a tick against your{' '}
            {Math.round(threat.hunterPool)} pool (~{fmtTicks(threat.ticksToDie)}), while one kill
            takes you ~{fmtTicks(threat.ticksToKill)}.
          </>
        )}
        {!lethal && !threat && extremeKillTime && (
          <>
            You'll survive the {baseline.monsterName}, but each kill takes you ~
            {baseline.ticksToKill} ticks (~{baseline.ticksToKill * 3}s) — progress crawls here.
          </>
        )}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="bl-primary px-3 py-1.5 text-[11px] font-black"
          data-testid={`area-danger-confirm-${area.id}`}
        >
          Roam anyway
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="bl-secondary px-3 py-1.5 text-[11px] font-black text-text-secondary"
        >
          Never mind
        </button>
      </div>
    </div>
  );
};

const AreaCard: React.FC<{
  area: RoamingAreaDef;
  selected: boolean;
  hot?: boolean;
  assessment: AreaDangerAssessment | null;
  pendingAction: 'select' | 'start' | null;
  onTapMain: () => void;
  onTapStart?: () => void;
  onConfirmDanger: () => void;
  onCancelDanger: () => void;
}> = ({ area, selected, hot = false, assessment, pendingAction, onTapMain, onTapStart, onConfirmDanger, onCancelDanger }) => {
  const bestRarity = Object.entries(area.dropPoolRarityWeights).sort(([, a], [, b]) => b - a)[0];
  const dangerClass = area.dangerRating === 'Low' ? 'text-green' : area.dangerRating === 'Medium' ? 'text-amber' : 'text-red';
  const tier = assessment?.tier ?? 'none';
  return (
    <div className={`relative overflow-hidden border-2 p-3 ${selected ? 'border-amber bg-amber/10' : 'border-border bg-bg/70'}`} style={panelClip}>
      <div className="absolute right-0 top-0 h-full w-1/3 bg-[linear-gradient(135deg,rgba(245,181,68,0.12),transparent)]" />
      <div className="relative flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onTapMain}
          className="min-w-0 flex-1 text-left"
          aria-label={selected && onTapStart ? `Start roam in ${area.name}` : `Select ${area.name}`}
        >
          <div className="text-sm font-black text-text-primary">
            {area.name}
            {hot && (
              <span className="ml-2 bg-[#E2483D] px-1.5 py-0.5 align-middle text-[9px] font-black uppercase tracking-wide text-white" data-testid="hot-area-badge">
                Hot today · +materials
              </span>
            )}
            {tier === 'lethal' && (
              <span className="ml-2 bg-red px-1.5 py-0.5 align-middle text-[9px] font-black uppercase tracking-wide text-white" data-testid={`area-danger-tag-${area.id}`}>
                Deadly for you
              </span>
            )}
            {tier === 'caution' && (
              <span className="ml-2 bg-amber px-1.5 py-0.5 align-middle text-[9px] font-black uppercase tracking-wide text-black" data-testid={`area-danger-tag-${area.id}`}>
                Risky for you
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-text-muted">{area.manufacturerInfluence} · <span className={dangerClass}>{area.dangerRating}</span></div>
          <div className="mt-2 text-[10px] leading-snug text-text-secondary">{area.gameplayIdentity}</div>
        </button>
        {onTapStart && (
          <button type="button" onClick={onTapStart} className="bl-secondary shrink-0 px-2 py-1 text-[9px] font-black text-amber">
            Start Roam
          </button>
        )}
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-1.5 text-[9px]">
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rates</span><div className="font-black text-text-primary">{area.idleCreditsPerMinute}cr/min</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Loot</span><div className="truncate font-black text-amber">{area.lootBias[0]}</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rarity</span><div className="font-black text-text-primary">{bestRarity?.[0]}</div></div>
      </div>
      <div className="relative mt-2 text-[9px] text-text-muted">{area.selectionHint}</div>
      {pendingAction && assessment && tier !== 'none' && (
        <DangerWarning area={area} assessment={assessment} onConfirm={onConfirmDanger} onCancel={onCancelDanger} />
      )}
    </div>
  );
};

export const AreaPickerList: React.FC<{
  onSelect: (area: RoamingAreaDef) => void;
  /** When provided, cards also offer Start Roam (start roaming this area). */
  onStart?: (area: RoamingAreaDef) => void;
}> = ({ onSelect, onStart }) => {
  const selectedAreaId = useIdleStore((s) => s.selectedRoamingAreaId);
  // Date-seeded hot area (§3.5) — computed at render from the UTC day,
  // the same seed the Chef claims with. Never a cron, never stored.
  const hotAreaId = hotAreaIdForDate(new Date());
  const hotArea = ROAMING_AREAS.find((a) => a.id === hotAreaId);

  // Danger intel for THIS hunter's build, assessed once per mount
  // (the sheet opens fresh each time). No area is locked — the
  // assessment only decides whether switching earns a warning first.
  const assessments = useMemo(() => {
    const stats = currentHunterDangerStats();
    const map = new Map<string, AreaDangerAssessment | null>();
    for (const area of ROAMING_AREAS) map.set(area.id, assessAreaDanger(area, stats));
    return map;
  }, []);
  const [pending, setPending] = useState<{ areaId: string; action: 'select' | 'start' } | null>(null);

  const execute = (area: RoamingAreaDef, action: 'select' | 'start') => {
    setPending(null);
    if (action === 'start' && onStart) onStart(area);
    else onSelect(area);
  };
  // Entry/switch only: the area you're already set to roam never
  // warns — you're there. Any other caution/lethal area warns once,
  // and "Roam anyway" always proceeds.
  const guard = (area: RoamingAreaDef, action: 'select' | 'start') => {
    const tier = assessments.get(area.id)?.tier ?? 'none';
    if (area.id !== selectedAreaId && tier !== 'none') {
      setPending({ areaId: area.id, action });
      return;
    }
    execute(area, action);
  };

  return (
    <>
      {hotArea && (
        <div className="mb-2 border-2 border-[#E2483D] bg-[#E2483D]/10 p-2 text-[11px] font-bold text-text-primary" data-testid="hot-area-banner">
          <span className="inline-flex text-[#E2483D]"><PxIcon name="flame" size={13} /></span> Hot area today: <span className="text-[#E2483D]">{hotArea.name}</span> — bonus materials and
          yield, higher danger. Rotates daily.
        </div>
      )}
      {ROAMING_AREAS.map((area) => {
        const selected = area.id === selectedAreaId;
        const pendingAction = pending && pending.areaId === area.id ? pending.action : null;
        return (
          <AreaCard
            key={area.id}
            area={area}
            selected={selected}
            hot={area.id === hotAreaId}
            assessment={assessments.get(area.id) ?? null}
            pendingAction={pendingAction}
            onTapMain={() => guard(area, selected && onStart ? 'start' : 'select')}
            onTapStart={onStart ? () => guard(area, 'start') : undefined}
            onConfirmDanger={() => pending && execute(area, pending.action)}
            onCancelDanger={() => setPending(null)}
          />
        );
      })}
    </>
  );
};

/**
 * Persistent current-area chip for the main play surfaces (Dashboard,
 * Fight). Shows the area the hunter is set to roam; tapping opens the
 * host screen's area picker.
 */
export const CurrentAreaChip: React.FC<{
  onClick: () => void;
  className?: string;
}> = ({ onClick, className = '' }) => {
  const selectedAreaId = useIdleStore((s) => s.selectedRoamingAreaId);
  const area = getRoamingArea(selectedAreaId);
  const visual = getAreaVisual(area.id);

  return (
    <button
      type="button"
      data-testid="current-area-chip"
      onClick={onClick}
      className={`flex items-center gap-2 border-2 border-border bg-surface/95 px-2.5 py-1.5 text-left transition-colors hover:border-amber/50 ${className}`}
      style={signClip}
      aria-label={`Current area: ${area.name}. Tap to change area.`}
    >
      <span className="shrink-0 font-black" style={{ color: visual.color, fontSize: '13px' }}>{visual.sigil}</span>
      <span className="min-w-0">
        <span className="block text-[7px] font-black uppercase tracking-[0.18em] text-text-muted">Area</span>
        <span className="block truncate text-[11px] font-black leading-tight text-text-primary">{area.name}</span>
      </span>
      <ChevronDown size={12} className="shrink-0 text-text-muted" />
    </button>
  );
};
