/**
 * GearCompare — shared inline comparison strip for gear swap UIs.
 *
 * Shows per-type key stat deltas against the currently equipped
 * item: signed text (+5 / -3 / =) in green / red / muted — the
 * game's delta language (heroRundown's stageStatDelta), never
 * unicode arrows, never below the 11px type floor (DESIGN.md §5/§7).
 * Consumers: SlotGearPicker rows and MarketScreen Buy-lane cards.
 *
 * This is the STAT layer only: direct item fields, DPS through
 * dpsChain, zero build math. The build-layer consequence of a swap
 * ("The Trade") lives in the inspect sheet and runs the character
 * stat summary once per opened sheet — rows render in the hundreds
 * on deep inventories and must stay O(item) (gear-freeze rule).
 *
 * Direction of "better" is declared per stat, never assumed from
 * the sign alone (the ConsumableCompare discipline): every entry
 * carries its own verdict, and facts with no honest verdict —
 * element, shield behavior, recharge (a rate whose worth depends
 * on how much quiet time a build gets; ARCHITECTURE.md
 * shield-defense row) — print as neutral lines, never green/red.
 */
import React from 'react';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { SHIELD_BEHAVIORS, shieldBehaviorOf } from '@/lib/combat/shieldBehaviors';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import { formatSignedPct, formatWhole } from '@/lib/stats/formatStat';
import { SKILL_NODES } from '@/constants/skillTrees';

// ── Type Guards ──────────────────────────────────────────────────────────────

const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
const isShield = (item: GearItem): item is Shield => 'hp' in item && !isWeapon(item);
const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
const isOrdnance = (item: GearItem): item is Ordnance => 'damage' in item && 'effect' in item && !isWeapon(item);
const isRelic = (item: GearItem): item is Relic =>
  !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);

// ── Delta Helpers ────────────────────────────────────────────────────────────

interface DeltaEntry {
  label: string;
  text: string;
  /** true = gain (green), false = loss (red), null = neutral / equal (muted). */
  better: boolean | null;
}

/** Signed whole-number delta; '=' when unchanged. Higher is better. */
function numDelta(label: string, current: number, candidate: number, fmt: (v: number) => string = (v) => formatWhole(v)): DeltaEntry {
  const diff = candidate - current;
  if (diff === 0) return { label, text: '=', better: null };
  return { label, text: `${diff > 0 ? '+' : ''}${fmt(diff)}`, better: diff > 0 };
}

/** Signed percentage-point delta for fraction fields (0.05 -> "+5%"). */
function pctDelta(label: string, current: number, candidate: number): DeltaEntry {
  const diff = candidate - current;
  if (diff === 0) return { label, text: '=', better: null };
  return { label, text: formatSignedPct(diff), better: diff > 0 };
}

/** A fact with no better/worse verdict — printed muted, always. */
function fact(label: string, text: string): DeltaEntry {
  return { label, text, better: null };
}

const skillNodeName = (nodeId: string) =>
  SKILL_NODES.find((node) => node.id === nodeId)?.name ?? nodeId;

// ── Per-Type Comparison Rows ─────────────────────────────────────────────────

function weaponDeltas(current: Weapon, candidate: Weapon): DeltaEntry[] {
  return [
    // DPS first: the number the inspect sheet leads with and the
    // number players sort by (dpsChain via computeStandardDps —
    // the only DPS math).
    numDelta('DPS', computeStandardDps(current), computeStandardDps(candidate)),
    numDelta('DMG', current.baseDamage, candidate.baseDamage),
    pctDelta('Crit', current.critChance, candidate.critChance),
    numDelta('AtkSpd', current.attackSpeed, candidate.attackSpeed, (v) => v.toFixed(1)),
    pctDelta('CritDmg', current.critDamage, candidate.critDamage),
    pctDelta('Boss%', current.bossDamageMod, candidate.bossDamageMod),
    pctDelta('Offline%', current.offlineEarningsMod, candidate.offlineEarningsMod),
    pctDelta('Shield', current.shieldDamageMod, candidate.shieldDamageMod),
    pctDelta('Armor', current.armorDamageMod, candidate.armorDamageMod),
    fact('Ele', current.element !== candidate.element ? `${current.element} to ${candidate.element}` : current.element),
  ];
}

function shieldDeltas(current: Shield, candidate: Shield): DeltaEntry[] {
  const cBehavior = SHIELD_BEHAVIORS[shieldBehaviorOf(current)].name;
  const tBehavior = SHIELD_BEHAVIORS[shieldBehaviorOf(candidate)].name;
  return [
    numDelta('HP', current.hp, candidate.hp),
    pctDelta('Mit', current.mitigation, candidate.mitigation),
    // Recharge prints as an item FACT: the engines consume
    // rechargeRate (suppression-ruled, shieldBehaviors.ts), but a
    // rate delta's worth depends on the build's quiet time, so its
    // delta is never colored as a trade.
    (() => {
      const entry = numDelta('Rech', current.rechargeRate, candidate.rechargeRate);
      return { ...entry, better: null };
    })(),
    fact('Ele', (current.element || '—') !== (candidate.element || '—') ? `${current.element || '—'} to ${candidate.element || '—'}` : (candidate.element || '—')),
    fact('Behav', cBehavior !== tBehavior ? `${cBehavior} to ${tBehavior}` : tBehavior),
  ];
}

function classModDeltas(current: ClassMod, candidate: ClassMod): DeltaEntry[] {
  const entries: DeltaEntry[] = [];
  if (current.treeBonus !== candidate.treeBonus) {
    entries.push(fact('Tree', `${current.treeBonus} to ${candidate.treeBonus}`));
  }
  // Per-node boosts BY NAME — a total ("Boost +3") hides which
  // skills move, and the skills are the trade.
  const nodeIds = new Set([...Object.keys(current.nodeBoosts), ...Object.keys(candidate.nodeBoosts)]);
  for (const nodeId of nodeIds) {
    const diff = (candidate.nodeBoosts[nodeId] ?? 0) - (current.nodeBoosts[nodeId] ?? 0);
    if (diff === 0) continue;
    entries.push({
      label: skillNodeName(nodeId),
      text: `${diff > 0 ? '+' : ''}${diff}`,
      better: diff > 0,
    });
  }
  if (entries.length === 0) entries.push(fact('Boosts', '='));
  return entries;
}

function ordnanceDeltas(current: Ordnance, candidate: Ordnance): DeltaEntry[] {
  const entries: DeltaEntry[] = [
    numDelta('Payload', current.damage, candidate.damage),
    numDelta('Shield', current.shieldDamage, candidate.shieldDamage),
    numDelta('Armor', current.armorDamage, candidate.armorDamage),
    fact('Ele', (current.element || '—') !== (candidate.element || '—') ? `${current.element || '—'} to ${candidate.element || '—'}` : (candidate.element || '—')),
  ];
  if (current.effect !== candidate.effect) {
    entries.push(fact('Effect', `${current.effect} to ${candidate.effect}`));
  }
  return entries;
}

function relicDeltas(current: Relic, candidate: Relic): DeltaEntry[] {
  // Affix-by-affix, by displayText — a bare count ("Affixes -1")
  // was the old strip's whole answer for the kind whose identity
  // IS its affixes. Multiset diff so duplicated texts count.
  const remaining = new Map<string, number>();
  for (const affix of current.affixes) remaining.set(affix.displayText, (remaining.get(affix.displayText) ?? 0) + 1);
  const gained: string[] = [];
  for (const affix of candidate.affixes) {
    const left = remaining.get(affix.displayText) ?? 0;
    if (left > 0) remaining.set(affix.displayText, left - 1);
    else gained.push(affix.displayText);
  }
  const lost: string[] = [];
  for (const [text, count] of remaining) for (let i = 0; i < count; i += 1) lost.push(text);
  const entries: DeltaEntry[] = [
    ...gained.map((text) => ({ label: 'Affix', text, better: true as boolean | null })),
    ...lost.map((text) => ({ label: 'Affix', text, better: false as boolean | null })),
  ];
  if (entries.length === 0) entries.push(fact('Affixes', '='));
  return entries;
}

// ── Component ────────────────────────────────────────────────────────────────

interface GearCompareProps {
  current: GearItem;
  candidate: GearItem;
  compact?: boolean; // fewer entries for tight rows — sheds the tail, never shrinks type
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
      {deltas.map((d, i) => {
        const isUp = d.better === true;
        const isDown = d.better === false;
        return (
          <span
            key={`${d.label}-${i}`}
            className={`text-[11px] font-black inline-flex items-center gap-1 ${
              isUp ? 'text-green' : isDown ? 'text-red' : 'text-text-muted'
            }`}
          >
            <span className="text-text-muted/70">{d.label}</span>
            {d.text}
          </span>
        );
      })}
    </div>
  );
};
