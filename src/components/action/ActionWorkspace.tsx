import React from 'react';
import { motion } from 'framer-motion';
import { ChevronDown, Clock, PackageSearch, Sparkles } from 'lucide-react';
import { getActionWorkspaceSpec } from '@/lib/activity/actionWorkspaceSpecs';
import { getAnimationBeatsForEvent } from '@/lib/activity/actionAnimationDirector';
import type { ActivityKind } from '@/types/activity';
import type { GearItem } from '@/types/items';

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const chipClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

export type ActionStat = {
  label: string;
  value: string | number;
  tone?: 'amber' | 'green' | 'red' | 'cyan' | 'muted';
};

export type ActionFeedEntry = {
  id: string;
  label: string;
  detail: string;
  tone?: string;
  eventType?: string;
  gear?: GearItem;
  onInspect?: () => void;
};

const toneText: Record<NonNullable<ActionStat['tone']>, string> = {
  amber: 'text-amber',
  green: 'text-green',
  red: 'text-red',
  cyan: 'text-cyan',
  muted: 'text-text-muted',
};

const feedDot = (tone?: string) => {
  if (tone === 'loot') return 'bg-amber';
  if (tone === 'cache') return 'bg-blue-400';
  if (tone === 'cash') return 'bg-cyan';
  if (tone === 'level') return 'bg-red';
  if (tone === 'xp') return 'bg-green';
  return 'bg-text-muted';
};

export const ActionStatChip: React.FC<ActionStat> = ({ label, value, tone = 'amber' }) => (
  <div className="border-2 border-border bg-bg/70 px-2 py-1.5" style={chipClip}>
    <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{label}</div>
    <div className={`truncate text-xs font-black ${toneText[tone]}`}>{value}</div>
  </div>
);

export const ActiveActionHeader: React.FC<{
  kind: ActivityKind;
  title: string;
  detail: string;
  target: string;
  elapsed?: string;
  status?: string;
  stats: ActionStat[];
  onManage?: () => void;
  manageLabel?: string;
}> = ({ kind, title, detail, target, elapsed, status = 'LIVE', stats, onManage, manageLabel = 'Manage' }) => {
  const spec = getActionWorkspaceSpec(kind);
  const motionBeats = getAnimationBeatsForEvent(kind).join(' ');
  return (
    <section data-motion-beats={motionBeats} className="relative overflow-hidden border-2 border-border bg-surface/95 p-3 shadow-[0_10px_22px_rgba(0,0,0,0.55)]" style={panelClip}>
      <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rotate-12 border-[14px] border-amber/5" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-widest text-amber">Current Action · {spec.liveVerb}</div>
          <div className="truncate text-lg font-black text-text-primary">{title}</div>
          <div className="text-xs leading-relaxed text-text-muted">{detail}</div>
          <div className="mt-1 text-[10px] font-black uppercase tracking-wide text-text-secondary">Target: {target}</div>
        </div>
        <div className="shrink-0 text-right text-[10px] text-text-muted">
          <Clock size={16} className="ml-auto" />
          <div className="font-black text-amber">{status}</div>
          {elapsed && <div>{elapsed}</div>}
        </div>
      </div>
      <div className="relative mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
        {stats.slice(0, 6).map((stat) => <ActionStatChip key={`${stat.label}-${stat.value}`} {...stat} />)}
      </div>
      <div className="relative mt-3 border-2 border-border bg-bg/70 p-2 text-[10px]" style={chipClip}>
        <div className="font-black uppercase tracking-wide text-amber">Next Decision</div>
        <div className="mt-1 leading-snug text-text-muted">{spec.coreDecision}</div>
      </div>
      {onManage && (
        <button type="button" onClick={onManage} className="relative mt-3 flex w-full items-center justify-between border-2 border-border bg-bg/75 px-3 py-2 text-left text-xs font-black text-amber" style={chipClip}>
          <span>{manageLabel}</span>
          <ChevronDown size={14} />
        </button>
      )}
    </section>
  );
};

export const RewardIntelPanel: React.FC<{
  title?: string;
  eyebrow?: string;
  stats: ActionStat[];
  children?: React.ReactNode;
}> = ({ title = 'Reward Intel', eyebrow = 'drop logic', stats, children }) => (
  <section className="relative overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
    <div className="mb-3 flex items-center gap-2">
      <Sparkles size={16} className="text-amber" />
      <div>
        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">{eyebrow}</div>
        <div className="text-sm font-black text-text-primary">{title}</div>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-2">
      {stats.map((stat) => <ActionStatChip key={`${stat.label}-${stat.value}`} {...stat} />)}
    </div>
    {children && <div className="mt-3 text-[10px] leading-snug text-text-muted">{children}</div>}
  </section>
);

export const ActionFeed: React.FC<{
  title?: string;
  entries: ActionFeedEntry[];
  empty?: string;
}> = ({ title = 'Live Loot Log', entries, empty = 'No action events yet.' }) => (
  <section className="relative overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
    <div className="mb-3 flex items-center gap-2">
      <PackageSearch size={16} className="text-amber" />
      <div>
        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">reward stream</div>
        <div className="text-sm font-black text-text-primary">{title}</div>
      </div>
    </div>
    <div className="space-y-2">
      {entries.length === 0 && <div className="border border-border bg-bg/70 p-2 text-xs text-text-muted">{empty}</div>}
      {entries.map((entry) => {
        const clickable = !!entry.onInspect || !!entry.gear;
        const Inner = (
          <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2 border border-border bg-bg/75 p-2 text-left" style={chipClip}>
            <span className={`mt-1 h-2.5 w-2.5 shrink-0 ${feedDot(entry.tone)}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[11px] font-black uppercase tracking-wide text-text-primary">{entry.label}</div>
              <div className="text-[10px] leading-snug text-text-muted">{entry.detail}</div>
              {entry.gear && <div className="mt-1 text-[9px] font-black uppercase tracking-wide text-amber">Tap to inspect gear</div>}
            </div>
          </motion.div>
        );
        if (!clickable) return <div key={entry.id}>{Inner}</div>;
        return <button key={entry.id} type="button" onClick={entry.onInspect} className="block w-full active:scale-[0.99]">{Inner}</button>;
      })}
    </div>
  </section>
);

export const ContextualPickerSheet: React.FC<{
  open: boolean;
  title: string;
  detail?: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, title, detail, onClose, children }) => {
  if (!open) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end bg-black/70" onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="max-h-[82vh] w-full overflow-y-auto rounded-t-2xl border-t-2 border-border bg-bg p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="bl-title text-2xl text-text-primary">{title}</div>
            {detail && <div className="text-[10px] text-text-muted">{detail}</div>}
          </div>
          <button type="button" onClick={onClose} className="bl-secondary p-2 text-text-muted"><ChevronDown size={16} /></button>
        </div>
        <div className="space-y-2">{children}</div>
      </motion.div>
    </motion.div>
  );
};
