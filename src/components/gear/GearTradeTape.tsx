/**
 * GearTradeTape — "The Trade" in the inspect sheet: what swapping
 * the inspected item into its slot does to the whole build.
 *
 * The sheet is the decision surface (Gear's equip decision, the
 * Market's buy decision — both render this same sheet), so the
 * build-layer consequence lives here and only here: the comparison
 * (buildSwapComparison) runs the stat summary twice, memoized per
 * opened sheet. List and picker rows NEVER run it — they keep the
 * O(item) GearCompare strip (gear-freeze rule, pinned by test).
 *
 * Presentation (DESIGN.md §9 numbers-emphasis, equip-comparison
 * memo §3): changed lines only, grouped You gain / You give up;
 * the RESULTING value is the hero, the signed delta rides beside
 * it; non-numeric consequences (legendary effects with their
 * descriptions, affixes, skill-node boosts, action-skill
 * qualifications) print as first-class lines; an honest
 * "No build change" when nothing moves. Weapon candidates price
 * against the slot the equip flow would fill first (primary, else
 * the first occupied weapon slot — the MarketScreen strip's
 * convention), and the header names the equipped piece so the
 * baseline is never a guess. Boss context rides in from the
 * sheet's selected boss, exactly like its own DPS row.
 */
import React, { useMemo } from 'react';
import { useStatSummaryAssemblyState } from '@/hooks/useCharacterStatSummary';
import { assembleStatSummaryInput, type StatSummaryAssemblyState, type StatSummarySlot } from '@/lib/stats/assembleStatSummaryInput';
import { buildSwapComparison, type SwapComparison, type TradeLine } from '@/lib/stats/buildSwapComparison';
import { classModBoostsOf } from '@/lib/skills/skillBonuses';
import { qualifiedActionSkillTrees } from '@/content/actionSkills';
import type { BossDef } from '@/types/boss';
import type { ClassMod, GearItem } from '@/types/items';
import { Tape } from './Tape';

const WEAPON_SLOTS: StatSummarySlot[] = ['primary', 'secondary', 'heavy'];
const isWeaponItem = (item: GearItem) => 'weaponType' in item;
const isClassModItem = (item: GearItem): item is ClassMod => 'treeBonus' in item;
const isShieldItem = (item: GearItem) => 'hp' in item && !isWeaponItem(item);
const isOrdnanceItem = (item: GearItem) => 'damage' in item && 'effect' in item && !isWeaponItem(item);

/**
 * The slot the candidate would trade against, and the item
 * currently holding it. Returns null when the candidate IS the
 * equipped piece — there is no trade against yourself.
 */
function resolveTradeSlot(
  state: StatSummaryAssemblyState,
  candidate: GearItem,
): { slot: StatSummarySlot; currentItem: GearItem | undefined } | null {
  if (isWeaponItem(candidate)) {
    const equippedIdx = state.weapons.findIndex((w) => w?.id === candidate.id);
    if (equippedIdx >= 0) return null;
    const targetIdx = state.weapons[0] ? 0 : Math.max(0, state.weapons.findIndex((w) => !!w));
    return { slot: WEAPON_SLOTS[targetIdx], currentItem: state.weapons[targetIdx] };
  }
  if (isShieldItem(candidate)) {
    return state.shield?.id === candidate.id ? null : { slot: 'shield', currentItem: state.shield };
  }
  if (isClassModItem(candidate)) {
    return state.classMod?.id === candidate.id ? null : { slot: 'classMod', currentItem: state.classMod };
  }
  if (isOrdnanceItem(candidate)) {
    return state.ordnance?.id === candidate.id ? null : { slot: 'ordnance', currentItem: state.ordnance };
  }
  // Relic — the remaining gear kind.
  return state.relic?.id === candidate.id ? null : { slot: 'relic', currentItem: state.relic };
}

function TradeLineRow({ line }: { line: TradeLine }) {
  if (line.kind === 'metric') {
    return (
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-black uppercase tracking-wide text-text-muted">{line.label}</span>
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-black text-text-primary">{line.hero}</span>
          <span className={`text-[11px] font-black ${line.tone === 'gain' ? 'text-green' : 'text-red'}`}>{line.delta}</span>
        </span>
      </div>
    );
  }
  const toneClass = line.tone === 'gain' ? 'text-green' : line.tone === 'loss' ? 'text-red' : 'text-text-muted';
  return (
    <div className="flex items-baseline gap-2">
      <span className={`shrink-0 text-[11px] font-black uppercase tracking-wide ${toneClass}`}>{line.label}</span>
      <span className="text-xs font-bold text-text-primary">{line.text}</span>
    </div>
  );
}

export function GearTradeTape({ candidate, boss }: { candidate: GearItem; boss?: BossDef | null }) {
  const state = useStatSummaryAssemblyState(boss);
  const [w0, w1, w2] = state.weapons;
  // Buff expiries are the only clock-driven input; key the memo on
  // their values so the state hook's 1-second tick does not
  // recompute the trade while the sheet sits open.
  const buffKey = state.activeBuffs.map((buff) => buff.expiresAt).join(',');

  const trade = useMemo((): { comparison: SwapComparison; currentItem: GearItem | undefined } | null => {
    const resolved = resolveTradeSlot(state, candidate);
    if (!resolved) return null;
    const { slot, currentItem } = resolved;
    const currentInput = assembleStatSummaryInput(state);
    const candidateInput = assembleStatSummaryInput(state, { slot, item: candidate });
    const candidateBoosts = slot === 'classMod' ? classModBoostsOf(candidate as ClassMod) : state.classModBoosts;
    return {
      currentItem,
      comparison: buildSwapComparison(currentInput, candidateInput, {
        currentItem,
        candidateItem: candidate,
        spent: state.spent,
        currentQualified: qualifiedActionSkillTrees(state.spent, state.classModBoosts),
        candidateQualified: qualifiedActionSkillTrees(state.spent, candidateBoosts),
      }),
    };
    // Value-level deps: `state` re-identifies every second via its
    // buff clock; every value that prices the trade is listed, so
    // the memo only breaks when the trade itself could change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate, w0, w1, w2, state.shield, state.classMod, state.relic, state.ordnance, state.player, state.spent, state.classModBoosts, state.boss, state.medKitBuffer, buffKey]);

  if (!trade) return null;
  const { comparison, currentItem } = trade;

  return (
    <Tape title="The Trade" px="chevs">
      <div className="mb-2 text-[11px] font-bold text-text-muted">
        {currentItem ? `If you equip this instead of ${currentItem.name}:` : 'Empty slot — everything below is new.'}
      </div>
      {comparison.gains.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-green">You gain</div>
          <div className="space-y-1.5">
            {comparison.gains.map((line, i) => <TradeLineRow key={`g-${line.label}-${i}`} line={line} />)}
          </div>
        </div>
      )}
      {comparison.losses.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-[11px] font-black uppercase tracking-wide text-red">You give up</div>
          <div className="space-y-1.5">
            {comparison.losses.map((line, i) => <TradeLineRow key={`l-${line.label}-${i}`} line={line} />)}
          </div>
        </div>
      )}
      {!comparison.hasBuildChange && (
        <div className="text-xs font-bold text-text-muted">No build change — the trade is in the item&apos;s own numbers above.</div>
      )}
      {comparison.neutrals.length > 0 && (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          {comparison.neutrals.map((line, i) => <TradeLineRow key={`n-${line.label}-${i}`} line={line} />)}
        </div>
      )}
    </Tape>
  );
}
