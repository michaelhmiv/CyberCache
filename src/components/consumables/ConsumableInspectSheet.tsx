import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, Crosshair, PackagePlus, Radio, Shield, Star, X, Zap,
} from 'lucide-react';
import type { ConsumableDef, ConsumableFamily } from '@/constants/consumables';
import { usePlayerStore } from '@/store';

const FAMILY_ICONS: Record<ConsumableFamily, React.ElementType> = {
  survival: Shield,
  ammo: Crosshair,
  ordnance: PackagePlus,
  tactical: Radio,
  economy: Star,
  corrupted: AlertTriangle,
};

const FAMILY_COLORS: Record<ConsumableFamily, string> = {
  survival: 'text-green',
  ammo: 'text-red',
  ordnance: 'text-orange',
  tactical: 'text-cyan',
  economy: 'text-amber',
  corrupted: 'text-purple',
};

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };
const slashClip = { clipPath: 'polygon(9px 0,100% 0,calc(100% - 9px) 100%,0 100%)' };

function StatRow({ label, value, tone = 'text-text-primary' }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border bg-bg/75 px-2 py-1.5" style={slashClip}>
      <span className="text-[9px] font-black uppercase tracking-wide text-text-muted">{label}</span>
      <span className={`text-xs font-black ${tone}`}>{value}</span>
    </div>
  );
}

interface ConsumableInspectSheetProps {
  consumable: ConsumableDef | null;
  open: boolean;
  onClose: () => void;
  onEquip?: (id: string) => void;
}

export const ConsumableInspectSheet: React.FC<ConsumableInspectSheetProps> = ({
  consumable, open, onClose, onEquip,
}) => {
  const player = usePlayerStore();

  if (!consumable) return null;

  const Icon = FAMILY_ICONS[consumable.family];
  const familyColor = FAMILY_COLORS[consumable.family];
  const owned = player.getConsumableCount(consumable.id);
  const rules = consumable.effectRules;
  const drawbacks = consumable.drawbackRules;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/85"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]"
            style={panelClip}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle */}
            <div className="mb-3 flex justify-center">
              <div className="h-1.5 w-12 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="relative overflow-hidden border-2 border-border bg-surface p-3" style={panelClip}>
              <div className="absolute -right-10 top-3 h-8 w-36 rotate-12 bg-amber/10" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Consumable Inspect</div>
                  <div className="mt-1 flex items-center gap-2">
                    <Icon size={20} className={familyColor} />
                    <div className="truncate text-xl font-black leading-none text-text-primary">{consumable.name}</div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-text-muted">
                    <span className={`font-black uppercase ${familyColor}`}>{consumable.family}</span>
                    <span>·</span>
                    <span>{consumable.category}</span>
                    <span>·</span>
                    <span>x{owned} owned</span>
                  </div>
                </div>
                <button type="button" onClick={onClose} className="bl-secondary shrink-0 p-2 text-text-muted">
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Description */}
            <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
              <div className="text-xs font-bold text-text-primary">{consumable.shortDescription}</div>
              <div className="mt-1 text-[10px] text-text-muted">{consumable.description}</div>
              <div className="mt-1 text-[10px] italic text-amber">{consumable.effect}</div>
            </section>

            {/* Tactical Info */}
            <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber">Tactical Profile</div>
              <div className="space-y-1.5">
                <StatRow label="Tactical Role" value={consumable.tacticalRole} tone="text-amber" />
                <StatRow label="Trigger" value={consumable.trigger} tone="text-cyan" />
                <StatRow label="Consume Policy" value={consumable.consumePolicy} tone="text-text-primary" />
                <StatRow
                  label="Loadout Slots"
                  value={consumable.allowedSlots.join(' · ')}
                  tone="text-green"
                />
                {consumable.counterTags.length > 0 && (
                  <StatRow label="Counters" value={consumable.counterTags.map((t) => `#${t}`).join(' ')} tone="text-purple" />
                )}
              </div>
            </section>

            {/* Effect Rules */}
            {Object.keys(rules).length > 0 && (
              <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-green">Effect Rules</div>
                <div className="space-y-1.5">
                  {rules.survivalFlat !== undefined && <StatRow label="Survival Flat" value={`+${rules.survivalFlat}`} tone="text-green" />}
                  {rules.survivalMultiplier !== undefined && <StatRow label="Survival Multiplier" value={`${rules.survivalMultiplier.toFixed(2)}×`} tone="text-green" />}
                  {rules.dpsMultiplier !== undefined && <StatRow label="DPS Multiplier" value={`${rules.dpsMultiplier.toFixed(2)}×`} tone="text-red" />}
                  {rules.shieldBreakMultiplier !== undefined && <StatRow label="Shield Break Mult" value={`${rules.shieldBreakMultiplier.toFixed(2)}×`} tone="text-cyan" />}
                  {rules.armorBreakMultiplier !== undefined && <StatRow label="Armor Break Mult" value={`${rules.armorBreakMultiplier.toFixed(2)}×`} tone="text-purple" />}
                  {rules.mechanicMultiplier !== undefined && <StatRow label="Mechanic Multiplier" value={`${rules.mechanicMultiplier.toFixed(2)}×`} tone="text-orange" />}
                  {rules.mechanicFlat !== undefined && <StatRow label="Mechanic Flat" value={`+${rules.mechanicFlat}`} tone="text-orange" />}
                  {rules.deathFeeReduction !== undefined && <StatRow label="Death Fee Reduction" value={`${(rules.deathFeeReduction * 100).toFixed(0)}%`} tone="text-amber" />}
                  {rules.bonusLootChance !== undefined && <StatRow label="Bonus Loot Chance" value={`+${(rules.bonusLootChance * 100).toFixed(0)}%`} tone="text-amber" />}
                  {rules.extraLootRollChance !== undefined && <StatRow label="Extra Loot Roll" value={`+${(rules.extraLootRollChance * 100).toFixed(0)}%`} tone="text-amber" />}
                  {rules.bossSlowMultiplier !== undefined && <StatRow label="Boss Slow" value={`${rules.bossSlowMultiplier.toFixed(2)}×`} tone="text-purple" />}
                  {rules.freeOrdnanceUses !== undefined && <StatRow label="Free Ordnance Uses" value={`+${rules.freeOrdnanceUses}`} tone="text-orange" />}
                  {rules.ammoWindowUses !== undefined && <StatRow label="Ammo Window Uses" value={`+${rules.ammoWindowUses}`} tone="text-red" />}
                  {rules.recommendationIntel !== undefined && <StatRow label="Intel Score" value={`+${rules.recommendationIntel}`} tone="text-cyan" />}
                </div>
              </section>
            )}

            {/* Drawback Rules */}
            {drawbacks && Object.keys(drawbacks).length > 0 && (
              <section className="relative mt-3 overflow-hidden border-2 border-red/30 bg-surface/95 p-3" style={panelClip}>
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-red">Drawbacks</div>
                <div className="space-y-1.5">
                  {drawbacks.survivalMultiplier !== undefined && <StatRow label="Survival Mult (penalty)" value={`${drawbacks.survivalMultiplier.toFixed(2)}×`} tone="text-red" />}
                  {drawbacks.rewardMultiplier !== undefined && <StatRow label="Reward Mult (penalty)" value={`${drawbacks.rewardMultiplier.toFixed(2)}×`} tone="text-red" />}
                </div>
              </section>
            )}

            {/* Pricing */}
            <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber">Economy</div>
              <div className="space-y-1.5">
                <StatRow label="Base Price" value={`${consumable.basePrice.toLocaleString()}cr`} tone="text-amber" />
                <StatRow label="Craft Category" value={consumable.craftCategory} tone="text-text-secondary" />
                <StatRow label="Vendor Stocked" value={consumable.isVendorStocked ? 'Yes' : 'No'} tone={consumable.isVendorStocked ? 'text-green' : 'text-text-muted'} />
                <StatRow label="Boss Prep Visible" value={consumable.isBossPrepVisible ? 'Yes' : 'No'} tone={consumable.isBossPrepVisible ? 'text-green' : 'text-text-muted'} />
              </div>
            </section>

            {/* UI Hints */}
            {consumable.uiHints.length > 0 && (
              <section className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3" style={panelClip}>
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">Hints</div>
                <div className="space-y-1">
                  {consumable.uiHints.map((hint, i) => (
                    <div key={i} className="text-[10px] text-text-muted">• {hint}</div>
                  ))}
                </div>
              </section>
            )}

            {/* Implementation */}
            <div className="mt-3 text-center text-[9px] text-text-muted">
              Implementation: {consumable.implementationStatus} · ID: {consumable.id}
            </div>

            {/* Actions */}
            <div className="sticky bottom-0 mt-4 border-t-2 border-border bg-bg/95 pt-3 backdrop-blur">
              <div className="flex gap-2">
                {onEquip && consumable.allowedSlots.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onEquip(consumable.id)}
                    className="flex-1 rounded-xl border border-amber/40 bg-amber/10 py-2 text-xs font-black text-amber"
                  >
                    Equip to Loadout
                  </button>
                )}
                {consumable.isVendorStocked && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 rounded-xl border border-border bg-surface py-2 text-xs font-black text-text-muted"
                  >
                    Buy from Vendor
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
