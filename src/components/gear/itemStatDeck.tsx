import React from 'react';
import { rollQualityLabel } from '@/constants/rarities';
import {
  affixesOf,
  isClassMod,
  isWeapon,
  legendaryEffectOf,
  partStatLabel,
  skillNodeName,
  slashClip,
  statRows,
  useBossRelativeDps,
} from '@/lib/gear/itemStatDeck';
import type { Affix, GearItem, WeaponPart } from '@/types/items';

/**
 * Shared stat-deck components — the rendering half of the ONE item
 * stat deck source. Data (rows, labels, effect resolution) lives in
 * `src/lib/gear/itemStatDeck.ts`; these components are what the
 * inspect sheet and the cache reveal page both render, so the two
 * surfaces can never disagree about an item's numbers.
 */

export function StatLine({ label, value, tone = 'text-text-primary', width = 50 }: { label: string; value: React.ReactNode; tone?: string; width?: number }) {
  return (
    <div className="relative overflow-hidden border border-border bg-bg/75 px-2 py-1.5" style={slashClip}>
      <div className="absolute bottom-0 left-0 h-1 bg-amber/75" style={{ width: `${Math.max(6, Math.min(100, width))}%` }} />
      <div className="flex items-center justify-between gap-3"><span className="text-[9px] font-black uppercase tracking-wide text-text-muted">{label}</span><span className={`text-xs font-black ${tone}`}>{value}</span></div>
    </div>
  );
}

/** One affix, printed by its display text — never a bare count. */
export function AffixLine({ affix }: { affix: Affix }) {
  return <div className="border border-amber/35 bg-amber/10 p-2 text-xs font-bold text-amber" style={slashClip}>{affix.displayText}</div>;
}

/** One weapon part with its labeled modifier lines. */
export function PartLine({ part }: { part: WeaponPart }) {
  return (
    <div className="border border-border bg-bg/70 p-2" style={slashClip}>
      <div className="text-[10px] font-black text-text-primary">{part.slot}</div>
      <div className="mt-1 text-[9px] text-text-muted">{Object.entries(part.modifier).map(([k, v]) => `${partStatLabel(k)} ${typeof v === 'number' ? v.toFixed(2) : v}`).join(' · ') || 'Visual part'}</div>
    </div>
  );
}

/** Legendary effect name AND description, when the item carries one. */
export function LegendaryEffectBlock({ item }: { item: GearItem }) {
  const effect = legendaryEffectOf(item);
  if (!effect) return null;
  return (
    <div>
      <div className="text-sm font-black text-amber">{effect.name}</div>
      {effect.description && <div className="mt-1 text-xs leading-snug text-text-secondary">{effect.description}</div>}
    </div>
  );
}

function DeckSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="mb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-amber">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

/**
 * The item's FULL stat deck — the same truth the inspect sheet
 * shows, composed from the shared pieces: DPS through the unified
 * chain, damage/speed/crit chance/crit multiplier/boss mod,
 * element + manufacturer + roll quality on weapons, every affix by
 * its display text, the legendary effect's name and description,
 * full shield lines, class-mod skill bonuses by name, and the
 * ordnance effect. Effective/resulting values print as the bold
 * hero of each `StatLine`.
 */
export function ItemStatDeck({ item }: { item: GearItem }) {
  const boss = useBossRelativeDps(item);
  const rows = statRows(item, boss?.dps, boss?.bossName);
  const maxRow = Math.max(1, ...rows.map(([, value]) => (typeof value === 'number' ? value : 0)));
  const affixes = affixesOf(item);
  const legendary = legendaryEffectOf(item);
  return (
    <div data-testid="item-stat-deck">
      {isWeapon(item) && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <StatLine label="Roll" value={`${item.rollQuality} ${rollQualityLabel(item.rollQuality)}`} tone="text-amber" width={item.rollQuality} />
          <StatLine label="Maker" value={item.manufacturer} width={55} />
          <StatLine label="Element" value={item.element} tone="text-cyan" width={55} />
        </div>
      )}
      <DeckSection title="Stat Poster">
        {rows.map(([label, value, tone, width]) => <StatLine key={`${label}-${value}`} label={label} value={value} tone={tone} width={width ? (width / maxRow) * 100 : 38} />)}
      </DeckSection>
      {isWeapon(item) && item.parts.length > 0 && (
        <DeckSection title="Roll Parts">
          {item.parts.map((part) => <PartLine key={part.slot} part={part} />)}
        </DeckSection>
      )}
      {isClassMod(item) && Object.keys(item.nodeBoosts).length > 0 && (
        <DeckSection title="Skill Node Boosts">
          {Object.entries(item.nodeBoosts).map(([node, boost]) => <StatLine key={node} label={skillNodeName(node)} value={`+${boost}`} tone="text-purple" width={boost * 18} />)}
        </DeckSection>
      )}
      {affixes.length > 0 && (
        <DeckSection title={`Affixes (${affixes.length})`}>
          {affixes.map((affix) => <AffixLine key={affix.id} affix={affix} />)}
        </DeckSection>
      )}
      {legendary && (
        <DeckSection title="Legendary Effect">
          <LegendaryEffectBlock item={item} />
        </DeckSection>
      )}
    </div>
  );
}
