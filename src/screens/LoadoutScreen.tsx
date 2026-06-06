import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, Plus, Zap, TrendingUp, TrendingDown, Shield } from 'lucide-react';
import { useInventoryStore, useLoadoutStore, useBossStore, usePlayerStore } from '@/store';
import { Weapon, Shield as ShieldType, ClassMod, Relic, Ordnance, GearItem } from '@/types/items';
import { WeaponCanvas } from '@/components/pixelArt/WeaponCanvas';
import { WeaponCard } from '@/components/common/WeaponCard';
import { MobileCard } from '@/components/layout/MobileCard';
import { CONSUMABLES } from '@/constants/consumables';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { Element } from '@/types/game';

// ── Type guards (same pattern as loadoutSlice.ts) ──────────────────────────

const isWeapon = (item: GearItem): item is Weapon =>
  'weaponType' in item;

const isShield = (item: GearItem): item is ShieldType =>
  'hp' in item && !('weaponType' in item);

const isClassMod = (item: GearItem): item is ClassMod =>
  'treeBonus' in item;

const isOrdnance = (item: GearItem): item is Ordnance =>
  'damage' in item && 'effect' in item && !('weaponType' in item);

const isRelic = (item: GearItem): item is Relic =>
  'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);

// ── Slot definitions ─────────────────────────────────────────────────────

const SLOTS = [
  { key: 'primary', label: 'Primary Weapon', desc: 'Main combat weapon' },
  { key: 'secondary', label: 'Secondary Weapon', desc: 'Support / passive stats' },
  { key: 'heavy', label: 'Heavy Weapon', desc: 'Burst / phase break' },
  { key: 'ordnance', label: 'Ordnance', desc: 'Grenades / deployables' },
  { key: 'shield', label: 'Shield', desc: 'Survivability' },
  { key: 'classMod', label: 'Class Mod', desc: 'Skill tree boost' },
  { key: 'relic', label: 'Relic', desc: 'Global modifiers' },
] as const;

type SlotKey = (typeof SLOTS)[number]['key'];

// ── Slot filter per type guard ────────────────────────────────────────────

const slotFilterFns: Record<SlotKey, (item: GearItem) => boolean> = {
  primary: isWeapon,
  secondary: isWeapon,
  heavy: (item) => isWeapon(item) && (item.weaponType === 'Launcher' || item.weaponType === 'Shotgun'),
  shield: isShield,
  classMod: isClassMod,
  ordnance: isOrdnance,
  relic: isRelic,
};

// ── Stat helpers ──────────────────────────────────────────────────────────

/** Get bossPower from a weapon (0 for non-weapons). */
const getBossPower = (item: GearItem): number =>
  isWeapon(item) ? item.bossPower : 0;

/** Compute a rough overall power score for sorting. */
const getPowerScore = (item: GearItem): number => {
  if (isWeapon(item)) return item.combatPower;
  if (isShield(item)) return item.hp * 0.5 + item.mitigation * 10;
  if (isClassMod(item)) return Object.values(item.nodeBoosts).reduce((a, b) => a + b, 0) * 5;
  if (isOrdnance(item)) return item.damage * 2 + item.shieldDamage + item.armorDamage;
  if (isRelic(item)) return item.affixes.length * 20;
  return 0;
};

// ── Components ────────────────────────────────────────────────────────────

/** Small colored delta badge for stat comparisons. */
const StatDelta: React.FC<{ label: string; current: number; candidate: number; suffix?: string; invert?: boolean }> = ({
  label, current, candidate, suffix = '', invert = false,
}) => {
  const diff = candidate - current;
  const better = invert ? diff < 0 : diff > 0;
  if (diff === 0) return null;
  return (
    <div className="flex items-center gap-1 text-[10px]">
      <span className="text-text-muted w-16 shrink-0">{label}</span>
      <span className={better ? 'text-green' : 'text-red'}>
        {better ? '+' : ''}{diff.toFixed(current % 1 === 0 ? 0 : 1)}{suffix}
      </span>
      {better ? <TrendingUp size={10} className="text-green" /> : <TrendingDown size={10} className="text-red" />}
    </div>
  );
};

/** Compare box showing current vs candidate item. */
const CompareView: React.FC<{
  current: GearItem;
  candidate: GearItem;
  onEquip: () => void;
  onCancel: () => void;
}> = ({ current, candidate, onEquip, onCancel }) => {
  const currentBossPower = getBossPower(current);
  const candidateBossPower = getBossPower(candidate);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl border border-border bg-surface p-3 space-y-3"
    >
      <div className="text-xs font-bold text-text-primary text-center">Compare &amp; Confirm</div>

      {/* Side-by-side */}
      <div className="grid grid-cols-2 gap-2">
        {/* Current */}
        <div className="rounded-lg bg-surface-raised p-2 border border-border">
          <div className="text-[10px] text-text-muted uppercase mb-0.5">Current</div>
          <div className="text-xs font-bold text-text-primary truncate">
            {(current as any).name || current.id}
          </div>
          <div className="text-[10px] text-text-muted">
            Lv.{(current as any).level} · {(current as any).rarity}
          </div>
          {isWeapon(current) && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[10px] text-text-muted">Dmg {current.baseDamage} · Spd {current.attackSpeed.toFixed(2)}</div>
              <div className="text-[10px] text-text-muted">Boss {(current.bossDamageMod * 100).toFixed(0)}%</div>
              <div className="text-[10px] text-amber/80">⚡ bossPower {current.bossPower.toFixed(0)}</div>
            </div>
          )}
          {isShield(current) && (
            <div className="text-[10px] text-text-muted mt-1">
              HP {current.hp} · Mit {(current.mitigation * 100).toFixed(0)}%
            </div>
          )}
          {isOrdnance(current) && (
            <div className="text-[10px] text-text-muted mt-1">
              Dmg {current.damage} · {current.effect}
            </div>
          )}
        </div>

        {/* Candidate */}
        <div className="rounded-lg bg-surface border border-primary/30 p-2">
          <div className="text-[10px] text-primary uppercase mb-0.5">Candidate</div>
          <div className="text-xs font-bold text-text-primary truncate">
            {(candidate as any).name || candidate.id}
          </div>
          <div className="text-[10px] text-text-muted">
            Lv.{(candidate as any).level} · {(candidate as any).rarity}
          </div>
          {isWeapon(candidate) && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[10px] text-text-muted">Dmg {candidate.baseDamage} · Spd {candidate.attackSpeed.toFixed(2)}</div>
              <div className="text-[10px] text-text-muted">Boss {(candidate.bossDamageMod * 100).toFixed(0)}%</div>
              <div className="text-[10px] text-amber/80">⚡ bossPower {candidate.bossPower.toFixed(0)}</div>
            </div>
          )}
          {isShield(candidate) && (
            <div className="text-[10px] text-text-muted mt-1">
              HP {candidate.hp} · Mit {(candidate.mitigation * 100).toFixed(0)}%
            </div>
          )}
          {isOrdnance(candidate) && (
            <div className="text-[10px] text-text-muted mt-1">
              Dmg {candidate.damage} · {candidate.effect}
            </div>
          )}
        </div>
      </div>

      {/* Deltas */}
      <div className="space-y-0.5 bg-surface-raised rounded-lg p-2">
        <div className="text-[10px] text-text-muted uppercase mb-1">Stat Changes</div>
        {isWeapon(current) && isWeapon(candidate) && (
          <>
            <StatDelta label="Base Dmg" current={current.baseDamage} candidate={candidate.baseDamage} />
            <StatDelta label="Atk Spd" current={current.attackSpeed} candidate={candidate.attackSpeed} suffix="x" />
            <StatDelta label="Crit %" current={current.critChance * 100} candidate={candidate.critChance * 100} suffix="%" />
            <StatDelta label="Boss Dmg" current={current.bossDamageMod * 100} candidate={candidate.bossDamageMod * 100} suffix="%" />
            <StatDelta label="bossPower" current={currentBossPower} candidate={candidateBossPower} />
          </>
        )}
        {isShield(current) && isShield(candidate) && (
          <>
            <StatDelta label="HP" current={current.hp} candidate={candidate.hp} />
            <StatDelta label="Mitigation" current={current.mitigation * 100} candidate={candidate.mitigation * 100} suffix="%" />
          </>
        )}
        {isOrdnance(current) && isOrdnance(candidate) && (
          <>
            <StatDelta label="Damage" current={current.damage} candidate={candidate.damage} />
            <StatDelta label="Shield Dmg" current={current.shieldDamage} candidate={candidate.shieldDamage} />
            <StatDelta label="Armor Dmg" current={current.armorDamage} candidate={candidate.armorDamage} />
          </>
        )}
        {currentBossPower !== candidateBossPower && (
          <StatDelta label="bossPower" current={currentBossPower} candidate={candidateBossPower} />
        )}
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg bg-surface-raised text-text-muted text-xs font-bold border border-border"
        >
          Keep Current
        </button>
        <button
          onClick={onEquip}
          className="flex-1 py-2 rounded-lg bg-primary/20 text-primary text-xs font-bold border border-primary/30"
        >
          Equip New
        </button>
      </div>
    </motion.div>
  );
};

/** Single inventory item row in the equip drawer. */
const InventoryItemRow: React.FC<{
  item: GearItem;
  onSelect: () => void;
}> = ({ item, onSelect }) => (
  <div onClick={onSelect} className="cursor-pointer">
    {isWeapon(item) ? (
      <WeaponCard weapon={item} />
    ) : (
      <MobileCard className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-surface-raised border border-border flex items-center justify-center text-text-muted text-[10px]">
          {(item as any).rarity || 'Gear'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-text-primary">
            {(item as any).name || 'Unknown'}
          </div>
          <div className="text-[10px] text-text-muted">
            Lv.{(item as any).level} · {(item as any).rarity}
            {item.isLocked && (
              <span className="ml-1 text-text-muted">🔒</span>
            )}
          </div>
          {/* Show key stats inline */}
          {isShield(item) && (
            <div className="text-[10px] text-text-muted">HP {item.hp} · Mit {(item.mitigation * 100).toFixed(0)}%</div>
          )}
          {isClassMod(item) && (
            <div className="text-[10px] text-text-muted">Tree: {item.treeBonus}</div>
          )}
          {isOrdnance(item) && (
            <div className="text-[10px] text-text-muted">Dmg {item.damage} · {item.effect}</div>
          )}
          {isRelic(item) && (
            <div className="text-[10px] text-text-muted">{item.affixes.length} affix{item.affixes.length !== 1 ? 'es' : ''}</div>
          )}
          {/* bossPower for weapons in drawer */}
          {isWeapon(item) && (
            <div className="text-[10px] text-amber/80">⚡ bossPower {item.bossPower.toFixed(0)}</div>
          )}
        </div>
        <ChevronRight size={14} className="text-text-muted" />
      </MobileCard>
    )}
  </div>
);

// ── Main screen ───────────────────────────────────────────────────────────

export const LoadoutScreen: React.FC = () => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const bossStore = useBossStore();
  const playerStore = usePlayerStore();

  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  const [compareCandidateId, setCompareCandidateId] = useState<string | null>(null);

  // ── Current boss info ──────────────────────────────────────────────────

  const currentBoss = useMemo(() => {
    if (!bossStore.currentBossId) return null;
    return REGION_1_BOSSES.find((b) => b.id === bossStore.currentBossId) ?? null;
  }, [bossStore.currentBossId]);

  // ── Cached filter results for active slot ──────────────────────────────

  const slotFilteredItems = useMemo(() => {
    if (!activeSlot) return [];
    const filterFn = slotFilterFns[activeSlot];
    return inventory.items.filter(filterFn);
  }, [activeSlot, inventory.items]);

  // ── Helpers ────────────────────────────────────────────────────────────

  const getEquippedItem = (slot: SlotKey): GearItem | undefined => {
    const id = loadout.slots[slot];
    if (!id) return undefined;
    return inventory.getById(id);
  };

  const getEquippedName = (slot: string) => {
    const id = loadout.slots[slot as SlotKey];
    if (!id) return null;
    const item = inventory.getById(id);
    return item ? (item as Weapon).name : 'Unknown';
  };

  const equipItem = (itemId: string) => {
    if (!activeSlot) return;

    const candidate = inventory.items.find((i) => i.id === itemId);
    const currentEquipped = getEquippedItem(activeSlot);

    // If there's an already-equipped item AND we picked a different one, show compare
    if (currentEquipped && candidate && candidate.id !== currentEquipped.id) {
      setCompareCandidateId(itemId);
      return;
    }

    // No current equipped or same item — just equip
    loadout.setSlot(activeSlot, itemId);
    setActiveSlot(null);
    setCompareCandidateId(null);
  };

  const confirmEquip = () => {
    if (!activeSlot || !compareCandidateId) return;
    loadout.setSlot(activeSlot, compareCandidateId);
    setActiveSlot(null);
    setCompareCandidateId(null);
  };

  const cancelCompare = () => {
    setCompareCandidateId(null);
  };

  const unequip = (slot: string) => {
    loadout.setSlot(slot as SlotKey, null);
  };

  // ── Auto-equip best ────────────────────────────────────────────────────

  const autoEquipBest = () => {
    for (const slotDef of SLOTS) {
      const slotKey = slotDef.key;
      // Only fill empty slots
      if (loadout.slots[slotKey]) continue;

      const filterFn = slotFilterFns[slotKey];
      const candidates = inventory.items.filter(filterFn);
      if (candidates.length === 0) continue;

      // Pick highest power score
      const best = candidates.reduce((a, b) =>
        getPowerScore(a) > getPowerScore(b) ? a : b
      );
      loadout.setSlot(slotKey, best.id);
    }
  };

  const hasEmptySlots = SLOTS.some((s) => !loadout.slots[s.key]);
  const getCompareCandidate = (): GearItem | undefined => {
    if (!compareCandidateId) return undefined;
    return inventory.items.find((i) => i.id === compareCandidateId);
  };
  const currentEquippedForCompare = activeSlot ? getEquippedItem(activeSlot) : undefined;
  const compareCandidateItem = getCompareCandidate();
  const showCompare =
    !!activeSlot && !!currentEquippedForCompare && !!compareCandidateItem;

  // ── Element label helper ────────────────────────────────────────────────

  const elementLabel = (el: Element): string => {
    const map: Record<Element, string> = {
      [Element.Kinetic]: 'Kinetic',
      [Element.Fire]: 'Fire',
      [Element.Shock]: 'Shock',
      [Element.Corrosive]: 'Corrosive',
      [Element.Cryo]: 'Cryo',
      [Element.Void]: 'Void',
    };
    return map[el] || el;
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-black text-text-primary">Loadout</div>
          <div className="text-xs text-text-muted">
            Tap a slot to equip gear from your cache.
          </div>
        </div>
        {hasEmptySlots && (
          <button
            onClick={autoEquipBest}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/20 text-primary text-xs font-bold border border-primary/30"
          >
            <Zap size={12} />
            Auto-equip Best
          </button>
        )}
      </div>

      {/* Boss hint */}
      {currentBoss && (
        <div className="rounded-xl bg-amber/10 border border-amber/30 p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <Shield size={14} className="text-amber" />
            <span className="text-xs font-bold text-amber">Boss Intel: {currentBoss.name}</span>
          </div>
          <div className="text-[10px] text-text-muted">
            {currentBoss.weaknesses.length > 0 ? (
              <>
                Weak to{' '}
                <span className="font-bold text-green">
                  {currentBoss.weaknesses.map(elementLabel).join(', ')}
                </span>
                {' — '}equip these element weapons for bonus damage.
              </>
            ) : (
              'No elemental weaknesses.'
            )}
            {currentBoss.resistances.length > 0 && (
              <>
                {' '}Resists{' '}
                <span className="font-bold text-red">
                  {currentBoss.resistances.map(elementLabel).join(', ')}
                </span>
                .
              </>
            )}
          </div>
          <div className="text-[10px] text-text-muted">
            Rec. Power: {currentBoss.recommendedPower} · Lv.{currentBoss.level} · Tier {currentBoss.tier}
          </div>
        </div>
      )}

      {/* Gear slots */}
      <div className="space-y-2">
        {SLOTS.map((slot) => {
          const equippedItem = getEquippedItem(slot.key);
          return (
            <MobileCard
              key={slot.key}
              onClick={() => {
                setActiveSlot(slot.key);
                setCompareCandidateId(null);
              }}
              className={`flex items-center gap-3 cursor-pointer ${
                activeSlot === slot.key ? 'ring-2 ring-primary/50' : ''
              }`}
            >
              {equippedItem && isWeapon(equippedItem) ? (
                <WeaponCanvas
                  type={equippedItem.weaponType}
                  manufacturer={equippedItem.manufacturer}
                  element={equippedItem.element}
                  rarity={equippedItem.rarity}
                  size={48}
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-surface-raised border border-dashed border-border flex items-center justify-center">
                  <Plus size={20} className="text-text-muted" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-text-primary">{slot.label}</div>
                <div className="text-[10px] text-text-muted">
                  {equippedItem ? (equippedItem as any).name : slot.desc}
                </div>
                {/* bossPower badge for equipped weapons */}
                {equippedItem && isWeapon(equippedItem) && (
                  <div className="text-[10px] text-amber/80">⚡ bossPower {equippedItem.bossPower.toFixed(0)}</div>
                )}
              </div>
              <ChevronRight size={16} className="text-text-muted" />
            </MobileCard>
          );
        })}
      </div>

      {/* Equip Drawer */}
      <AnimatePresence>
        {activeSlot && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-50 bg-surface rounded-t-2xl border-t border-border p-4 max-h-[70vh] overflow-y-auto"
            style={{ maxWidth: 480, margin: '0 auto' }}
          >
            <div className="w-12 h-1.5 bg-border rounded-full mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-text-primary">
                Equip {SLOTS.find((s) => s.key === activeSlot)?.label}
              </div>
              <button onClick={() => { setActiveSlot(null); setCompareCandidateId(null); }} className="text-xs text-text-muted">
                Close
              </button>
            </div>

            <div className="space-y-2">
              {showCompare && currentEquippedForCompare && compareCandidateItem ? (
                <CompareView
                  current={currentEquippedForCompare}
                  candidate={compareCandidateItem}
                  onEquip={confirmEquip}
                  onCancel={cancelCompare}
                />
              ) : slotFilteredItems.length > 0 ? (
                slotFilteredItems.map((item) => (
                  <InventoryItemRow
                    key={item.id}
                    item={item}
                    onSelect={() => equipItem(item.id)}
                  />
                ))
              ) : (
                <div className="py-8 text-center">
                  <div className="text-sm font-bold text-text-muted mb-1">
                    No {SLOTS.find((s) => s.key === activeSlot)?.label} items
                  </div>
                  <div className="text-[10px] text-text-muted max-w-xs mx-auto">
                    No {SLOTS.find((s) => s.key === activeSlot)?.label.toLowerCase()} items in your inventory.
                    Farm from the Fight tab or open Data Caches to get gear.
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => unequip(activeSlot)}
              className="w-full mt-3 py-2 rounded-lg bg-red/10 text-red text-xs font-bold border border-red/30"
            >
              Unequip Slot
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
