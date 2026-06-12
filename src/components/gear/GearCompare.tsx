/**
 * GearCompare — shared inline comparison strip for gear swap UIs.
 *
 * Shows per-type key stat deltas (green ↑ better, red ↓ worse, = equal)
 * against a currently equipped item. Used by SlotGearPicker and
 * SyncedLoadoutScreen to give players apples-to-apples comparison
 * when selecting replacement gear.
 */
import React from 'react';
import type { GearItem, Weapon } from '@/types/items';

// ── Type Guards ──────────────────────────────────────────────────────────────

const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const isShield = (item: GearItem): item is { hp: number; mitigation: number; rechargeRate: number; element?: string } =>
  'hp' in item && !isWeapon(item);
const isClassMod = (item: GearItem): item is { treeBonus: string; nodeBoosts: Record<string, number> } =>
  'treeBonus' in item;
const isOrdnance = (item: GearItem): item is { damage: number; shieldDamage: number; armorDamage: number; element?: string; effect: string } =>
  'damage' in item && 'effect' in item && !isWeapon(item);
const isRelic = (item: GearItem): item is { affixes: unknown[] } =>
  !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);

// ── Delta Helpers ────────────────────────────────────────────────────────────

function delta(current: number, candidate: number, fmt?: (v: number) => string): string {
  const diff = candidate - current;
  if (diff === 0) return '=';
  const sign = diff > 0 ? '+' : '';
  const val = fmt ? fmt(diff) : String(Math.round(diff));
  return diff > 0 ? `↑ ${sign}${val}` : `↓ ${sign}${val}`;
}

function deltaPct(current: number, candidate: number): string {
  return delta(current, candidate, (v) => `${Math.round(v * 100)}%`);
}

// ── Per-Type Comparison Rows ─────────────────────────────────────────────────

interface DeltaEntry {
  label: string;
  delta: string;
  better: boolean | null; // null = neutral/equal
}

function weaponDeltas(current: Weapon, candidate: Weapon): DeltaEntry[] {
  return [
    { label: 'PWR', delta: delta(current.combatPower, candidate.combatPower), better: candidate.combatPower > current.combatPower ? true : candidate.combatPower < current.combatPower ? false : null },
    { label: 'DMG', delta: delta(current.baseDamage, candidate.baseDamage), better: candidate.baseDamage > current.baseDamage ? true : candidate.baseDamage < current.baseDamage ? false : null },
    { label: 'Crit', delta: deltaPct(current.critChance, candidate.critChance), better: candidate.critChance > current.critChance ? true : candidate.critChance < current.critChance ? false : null },
    { label: 'AtkSpd', delta: delta(current.attackSpeed, candidate.attackSpeed, (v) => v.toFixed(1)), better: candidate.attackSpeed > current.attackSpeed ? true : candidate.attackSpeed < current.attackSpeed ? false : null },
    { label: 'Boss%', delta: deltaPct(current.bossDamageMod, candidate.bossDamageMod), better: candidate.bossDamageMod > current.bossDamageMod ? true : candidate.bossDamageMod < current.bossDamageMod ? false : null },
    { label: 'Ele', delta: current.element !== candidate.element ? `${current.element} → ${candidate.element}` : current.element, better: null },
  ];
}

function shieldDeltas(current: ReturnType<typeof isShield> extends true ? GearItem : never, candidate: GearItem): DeltaEntry[] {
  const c = current as { hp: number; mitigation: number; rechargeRate: number; element?: string };
  const t = candidate as { hp: number; mitigation: number; rechargeRate: number; element?: string };
  return [
    { label: 'HP', delta: delta(c.hp, t.hp), better: t.hp > c.hp ? true : t.hp < c.hp ? false : null },
    { label: 'Mit', delta: deltaPct(c.mitigation, t.mitigation), better: t.mitigation > c.mitigation ? true : t.mitigation < c.mitigation ? false : null },
    { label: 'Rech', delta: delta(c.rechargeRate, t.rechargeRate), better: t.rechargeRate > c.rechargeRate ? true : t.rechargeRate < c.rechargeRate ? false : null },
    { label: 'Ele', delta: (c.element || '—') !== (t.element || '—') ? `${c.element || '—'} → ${t.element || '—'}` : (t.element || '—'), better: null },
  ];
}

function classModDeltas(current: ReturnType<typeof isClassMod> extends true ? GearItem : never, candidate: GearItem): DeltaEntry[] {
  const c = current as { treeBonus: string; nodeBoosts: Record<string, number> };
  const t = candidate as { treeBonus: string; nodeBoosts: Record<string, number> };
  const cBoost = Object.values(c.nodeBoosts).reduce((s, v) => s + v, 0);
  const tBoost = Object.values(t.nodeBoosts).reduce((s, v) => s + v, 0);
  const cNodes = Object.keys(c.nodeBoosts).length;
  const tNodes = Object.keys(t.nodeBoosts).length;
  return [
    { label: 'Tree', delta: c.treeBonus !== t.treeBonus ? `${c.treeBonus} → ${t.treeBonus}` : t.treeBonus, better: null },
    { label: 'Nodes', delta: delta(cNodes, tNodes), better: tNodes > cNodes ? true : tNodes < cNodes ? false : null },
    { label: 'Boost', delta: delta(cBoost, tBoost), better: tBoost > cBoost ? true : tBoost < cBoost ? false : null },
  ];
}

function ordnanceDeltas(current: ReturnType<typeof isOrdnance> extends true ? GearItem : never, candidate: GearItem): DeltaEntry[] {
  const c = current as { damage: number; shieldDamage: number; armorDamage: number; element?: string; effect: string };
  const t = candidate as { damage: number; shieldDamage: number; armorDamage: number; element?: string; effect: string };
  return [
    { label: 'DMG', delta: delta(c.damage, t.damage), better: t.damage > c.damage ? true : t.damage < c.damage ? false : null },
    { label: 'Shield', delta: delta(c.shieldDamage, t.shieldDamage), better: t.shieldDamage > c.shieldDamage ? true : t.shieldDamage < c.shieldDamage ? false : null },
    { label: 'Armor', delta: delta(c.armorDamage, t.armorDamage), better: t.armorDamage > c.armorDamage ? true : t.armorDamage < c.armorDamage ? false : null },
    { label: 'Ele', delta: (c.element || '—') !== (t.element || '—') ? `${c.element || '—'} → ${t.element || '—'}` : (t.element || '—'), better: null },
  ];
}

function relicDeltas(current: ReturnType<typeof isRelic> extends true ? GearItem : never, candidate: GearItem): DeltaEntry[] {
  const c = current as { affixes?: unknown[] };
  const t = candidate as { affixes?: unknown[] };
  const cCount = c.affixes?.length ?? 0;
  const tCount = t.affixes?.length ?? 0;
  return [
    { label: 'Affixes', delta: delta(cCount, tCount), better: tCount > cCount ? true : tCount < cCount ? false : null },
  ];
}

// ── Component ────────────────────────────────────────────────────────────────

interface GearCompareProps {
  current: GearItem;
  candidate: GearItem;
  compact?: boolean; // fewer rows for tight spaces
}

export const GearCompare: React.FC<GearCompareProps> = ({ current, candidate, compact = false }) => {
  let deltas: DeltaEntry[] = [];

  if (isWeapon(current) && isWeapon(candidate)) {
    deltas = weaponDeltas(current, candidate);
    if (compact) deltas = deltas.slice(0, 3);
  } else if (isShield(current) && isShield(candidate)) {
    deltas = shieldDeltas(current, candidate);
    if (compact) deltas = deltas.slice(0, 2);
  } else if (isClassMod(current) && isClassMod(candidate)) {
    deltas = classModDeltas(current, candidate);
  } else if (isOrdnance(current) && isOrdnance(candidate)) {
    deltas = ordnanceDeltas(current, candidate);
    if (compact) deltas = deltas.slice(0, 2);
  } else if (isRelic(current) && isRelic(candidate)) {
    deltas = relicDeltas(current, candidate);
  }

  if (deltas.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
      {deltas.map((d) => {
        const isUp = d.better === true;
        const isDown = d.better === false;
        return (
          <span
            key={d.label}
            className={`text-[9px] font-black inline-flex items-center gap-0.5 ${
              isUp ? 'text-green' : isDown ? 'text-red' : 'text-text-muted'
            }`}
          >
            <span className="text-[8px] text-text-muted/70">{d.label}</span>
            {d.delta}
          </span>
        );
      })}
    </div>
  );
};
