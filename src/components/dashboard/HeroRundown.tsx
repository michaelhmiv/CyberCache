import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  useActiveBuffsStore,
  useActivityStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
} from '@/store';
import { useNow } from '@/hooks/useNow';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import {
  buildCritMetric,
  buildHeroRundown,
  buildMitigationMetric,
  buildShieldMetric,
  STAGE_TICK_SECONDS,
  type HeroStatCell,
} from '@/lib/stats/heroRundown';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import { buildEffectSummary } from '@/lib/buffs/effectSummary';
import { statToneRailClass, statToneTextClass } from '@/components/stats/statToneStyles';
import { CONSUMABLES } from '@/constants/consumables';
import { sumActivityModifier } from '@/lib/stats/activityModifiers';
import { getActivityModuleStatLabel } from '@/lib/activity/activityStatMetadata';
import { PRODUCTIVE_ACTIVITY_LABELS, type ActivityKind } from '@/types/activity';
import type { BossDef } from '@/types/boss';
import type { GearItem } from '@/types/items';
import type { StatMetric } from '@/lib/stats/characterStats';

type FocusKey = 'dps' | 'dmgTick' | 'critChance' | 'critDamage' | 'hp' | 'shield' | 'mitigation' | 'shieldBreak';

/**
 * The hero rundown (Home consolidation, owner steers 2026-11-03) —
 * the stage ribbon's replacement, attached to the stage's foot.
 *
 * The ribbon used to print the mode word ("ROAMING") beside a
 * ~15-entry sideways scroller of every effective stat. The word
 * died (the scene, the rail, and the workspace already say it)
 * and the scroller became tappable heroes. The owner's device
 * review stacked them into TWO rows at the Door type step (15px,
 * §5) — DPS · Dmg/tick · Crit % · Crit × over HP · Shield · Mit ·
 * Shield Break — trading the Poster step for four more of the
 * hunter's real numbers. (Shield and mitigation used to ride the
 * HP cell as a microline; as their own cells that printing would
 * be redundant state, so the microline is gone.)
 *
 * Effective values are the heroes (numbers-emphasis law); where
 * the model carries a true base→effective pair (DPS, HP) the
 * delta rides beside its hero AS A PERCENTAGE OF BASE — the same
 * figure the stat's breakdown sheet prints — green for gains,
 * red for losses. Stats with no base pair in the math (crit,
 * shield, mitigation, shield break) print plain; no baseline is
 * invented. Gathering rates live in the workspace panel's grid
 * now — their one printing.
 *
 * Every hero is a ≥44dp button into its SOURCE BREAKDOWN — the
 * shipped breakdown surface focused on that one metric (the
 * Hunter Totals panel's Sources job, moved behind the number it
 * explains). The full all-metrics overlay keeps its home behind
 * Hunter → Profile's "Totals & Sources" door.
 *
 * Display only: every number derives from the canonical summary
 * + snapshot (useCharacterStatSummary) and the survival mirror.
 */
export const HeroRundown: React.FC<{
  /** The boss the stage is set against (boss_fight context). */
  boss?: BossDef | null;
}> = ({ boss }) => {
  const kind = useActivityStore((s) => s.current.kind);
  const survival = useSurvivalStore();
  const playerLevel = usePlayerStore((s) => s.level);
  const shieldHp = useLoadoutStore((s) => s.getShield()?.hp ?? 0);
  const bossContext = kind === 'boss_fight';
  const { summary, snapshot, weapons } = useCharacterStatSummary(bossContext ? boss : null);
  const [focus, setFocus] = useState<FocusKey | null>(null);

  // The survival store's max-HP sync rode the Hunter Totals panel
  // until the consolidation removed it from Home; the rundown's
  // HP cell is that number's home now, so the sync lives here.
  useSyncSurvivalMaxHp(playerLevel, shieldHp);

  const model = useMemo(
    () => buildHeroRundown({
      summary,
      snapshot,
      weapons,
      survival: {
        currentHp: survival.currentHp,
        maxHp: survival.maxHp,
        shieldHp: survival.shieldHp,
        isDead: survival.isDead,
      },
      bossContext,
    }),
    [summary, snapshot, weapons, survival, bossContext],
  );

  const metricOf = (key: string): StatMetric | undefined => summary.all.find((m) => m.key === key);
  const focusMetricFor = (key: FocusKey): StatMetric | null =>
    key === 'dps' || key === 'dmgTick'
      ? metricOf('dps') ?? null
      : key === 'hp'
        ? metricOf('health') ?? null
        : key === 'critChance' || key === 'critDamage'
          ? buildCritMetric(weapons)
          : key === 'shield'
            ? buildShieldMetric(snapshot)
            : key === 'mitigation'
              ? buildMitigationMetric(snapshot)
              : metricOf('shieldBreak') ?? null;
  const focusMetric: StatMetric | null = focus ? focusMetricFor(focus) : null;
  const focusNote = focus === 'dmgTick'
    ? `Damage per tick = DPS × the ${STAGE_TICK_SECONDS}s tick — the expectation at variance 1.0 against an undefended target; the contract's roll and the target's defense resolve per hit.`
    : focus === 'critChance' || focus === 'critDamage'
      ? 'Crit\u2019s damage is already folded into the DPS figure — skill and affix crit convert into it at 0.5 weight there — so this sheet never counts it twice.'
      : focus === 'hp'
        ? `You are at ${model.hp.current.toLocaleString()} of ${model.hp.max.toLocaleString()}. The card above is what the max is made of: chassis and level, shield capacity, mitigation, and any medkit buffer. The percentage beside HP is this pool against its chassis base — the same figure this sheet prints.`
        : focus === 'shield'
          ? 'Shield capacity is the equipped shield\u2019s own number — nothing scales it in the rundown, so it prints plain, with no percentage.'
          : focus === 'mitigation'
            ? 'Mitigation is the equipped shield\u2019s own rate — it prints plain, with no percentage: there is no unmitigated base to measure it against.'
            : focus === 'shieldBreak'
              ? 'Shield Break is an additive total — weapon shield mods, ordnance, and skills stack into one number — so it prints plain: there is no single base to percentage it against.'
              : focus === 'dps' && bossContext
                ? 'Priced against the boss on the stage: the delta compares your DPS to the boss-relative weapon pool.'
                : undefined;

  const openFocus = (key: FocusKey) => {
    // A hero with no underlying metric (an unarmed hunter's DPS
    // before the summary can price one) has no breakdown to open.
    if (focusMetricFor(key)) setFocus(key);
  };

  // Hero values print at the Door step (15px, §5) in BOTH rows —
  // the two-row stack is the owner's sanctioned fit: the Poster
  // step belonged to the single-row rundown, and splitting crit
  // into its pair keeps values short. The §6.3 longest-case rule
  // still stands guard: a value + chip too long for its cell
  // steps down to the Base step (13px) rather than painting over
  // its neighbour (an endgame HP line — "12,400/12,400 +125%" —
  // is the case that bites). Tap targets stay ≥44dp: the rows
  // stack, the targets don't shrink.
  const heroButton = (cell: HeroStatCell, flexClass = 'flex-1') => {
    const glyphs = cell.display.length + (cell.delta ? cell.delta.display.length + 1 : 0);
    return (
    <button
      key={cell.key}
      type="button"
      data-testid={`hero-stat-${cell.key}`}
      onClick={() => openFocus(cell.key)}
      aria-label={`${cell.label}: ${cell.display}${cell.delta ? `, ${cell.delta.display} over base` : ''}. Open source breakdown.`}
      className={`min-h-[56px] min-w-0 ${flexClass} border-l border-border/60 px-1.5 py-1.5 text-left transition-colors first:border-l-0 hover:bg-bg/40`}
    >
      <span className="flex items-center justify-between gap-0.5">
        <span className="truncate text-[11px] font-black uppercase tracking-normal text-text-muted">{cell.label}</span>
        <PxIcon name="chevR" size={10} className="shrink-0 text-text-muted/60" />
      </span>
      <span className={`mt-0.5 block whitespace-nowrap font-black leading-tight ${glyphs > 12 ? 'text-[13px]' : 'text-[15px]'} ${statToneTextClass[cell.tone]}`}>
        {cell.display}
        {cell.delta && (
          <span className={`ml-1 align-super text-[11px] font-black ${cell.delta.tone === 'green' ? 'text-green' : 'text-red'}`}>
            {cell.delta.display}
          </span>
        )}
      </span>
    </button>
    );
  };

  return (
    <div data-testid="hero-rundown" className="relative border-2 border-t-0 border-border bg-surface/95 shadow-[0_10px_22px_rgba(0,0,0,0.45)]">
      {/* Row 1 — the damage line. Unarmed, the honest line
          carries the row alone. */}
      <div className="flex">
        {model.unarmed ? (
          <button
            type="button"
            data-testid="hero-stat-dps"
            onClick={() => openFocus('dps')}
            aria-label="DPS: no weapon equipped. Open source breakdown."
            className="min-h-[56px] min-w-0 flex-1 px-1.5 py-1.5 text-left transition-colors hover:bg-bg/40"
          >
            <span className="flex items-center justify-between gap-0.5">
              <span className="truncate text-[11px] font-black uppercase tracking-normal text-text-muted">DPS</span>
              <PxIcon name="chevR" size={10} className="shrink-0 text-text-muted/60" />
            </span>
            <span className="mt-1 block text-[15px] font-black leading-tight text-red">No weapon equipped</span>
          </button>
        ) : (
          <>
            {model.dps && heroButton(model.dps)}
            {model.dmgTick && heroButton(model.dmgTick)}
            {model.critChance && heroButton(model.critChance)}
            {model.critDamage && heroButton(model.critDamage)}
          </>
        )}
      </div>
      {/* Row 2 — the survival line; renders in full in every
          state, unarmed included. */}
      <div className="flex border-t border-border/60">
        <button
          type="button"
          data-testid="hero-stat-hp"
          onClick={() => openFocus('hp')}
          aria-label={`HP: ${model.hp.display}${model.hp.delta ? `, ${model.hp.delta.display} over base` : ''}. Open source breakdown.`}
          className="min-h-[56px] min-w-0 flex-[1.5] px-1.5 py-1.5 text-left transition-colors hover:bg-bg/40"
        >
          <span className="flex items-center justify-between gap-0.5">
            <span className="truncate text-[11px] font-black uppercase tracking-normal text-text-muted">HP</span>
            <PxIcon name="chevR" size={10} className="shrink-0 text-text-muted/60" />
          </span>
          <span className={`mt-0.5 block whitespace-nowrap font-black leading-tight ${model.hp.display.length + (model.hp.delta ? model.hp.delta.display.length + 1 : 0) > 16 ? 'text-[13px]' : 'text-[15px]'} ${statToneTextClass[model.hp.tone]}`}>
            {model.hp.display}
            {model.hp.delta && (
              <span className={`ml-1 align-super text-[11px] font-black ${model.hp.delta.tone === 'green' ? 'text-green' : 'text-red'}`}>
                {model.hp.delta.display}
              </span>
            )}
          </span>
          <span className="mt-1 block h-1 w-full bg-bg" aria-hidden>
            <span className={`block h-full ${statToneRailClass[model.hp.tone]}`} style={{ width: `${Math.round(model.hp.fraction * 100)}%` }} />
          </span>
        </button>
        {heroButton(model.shield, 'flex-[0.8]')}
        {heroButton(model.mitigation, 'flex-[0.75]')}
        {model.shieldBreak && heroButton(model.shieldBreak, 'flex-[0.95]')}
      </div>
      <HeroBuffLine activityKind={kind} />
      {focus && focusMetric && (
        <CharacterStatBreakdownModal
          summary={summary}
          open
          onClose={() => setFocus(null)}
          activityKind={kind}
          focusMetric={focusMetric}
          focusNote={focusNote}
        />
      )}
    </div>
  );
};

/**
 * The buff line — one slim line under the heroes, only while
 * something is enhancing the hunter: the active consumable buffs
 * (name, headline effect, ticks left) and the current activity's
 * gear-module modifiers, folded from the retired Activity
 * Modifiers panel (its detail rides the breakdown sheets' rows).
 * It is the deltas' legend; when nothing is active it renders
 * nothing and the heroes print plain.
 */
const HeroBuffLine: React.FC<{ activityKind: ActivityKind }> = ({ activityKind }) => {
  const buffs = useActiveBuffsStore((s) => s.buffs);
  const loadout = useLoadoutStore();
  const inventory = useInventoryStore();
  const now = useNow();

  const activeBuffs = buffs.filter((buff) => buff.expiresAt > now);
  const moduleEntries = useMemo(() => {
    const slots: Array<keyof typeof loadout.slots> = ['primary', 'secondary', 'heavy', 'shield', 'ordnance', 'relic', 'classMod'];
    const gear: GearItem[] = [];
    for (const slot of slots) {
      const itemId = loadout.slots[slot];
      if (!itemId) continue;
      const item = inventory.getById(itemId);
      if (item) gear.push(item);
    }
    return Object.entries(sumActivityModifier(gear, activityKind)).filter(([, v]) => v > 0);
  }, [loadout, inventory, activityKind]);

  if (activeBuffs.length === 0 && moduleEntries.length === 0) return null;

  const buffParts = activeBuffs.map((buff) => {
    const def = CONSUMABLES[buff.consumableId];
    const name = def?.name ?? buff.consumableId;
    const isBuffer = (buff.consumableId === 'MedKit' || buff.consumableId === 'MedKitRefined') && typeof buff.value === 'number';
    const effect = buildEffectSummary(def, buff, isBuffer)?.split(' · ')[0];
    const ticks = Math.max(1, Math.ceil((buff.expiresAt - now) / (STAGE_TICK_SECONDS * 1000)));
    return `${name}${effect ? ` ${effect}` : ''} · ${ticks} tick${ticks === 1 ? '' : 's'} left`;
  });
  const modParts = moduleEntries.slice(0, 2).map(([key, val]) => {
    const label = getActivityModuleStatLabel(activityKind, key);
    const isInteger = key === 'bulkListingSlots' || key === 'parallelQueueSlots';
    return `${label} ${isInteger ? `${Math.round(val)}` : `+${(val * 100).toFixed(0)}%`}`;
  });
  const activityLabel = PRODUCTIVE_ACTIVITY_LABELS[activityKind] ?? 'Activity';

  return (
    <div data-testid="hero-buff-line" className="border-t border-border/60 px-2 py-1 text-[11px] font-bold leading-snug text-text-muted">
      {buffParts.length > 0 && (
        <>
          <span className="font-black uppercase tracking-wide text-text-secondary">Active: </span>
          <span className="text-green">{buffParts.join(' · ')}</span>
          <span> — the deltas above include it. Tap a stat for its sources.</span>
        </>
      )}
      {modParts.length > 0 && (
        <span className={buffParts.length > 0 ? 'block' : undefined}>
          <span className="font-black uppercase tracking-wide text-text-secondary">{activityLabel} mods: </span>
          <span className="text-amber">{modParts.join(' · ')}</span>
          {buffParts.length === 0 && <span> — folded into the numbers above. Tap a stat for its sources.</span>}
        </span>
      )}
    </div>
  );
};
