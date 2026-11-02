import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  ACTION_SKILL_DEFS,
  NO_KEYSTONE_NOTE,
  type ActionSkillStateView,
} from '@/content/actionSkills';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';

/**
 * ActionSkillCard — the player's OWN signature state on a prep
 * surface (boss prep, endless prep). Intel law: this is the player's
 * data only — charge, effect text, and the arm toggle. It never
 * mentions the boss, odds, or readiness.
 *
 * The charge track reuses the Workshop's G-3 charge-track grammar:
 * a bordered track whose fill is the tree's color, the sigil riding
 * the leading edge. The client renders server payloads only —
 * `state` always comes from a Chef response.
 */
export const ActionSkillCard: React.FC<{
  state: ActionSkillStateView | null;
  armed: boolean;
  onToggleArmed: (next: boolean) => void;
  /** Where the charge comes from, in this surface's words. */
  chargeSourceNote: string;
}> = ({ state, armed, onToggleArmed, chargeSourceNote }) => {
  if (!state) {
    return (
      <div className="space-y-2 border-2 border-border bg-bg/70 p-3" data-testid="action-skill-card">
        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Action Skill</div>
        <div className="text-[10px] text-text-muted">Reading your signature from the Chef…</div>
      </div>
    );
  }

  const def = state.selected ? ACTION_SKILL_DEFS[state.selected] : null;
  if (!def) {
    return (
      <div className="space-y-2 border-2 border-border bg-bg/70 p-3" data-testid="action-skill-card">
        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Action Skill</div>
        {state.qualified.length > 0 ? (
          <div className="text-[10px] leading-snug text-text-secondary">
            You own {state.qualified.length === 1 ? 'a keystone' : 'keystones'} in{' '}
            {state.qualified.join(', ')} — pick your one active
            signature in the Skill Trees screen, where respecs happen.
          </div>
        ) : (
          <div className="text-[10px] leading-snug text-text-secondary" data-testid="action-skill-none">
            {state.noKeystoneNote ?? NO_KEYSTONE_NOTE}
          </div>
        )}
      </div>
    );
  }

  const visual = getSkillTreeVisual(def.tree);
  const pct = Math.max(0, Math.min(100, (state.charge / state.chargeMax) * 100));
  return (
    <div
      className="space-y-2 border-2 bg-bg/70 p-3"
      style={{ borderColor: `${visual.color}66` }}
      data-testid="action-skill-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PxIcon name={visual.sigil} size={17} style={{ color: visual.color }} />
          <div>
            <div className="text-xs font-black text-text-primary">{def.name}</div>
            <div className="text-[9px] font-black uppercase tracking-wider" style={{ color: visual.color }}>
              {def.tree} signature
            </div>
          </div>
        </div>
        <div className="font-mono text-[11px] font-black text-text-primary" data-testid="action-skill-charge-label">
          {Math.floor(state.charge)}/{state.chargeMax}
        </div>
      </div>
      <div className="text-[10px] leading-snug text-text-secondary">{def.summary}</div>
      {/* G-3 charge track */}
      <div
        className="relative h-3 overflow-hidden border-2 border-border bg-bg"
        data-testid="action-skill-charge-track"
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, backgroundColor: visual.color }}
          data-testid="action-skill-charge-fill"
        />
        <span
          className="absolute inset-y-0 flex items-center"
          style={{ left: `calc(${pct}% - 8px)`, color: visual.color }}
        >
          <PxIcon name={visual.sigil} size={13} />
        </span>
      </div>
      {state.charged ? (
        <button
          type="button"
          data-testid="action-skill-arm"
          onClick={() => onToggleArmed(!armed)}
          className={`w-full py-2 text-[11px] font-black uppercase tracking-wider ${armed ? 'bl-primary' : 'bl-secondary'}`}
          style={armed ? { backgroundColor: visual.color, color: '#050608' } : undefined}
        >
          {armed ? <span className="inline-flex items-center gap-1"><PxIcon name={visual.sigil} size={13} /> {def.name} will fire</span> : `Arm ${def.name} for this fight`}
        </button>
      ) : (
        <div className="text-[10px] text-text-muted">{chargeSourceNote}</div>
      )}
    </div>
  );
};
