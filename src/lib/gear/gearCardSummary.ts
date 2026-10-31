/**
 * gearCardSummary — shared gear stat computation.
 *
 * Extracted from GearHub.tsx so SlotGearPicker, MarketScreen, and any other
 * list view can show decision-relevant stats (DPS, HP, affixes) instead of
 * identity-only tags or placeholder text.
 */
import { RARITIES } from '@/constants/rarities';
import {
  SHIELD_BEHAVIORS,
  shieldBehaviorOf,
} from '@/lib/combat/shieldBehaviors';
import type { GearItem, Weapon, Shield, ClassMod, Relic, Ordnance, Affix } from '@/types/items';

// ── Type Guards ──────────────────────────────────────────────────────────────

export const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
export const isShield = (item: GearItem): item is Shield =>
  'hp' in item && !isWeapon(item);
export const isClassMod = (item: GearItem): item is ClassMod =>
  'treeBonus' in item;
export const isOrdnance = (item: GearItem): item is Ordnance =>
  'effect' in item && 'damage' in item && !isWeapon(item);
export const isRelic = (item: GearItem): item is Relic =>
  !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);

// ── Helpers ──────────────────────────────────────────────────────────────────

export const colorOf = (item: GearItem) =>
  RARITIES[item.rarity]?.color ?? '#F5B544';

export const affixesOf = (item: GearItem): Affix[] =>
  'affixes' in item && Array.isArray(item.affixes) ? item.affixes : [];

const formatNumber = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString() : '0';

const formatPct = (value: number): string => `${Math.round(value * 100)}%`;

const formatSignedPct = (value: number): string =>
  `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;

function readNumber(item: GearItem, key: string): number {
  const value = (item as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function sumNodeBoosts(item: GearItem): number {
  if (!isClassMod(item)) return 0;
  return Object.values(item.nodeBoosts).reduce((sum, value) => sum + value, 0);
}

export function topActivityModule(
  item: GearItem,
): { label: string; value: number } | null {
  const activityAffix = affixesOf(item).find(
    (affix) => affix.category === 'activity' && affix.subStats,
  );
  if (!activityAffix?.subStats) return null;

  const entries = Object.entries(activityAffix.subStats).filter(
    ([, value]) => typeof value === 'number',
  );
  if (entries.length === 0) return null;

  const [, bestValue] = entries.reduce((best, entry) =>
    Math.abs(entry[1]) > Math.abs(best[1]) ? entry : best,
  entries[0]);
  const parts = activityAffix.displayText.split(' · ');
  const moduleName =
    parts[0]?.replace(/\s*\[\d+%\]/, '').replace(' Module', '') || 'Activity';
  const primaryText =
    parts[1] || `${formatSignedPct(bestValue)} activity`;
  return {
    label: `${moduleName}: ${primaryText}`,
    value: entries.reduce((sum, [, value]) => sum + Math.abs(value), 0),
  };
}

export function affixValue(item: GearItem, statKeys: string[]): number {
  const keySet = new Set(statKeys);
  let total = statKeys.reduce((sum, key) => sum + readNumber(item, key), 0);
  for (const affix of affixesOf(item)) {
    if (keySet.has(String(affix.stat)) && typeof affix.value === 'number')
      total += affix.value;
    if (affix.subStats) {
      for (const [key, value] of Object.entries(affix.subStats)) {
        if (keySet.has(key) && typeof value === 'number') total += value;
      }
    }
  }
  return total;
}

function bestAffixText(item: GearItem): string | null {
  const activity = topActivityModule(item);
  if (activity) return activity.label;
  const affix = affixesOf(item)[0];
  if (!affix) return null;
  return affix.displayText.split(' · ')[0] || affix.displayText;
}

// ── CardStat & GearCardSummary ───────────────────────────────────────────────

export interface CardStat {
  label: string;
  value: string;
  tone?: string;
}

export interface GearCardSummary {
  meta: string[];
  primaryStats: CardStat[];
  secondaryStats: CardStat[];
  badges: string[];
}

// ── gearCardSummary ──────────────────────────────────────────────────────────

export function gearCardSummary(item: GearItem): GearCardSummary {
  const activity = topActivityModule(item);

  if (isWeapon(item)) {
    return {
      meta: [
        item.rarity,
        `Lv.${item.level}`,
        item.weaponType,
        item.element,
        item.manufacturer,
      ],
      primaryStats: [
        { label: 'DPS', value: formatNumber(item.combatPower), tone: 'text-red' },
        { label: 'Boss', value: formatNumber(item.bossPower), tone: 'text-amber' },
        { label: 'Farm', value: formatNumber(item.farmPower), tone: 'text-green' },
      ],
      secondaryStats: [
        { label: 'Roll', value: String(item.rollQuality), tone: 'text-amber' },
        { label: 'Crit', value: formatPct(item.critChance), tone: 'text-cyan' },
        item.economyScore !== 0
          ? {
              label: 'Econ',
              value: `${item.economyScore >= 0 ? '+' : ''}${item.economyScore}`,
              tone: 'text-green',
            }
          : {
              label: 'DMG',
              value: formatNumber(item.baseDamage),
              tone: 'text-text-secondary',
            },
      ],
      badges: [
        ...(activity ? [activity.label] : []),
        ...(item.legendaryEffectId ? ['Legendary effect'] : []),
      ],
    };
  }

  if (isShield(item)) {
    // Behavior (Phase 2c): visible on the card — name in the stats and
    // a badge for non-Standard behaviors. Legacy shields read Standard.
    const behavior = shieldBehaviorOf(item);
    return {
      meta: [item.rarity, `Lv.${item.level}`, 'Shield', item.element],
      primaryStats: [
        { label: 'HP', value: formatNumber(item.hp), tone: 'text-cyan' },
        { label: 'Mit', value: formatPct(item.mitigation), tone: 'text-green' },
        {
          label: 'Rech',
          value: `${formatNumber(item.rechargeRate)}/s`,
          tone: 'text-amber',
        },
      ],
      secondaryStats: [
        {
          label: 'Behavior',
          value: SHIELD_BEHAVIORS[behavior].name,
          tone: 'text-amber',
        },
        {
          label: 'Affix',
          value: String(item.affixes.length),
          tone: 'text-text-secondary',
        },
        { label: 'Source', value: item.sourceTag, tone: 'text-text-secondary' },
      ],
      badges: [
        ...(activity ? [activity.label] : []),
        ...(behavior !== 'standard' ? [SHIELD_BEHAVIORS[behavior].name] : []),
      ],
    };
  }

  if (isOrdnance(item)) {
    return {
      meta: [item.rarity, `Lv.${item.level}`, 'Ordnance', item.element],
      primaryStats: [
        { label: 'DMG', value: formatNumber(item.damage), tone: 'text-red' },
        {
          label: 'Shield',
          value: formatNumber(item.shieldDamage),
          tone: 'text-cyan',
        },
        {
          label: 'Armor',
          value: formatNumber(item.armorDamage),
          tone: 'text-purple',
        },
      ],
      secondaryStats: [
        {
          label: 'Effect',
          value: item.effect.split(':')[0],
          tone: 'text-amber',
        },
        {
          label: 'Affix',
          value: String(item.affixes.length),
          tone: 'text-text-secondary',
        },
      ],
      badges: activity ? [activity.label] : [item.effect],
    };
  }

  if (isClassMod(item)) {
    return {
      meta: [item.rarity, `Lv.${item.level}`, 'Class Mod', item.treeBonus],
      primaryStats: [
        { label: 'Tree', value: item.treeBonus, tone: 'text-purple' },
        {
          label: 'Nodes',
          value: String(Object.keys(item.nodeBoosts).length),
          tone: 'text-cyan',
        },
        {
          label: 'Boost',
          value: `+${sumNodeBoosts(item)}`,
          tone: 'text-amber',
        },
      ],
      secondaryStats: [
        {
          label: 'Affix',
          value: String(item.affixes.length),
          tone: 'text-text-secondary',
        },
        { label: 'Source', value: item.sourceTag, tone: 'text-text-secondary' },
      ],
      badges: activity ? [activity.label] : [],
    };
  }

  // Relic (fallthrough)
  const firstUseful = bestAffixText(item);
  return {
    meta: [item.rarity, `Lv.${item.level}`, 'Relic', item.sourceTag],
    primaryStats: [
      {
        label: 'Affix',
        value: String(item.affixes.length),
        tone: 'text-amber',
      },
      {
        label: 'Idle',
        value: `${Math.round(
          affixValue(item, [
            'offlineEarningsMod',
            'offlineScrapMod',
            'offlineXpMod',
          ]) * 100,
        )}`,
        tone: 'text-green',
      },
      {
        label: 'Drop',
        value: `${Math.round(
          affixValue(item, ['rareDropChanceMod', 'cacheKeyChanceMod']) * 100,
        )}`,
        tone: 'text-cyan',
      },
    ],
    secondaryStats: [
      {
        label: 'Scrap',
        value: `${Math.round(
          affixValue(item, ['scrapYieldMod', 'salvageYield']) * 100,
        )}`,
        tone: 'text-orange',
      },
      { label: 'Source', value: item.sourceTag, tone: 'text-text-secondary' },
    ],
    badges: firstUseful ? [firstUseful] : [],
  };
}
