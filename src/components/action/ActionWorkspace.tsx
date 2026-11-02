import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { SheetPortal } from '@/components/common/SheetPortal';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { salvageScrap } from '@/lib/skills/salvageBonuses';
import type { GearItem, Weapon } from '@/types/items';

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
  if (tone === 'kill') return 'bg-red';
  if (tone === 'death') return 'bg-red';
  if (tone === 'damage') return 'bg-red';
  if (tone === 'heal') return 'bg-green';
  return 'bg-text-muted';
};

export const ActionStatChip: React.FC<ActionStat> = ({ label, value, tone = 'amber' }) => (
  <div className="border-2 border-border bg-bg/70 px-2 py-1.5" style={chipClip}>
    <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{label}</div>
    <div className={`truncate text-xs font-black ${toneText[tone]}`}>{value}</div>
  </div>
);

export const RewardIntelPanel: React.FC<{
  title?: string;
  eyebrow?: string;
  stats: ActionStat[];
  children?: React.ReactNode;
}> = ({ title = 'Reward Intel', eyebrow = 'drop logic', stats, children }) => (
  <section className="relative overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
    <div className="mb-3 flex items-center gap-2">
      <span className="inline-flex text-amber"><PxIcon name="star" size={17} /></span>
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
  /**
   * Feed inspect actions (flow-fix F11): when provided, a dropped
   * item's inspect sheet carries Equip / Salvage actions so the item
   * is actionable from where it dropped instead of dead-ending at
   * Close. Handlers resolve true when the sheet should close (the op
   * settled); failures keep the sheet open and surface gearActionError.
   */
  onGearEquip?: (item: GearItem) => Promise<boolean>;
  onGearSalvage?: (item: GearItem) => Promise<boolean>;
  gearActionBusy?: boolean;
  gearActionError?: string | null;
}> = ({ title = 'Live Loot Log', entries, empty = 'No action events yet.', onGearEquip, onGearSalvage, gearActionBusy = false, gearActionError = null }) => {
  const [selectedGear, setSelectedGear] = useState<GearItem | null>(null);

  const rarityBorder = (item?: GearItem): string => {
    if (!item || !('rarity' in item)) return 'border-border';
    const colors: Record<string, string> = {
      Common: 'border-[#A5A7B5]/40',
      Uncommon: 'border-[#7CFC00]/40',
      Rare: 'border-[#5AA7FF]/40',
      Epic: 'border-[#FF9DF5]/40',
      Legendary: 'border-[#FFEA3A]/50',
    };
    return colors[(item as { rarity: string }).rarity] ?? 'border-border';
  };

  const rarityGlow = (item?: GearItem): string => {
    if (!item || !('rarity' in item)) return '';
    const colors: Record<string, string> = {
      Common: 'shadow-[0_0_6px_rgba(165,167,181,0.15)]',
      Uncommon: 'shadow-[0_0_8px_rgba(124,252,0,0.15)]',
      Rare: 'shadow-[0_0_8px_rgba(90,167,255,0.15)]',
      Epic: 'shadow-[0_0_10px_rgba(255,157,245,0.15)]',
      Legendary: 'shadow-[0_0_12px_rgba(255,234,58,0.2)]',
    };
    return colors[(item as { rarity: string }).rarity] ?? '';
  };

  return (
    <section className="relative overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
      <div className="mb-3 flex items-center gap-2">
        <PxIcon name="diamondIn" size={17} className="text-amber" />
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">reward stream</div>
          <div className="text-sm font-black text-text-primary">{title}</div>
        </div>
      </div>
      <div className="space-y-2" style={{ minHeight: '3.25rem' }} data-testid="action-feed-list">
        {entries.length === 0 && <div className="border border-border bg-bg/70 p-2 text-xs text-text-muted">{empty}</div>}
        {entries.map((entry) => {
          const clickable = !!entry.onInspect || !!entry.gear;
          const borderClass = entry.gear ? rarityBorder(entry.gear) : 'border-border';
          const glowClass = entry.gear ? rarityGlow(entry.gear) : '';
          const isWeapon = (g: GearItem): g is Weapon => 'weaponType' in g;
          const Inner = (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className={`flex items-start gap-2 border p-2 text-left bg-bg/75 ${borderClass} ${glowClass}`}
              style={chipClip}
            >
              {/* When gear is present, show weapon thumbnail instead of dot */}
              {entry.gear && isWeapon(entry.gear) ? (
                <div className="shrink-0 mt-0.5">
                  {/* Pixel path (P5): same render as inventory/market for this
                      weapon. ('thumb' in the shared size table is 46px wide.) */}
                  <PixelWeapon weapon={entry.gear} size={46} />
                </div>
              ) : (
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${feedDot(entry.tone)}`} />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-black uppercase tracking-wide text-text-primary">{entry.label}</div>
                <div className="text-[10px] leading-snug text-text-muted">{entry.detail}</div>
                {entry.gear && (
                  <div className="mt-1 text-[9px] font-black uppercase tracking-wide text-amber">
                    Tap to inspect →
                  </div>
                )}
              </div>
            </motion.div>
          );
          if (!clickable) return <div key={entry.id}>{Inner}</div>;
          return <button key={entry.id} type="button" onClick={() => entry.gear ? setSelectedGear(entry.gear) : entry.onInspect?.()} className="block w-full active:scale-[0.99]">{Inner}</button>;
        })}
      </div>
      <GearInspectSheet
        item={selectedGear}
        open={!!selectedGear}
        onClose={() => setSelectedGear(null)}
        contextLabel="Loot Log Inspect"
        actions={selectedGear && (onGearEquip || onGearSalvage) ? (
          <div>
            {gearActionError && <div className="mb-2 border border-red/50 bg-red/10 p-2 text-[10px] font-bold text-red">{gearActionError}</div>}
            <div className="grid grid-cols-2 gap-2">
              {onGearEquip && (
                <button
                  type="button"
                  disabled={gearActionBusy}
                  className="bl-primary py-2 text-xs font-black disabled:opacity-50"
                  onClick={async () => { if (await onGearEquip(selectedGear)) setSelectedGear(null); }}
                >
                  Equip
                </button>
              )}
              {onGearSalvage && (
                <button
                  type="button"
                  disabled={gearActionBusy || selectedGear.isLocked}
                  className="bl-secondary py-2 text-xs font-black text-amber disabled:opacity-50"
                  onClick={async () => { if (await onGearSalvage(selectedGear)) setSelectedGear(null); }}
                >
                  Salvage ≈{salvageScrap(selectedGear.rarity, selectedGear.level)}
                </button>
              )}
            </div>
          </div>
        ) : undefined}
      />
    </section>
  );
};

export const ContextualPickerSheet: React.FC<{
  open: boolean;
  title: string;
  detail?: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, title, detail, onClose, children }) => {
  if (!open) return null;
  return (
    <SheetPortal>
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
    </SheetPortal>
  );
};
