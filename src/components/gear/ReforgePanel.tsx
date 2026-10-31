import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Check, Hammer, X } from 'lucide-react';
import { RARITIES } from '@/constants/rarities';
import { reforgeCostFor } from '@/content/reforge';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { serverItemRowToDisplayGear, type ServerItemRow } from '@/lib/api/serverItemAdapter';
import { isReforgeableAffix } from '@/lib/gear/affixPools';
import { usePlayerStore } from '@/store';
import type { Affix, GearItem } from '@/types/items';

/**
 * Reforge (0027) — the affix rows of the gear inspect sheet, with the
 * reroll action. Lives inside the ONE gear home (GearInspectSheet,
 * Inventory context only): each rolled affix row carries its Reforge
 * action with the full cost up front; the confirm states the cost
 * and that the swap is permanent; the reveal is a bench moment — the
 * old affix struck out on the bench, the new one landing with the
 * item's rarity read — deliberately NOT the loot-moment ladder
 * (loot stays loot). The server is the authority: the client prices
 * from the shared formula for display, and the op result (profile
 * snapshot + item row) syncs through the verified-op path.
 */

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };
const slashClip = { clipPath: 'polygon(9px 0,100% 0,calc(100% - 9px) 100%,0 100%)' };

export function ReforgePanel({ item, equipped, onReforged }: {
  item: GearItem;
  equipped: boolean;
  onReforged: (item: GearItem) => void;
}) {
  const scrap = usePlayerStore((s) => s.scrap);
  const cores = usePlayerStore((s) => s.legendaryCores);
  const [selected, setSelected] = useState<Affix | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{ oldAffix: Affix; newAffix: Affix } | null>(null);

  const cost = useMemo(() => reforgeCostFor({ rarity: item.rarity, level: item.level ?? 1 }), [item.rarity, item.level]);
  const color = RARITIES[item.rarity]?.color ?? '#F5B544';
  const blocked = equipped
    ? 'Equipped gear cannot be reforged — unequip it first.'
    : item.isLocked
      ? 'Locked gear cannot be reforged — unlock it first.'
      : null;
  const canAfford = scrap >= cost.scrap && cores >= cost.cores;
  const poolAffixes = item.affixes.filter(isReforgeableAffix);
  const moduleCount = item.affixes.length - poolAffixes.length;

  const confirm = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await verifiedOps.reforgeItem(item.id, selected.id);
      const row = result.item as ServerItemRow | undefined;
      const display = row ? serverItemRowToDisplayGear(row) : null;
      if (display) onReforged(display);
      setReveal({
        oldAffix: result.old_affix as Affix,
        newAffix: result.new_affix as Affix,
      });
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reforge failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3 shadow-[5px_5px_0_rgba(0,0,0,0.42)]" style={panelClip}>
      <div className="pointer-events-none absolute -right-8 top-2 h-5 w-28 rotate-12 bg-amber/10" />
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber">
        <Hammer size={14} />Affixes ({item.affixes.length}) · Reforge
      </div>

      <div className="space-y-1.5">
        {item.affixes.map((affix) => {
          const reforgeable = isReforgeableAffix(affix);
          const isSelected = selected?.id === affix.id;
          return (
            <div
              key={affix.id}
              className={`flex items-center justify-between gap-2 border p-2 text-xs font-bold ${isSelected ? 'border-amber bg-amber/20 text-amber' : 'border-amber/35 bg-amber/10 text-amber'}`}
              style={slashClip}
            >
              <span>{affix.displayText}</span>
              {reforgeable ? (
                <button
                  type="button"
                  disabled={!!blocked || busy}
                  onClick={() => { setSelected(isSelected ? null : affix); setError(null); setReveal(null); }}
                  className="shrink-0 border border-amber/60 bg-bg/80 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber disabled:opacity-40"
                >
                  Reforge · {cost.scrap.toLocaleString()} scrap{cost.cores > 0 ? ` · ${cost.cores} cores` : ''}
                </button>
              ) : (
                <span className="shrink-0 text-[9px] font-black uppercase tracking-wide text-text-muted">Module</span>
              )}
            </div>
          );
        })}
      </div>

      {moduleCount > 0 && (
        <div className="mt-2 text-[10px] text-text-muted">
          Activity modules are procedural and can&apos;t be reforged — only rolled affixes can.
        </div>
      )}
      {blocked && (
        <div className="mt-2 flex items-center gap-2 border border-border bg-bg/70 p-2 text-[10px] font-bold text-text-secondary" style={slashClip}>
          <AlertTriangle size={12} />{blocked}
        </div>
      )}

      <AnimatePresence>
        {selected && !blocked && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="mt-3 border-2 border-amber/70 bg-bg/85 p-3"
            style={panelClip}
          >
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber">On the bench</div>
            <div className="mt-1 text-xs text-text-secondary">
              Replace <span className="font-black text-amber">{selected.displayText}</span> with a fresh roll from this item&apos;s affix pool.
              The swap is <span className="font-black text-text-primary">permanent</span> — the old affix is gone for good.
              Rarity, level, roll quality{('legendaryEffectId' in item && item.legendaryEffectId) ? ', and the legendary effect' : ''} never change.
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs font-black">
              <span className={scrap >= cost.scrap ? 'text-text-primary' : 'text-red'}>
                {cost.scrap.toLocaleString()} scrap <span className="text-text-muted">({scrap.toLocaleString()} on hand)</span>
              </span>
              {cost.cores > 0 && (
                <span className={cores >= cost.cores ? 'text-text-primary' : 'text-red'}>
                  {cost.cores} legendary cores <span className="text-text-muted">({cores} on hand)</span>
                </span>
              )}
            </div>
            {error && <div className="mt-2 text-[11px] font-bold text-red">{error}</div>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!canAfford || busy}
                onClick={() => void confirm()}
                className="flex items-center justify-center gap-1 border border-amber bg-amber/20 py-2 text-[10px] font-black uppercase tracking-wide text-amber disabled:opacity-40"
              >
                <Check size={13} />{busy ? 'Reforging…' : canAfford ? 'Reforge it' : 'Can\'t afford'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setSelected(null)}
                className="flex items-center justify-center gap-1 border border-border bg-surface py-2 text-[10px] font-black uppercase tracking-wide text-text-secondary disabled:opacity-40"
              >
                <X size={13} />Keep it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {reveal && (
          <motion.div
            key="reveal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-3 border-2 bg-bg/85 p-3"
            style={{ ...panelClip, borderColor: color }}
          >
            <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color }}>Reforged on the bench</div>
            <div className="mt-2 space-y-1.5">
              <div className="border border-red/40 bg-red/10 p-2 text-xs font-bold text-red line-through" style={slashClip}>
                {reveal.oldAffix.displayText}
              </div>
              <motion.div
                initial={{ scale: 0.92, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ type: 'spring', damping: 16, stiffness: 260 }}
                className="border-2 p-2 text-sm font-black"
                style={{ ...slashClip, borderColor: color, color, boxShadow: `0 0 18px ${color}55`, background: `${color}14` }}
              >
                {reveal.newAffix.displayText}
              </motion.div>
            </div>
            <div className="mt-2 text-[10px] text-text-muted">
              Paid {cost.scrap.toLocaleString()} scrap{cost.cores > 0 ? ` and ${cost.cores} legendary cores` : ''} — destroyed, not escrowed.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
