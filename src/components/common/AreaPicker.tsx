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
import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useIdleStore } from '@/store/slices/idleSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import {
  ROAMING_AREAS,
  getRoamingArea,
  isRoamingAreaUnlocked,
  type RoamingAreaDef,
} from '@/constants/roamingAreas';
import { getAreaVisual } from '@/constants/areaVisuals';
import { hotAreaIdForDate } from '@/content/hotArea';

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const AreaCard: React.FC<{
  area: RoamingAreaDef;
  selected: boolean;
  unlocked: boolean;
  hot?: boolean;
  onSelect: () => void;
  onStart?: () => void;
}> = ({ area, selected, unlocked, hot = false, onSelect, onStart }) => {
  const bestRarity = Object.entries(area.dropPoolRarityWeights).sort(([, a], [, b]) => b - a)[0];
  const dangerClass = area.dangerRating === 'Low' ? 'text-green' : area.dangerRating === 'Medium' ? 'text-amber' : 'text-red';
  return (
    <div className={`relative overflow-hidden border-2 p-3 ${selected ? 'border-amber bg-amber/10' : 'border-border bg-bg/70'} ${!unlocked ? 'opacity-55' : ''}`} style={panelClip}>
      <div className="absolute right-0 top-0 h-full w-1/3 bg-[linear-gradient(135deg,rgba(245,181,68,0.12),transparent)]" />
      <div className="relative flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={selected && onStart ? onStart : onSelect}
          disabled={!unlocked}
          className="min-w-0 flex-1 text-left"
          aria-label={selected && onStart ? `Run ${area.name}` : `Select ${area.name}`}
        >
          <div className="text-sm font-black text-text-primary">
            {area.name}
            {hot && (
              <span className="ml-2 bg-[#E2483D] px-1.5 py-0.5 align-middle text-[9px] font-black uppercase tracking-wide text-white" data-testid="hot-area-badge">
                Hot today · +materials
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-text-muted">Lv.{area.unlockLevel} · {area.manufacturerInfluence} · <span className={dangerClass}>{area.dangerRating}</span></div>
          <div className="mt-2 text-[10px] leading-snug text-text-secondary">{area.gameplayIdentity}</div>
        </button>
        {onStart && (
          <button type="button" onClick={onStart} disabled={!unlocked} className="bl-secondary shrink-0 px-2 py-1 text-[9px] font-black text-amber disabled:opacity-40">
            {selected ? 'Run' : 'Switch'}
          </button>
        )}
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-1.5 text-[9px]">
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rates</span><div className="font-black text-text-primary">{area.idleCreditsPerMinute}cr/min</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Loot</span><div className="truncate font-black text-amber">{area.lootBias[0]}</div></div>
        <div className="bg-surface/80 p-1.5"><span className="text-text-muted">Rarity</span><div className="font-black text-text-primary">{bestRarity?.[0]}</div></div>
      </div>
      <div className="relative mt-2 text-[9px] text-text-muted">{unlocked ? area.selectionHint : `Locked until level ${area.unlockLevel}.`}</div>
    </div>
  );
};

export const AreaPickerList: React.FC<{
  onSelect: (area: RoamingAreaDef) => void;
  /** When provided, cards also offer Run/Switch (start roaming this area). */
  onStart?: (area: RoamingAreaDef) => void;
}> = ({ onSelect, onStart }) => {
  const playerLevel = usePlayerStore((s) => s.level);
  const selectedAreaId = useIdleStore((s) => s.selectedRoamingAreaId);
  // Date-seeded hot area (§3.5) — computed at render from the UTC day,
  // the same seed the Chef claims with. Never a cron, never stored.
  const hotAreaId = hotAreaIdForDate(new Date());
  const hotArea = ROAMING_AREAS.find((a) => a.id === hotAreaId);

  return (
    <>
      {hotArea && (
        <div className="mb-2 border-2 border-[#E2483D] bg-[#E2483D]/10 p-2 text-[11px] font-bold text-text-primary" data-testid="hot-area-banner">
          🔥 Hot area today: <span className="text-[#E2483D]">{hotArea.name}</span> — bonus materials and
          yield, higher danger. Rotates daily.
        </div>
      )}
      {ROAMING_AREAS.map((area) => {
        const unlocked = isRoamingAreaUnlocked(area, playerLevel);
        const selected = area.id === selectedAreaId;
        return (
          <AreaCard
            key={area.id}
            area={area}
            selected={selected}
            unlocked={unlocked}
            hot={area.id === hotAreaId}
            onSelect={() => onSelect(area)}
            onStart={onStart ? () => onStart(area) : undefined}
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
