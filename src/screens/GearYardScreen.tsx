import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftRight, Lock, ShoppingBag, Sword, Trash2, Unlock } from 'lucide-react';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { WeaponIllustration } from '@/components/weapon/WeaponIllustration';
import { RARITIES } from '@/constants/rarities';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import type { GearItem, Weapon } from '@/types/items';
import { Rarity } from '@/types/game';

type GearFilter = 'All' | 'Weapon' | 'Shield' | 'Class Mod' | 'Relic' | 'Ordnance';
type ViewFilter = 'All' | 'Equipped' | 'Tradeable' | 'Scrap';

const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const kindOf = (item: GearItem): GearFilter => isWeapon(item) ? 'Weapon' : 'hp' in item ? 'Shield' : 'treeBonus' in item ? 'Class Mod' : 'effect' in item && 'damage' in item ? 'Ordnance' : 'Relic';
const colorOf = (item: GearItem) => RARITIES[item.rarity]?.color ?? '#F5B544';

function preview(item: GearItem) {
  if (isWeapon(item)) return `PWR ${item.combatPower} · ${item.element} · ${item.manufacturer}`;
  if ('hp' in item) return `HP ${item.hp} · Mit ${Math.round(item.mitigation * 100)}% · ${item.element}`;
  if ('treeBonus' in item) return `${item.treeBonus} · ${Object.keys(item.nodeBoosts).length} nodes`;
  if ('damage' in item && 'effect' in item) return `DMG ${item.damage} · ${item.element} · ${item.effect}`;
  return `${'affixes' in item ? item.affixes.length : 0} affixes · ${item.sourceTag}`;
}

export const GearYardScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const player = usePlayerStore();
  const [selected, setSelected] = useState<GearItem | null>(null);
  const [typeFilter, setTypeFilter] = useState<GearFilter>('All');
  const [viewFilter, setViewFilter] = useState<ViewFilter>('All');
  const equippedIds = useMemo(() => new Set(Object.values(loadout.slots).filter(Boolean) as string[]), [loadout.slots]);

  const items = useMemo(() => inventory.items.filter((item) => {
    if (typeFilter !== 'All' && kindOf(item) !== typeFilter) return false;
    if (viewFilter === 'Equipped') return equippedIds.has(item.id);
    if (viewFilter === 'Tradeable') return !item.isLocked && !equippedIds.has(item.id);
    if (viewFilter === 'Scrap') return !item.isLocked && !equippedIds.has(item.id) && (item.rarity === Rarity.Common || item.rarity === Rarity.Uncommon);
    return true;
  }), [equippedIds, inventory.items, typeFilter, viewFilter]);

  const equip = (item: GearItem) => {
    if ('hp' in item) { loadout.setSlot('shield', item.id); setSelected(null); return; }
    if ('treeBonus' in item) { loadout.setSlot('classMod', item.id); setSelected(null); return; }
    if ('effect' in item && 'damage' in item && !isWeapon(item)) { loadout.setSlot('ordnance', item.id); setSelected(null); return; }
    if (!isWeapon(item)) { loadout.setSlot('relic', item.id); setSelected(null); return; }
    // Weapon: auto-equip into the first available weapon slot.
    const weaponSlots: Array<'primary' | 'secondary' | 'heavy'> = ['primary', 'secondary', 'heavy'];
    const firstEmpty = weaponSlots.find((s) => !loadout.slots[s]);
    if (firstEmpty) {
      loadout.setSlot(firstEmpty, item.id);
    } else {
      // All weapon slots occupied — let the user swap on the Loadout screen.
      onNavigate?.('loadout');
    }
    setSelected(null);
  };

  const scrap = (item: GearItem) => {
    const result = inventory.scrapItem(item.id);
    player.addScrap(result.scrapValue);
    Object.entries(result.materials).forEach(([type, count]) => count > 0 && player.addMaterial(type, count));
    Object.entries(result.essences).forEach(([type, count]) => count > 0 && player.addEssence(type, count));
    setSelected(null);
  };

  const actions = selected ? (
    <div className="grid grid-cols-4 gap-2">
      <button type="button" onClick={() => equip(selected)} className="flex flex-col items-center gap-1 border border-amber/40 bg-amber/10 py-2 text-[9px] font-black text-amber"><Sword size={15} />Equip</button>
      <button type="button" onClick={() => onNavigate?.('market')} className="flex flex-col items-center gap-1 border border-green/40 bg-green/10 py-2 text-[9px] font-black text-green"><ShoppingBag size={15} />Market</button>
      <button type="button" onClick={() => selected.isLocked ? inventory.unlockItem(selected.id) : inventory.lockItem(selected.id)} className="flex flex-col items-center gap-1 border border-border bg-surface py-2 text-[9px] font-black text-text-secondary">{selected.isLocked ? <Unlock size={15} /> : <Lock size={15} />}{selected.isLocked ? 'Unlock' : 'Lock'}</button>
      <button type="button" onClick={() => scrap(selected)} className="flex flex-col items-center gap-1 border border-red/40 bg-red/10 py-2 text-[9px] font-black text-red"><Trash2 size={15} />Scrap</button>
    </div>
  ) : null;

  return (
    <div className="space-y-3 p-3 pb-20">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-black text-text-primary">Cache Inventory</div>
          <div className="text-[10px] text-text-muted">Tap any gear to inspect full stats, animation, quantity, salvage, and market supply.</div>
        </div>
        <div className="rounded-full border border-border bg-surface px-2 py-1 text-[10px] font-black text-amber">{inventory.items.length} items</div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['All', 'Weapon', 'Shield', 'Class Mod', 'Relic', 'Ordnance'] as GearFilter[]).map((filter) => <button key={filter} onClick={() => setTypeFilter(filter)} className={`rounded-full border px-2 py-1 text-[10px] font-black ${typeFilter === filter ? 'border-amber bg-amber text-bg' : 'border-border bg-surface text-text-muted'}`}>{filter}</button>)}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(['All', 'Equipped', 'Tradeable', 'Scrap'] as ViewFilter[]).map((filter) => <button key={filter} onClick={() => setViewFilter(filter)} className={`rounded-full border px-2 py-1 text-[10px] font-black ${viewFilter === filter ? 'border-amber bg-amber text-bg' : 'border-border bg-surface text-text-muted'}`}>{filter}</button>)}
      </div>

      <div className="space-y-2">
        {items.length === 0 && <div className="py-10 text-center text-sm text-text-muted">No gear matches these filters.</div>}
        {items.map((item) => (
          <motion.button key={item.id} layout whileTap={{ scale: 0.98 }} onClick={() => setSelected(item)} className="relative flex w-full items-center gap-3 border border-border bg-surface p-3 text-left" style={{ borderLeftColor: colorOf(item), borderLeftWidth: 4 }}>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-border bg-bg">
              {isWeapon(item) ? <WeaponIllustration weapon={item} size={54} showBadges={false} animate={false} /> : <span className="text-lg font-black" style={{ color: colorOf(item) }}>{kindOf(item)[0]}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-black" style={{ color: colorOf(item) }}>{item.name}</div>
              <div className="mt-0.5 text-[10px] text-text-muted">{item.rarity} · Lv.{item.level} · {kindOf(item)} {equippedIds.has(item.id) ? '· Equipped' : ''}</div>
              <div className="mt-1 truncate text-[10px] text-text-secondary">{preview(item)}</div>
            </div>
            <ArrowLeftRight size={13} className="text-text-muted" />
          </motion.button>
        ))}
      </div>

      <GearInspectSheet item={selected} open={!!selected} onClose={() => setSelected(null)} contextLabel="Inventory Inspect" actions={actions} />
    </div>
  );
};
