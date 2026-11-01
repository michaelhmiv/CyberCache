import React, { useEffect, useState } from 'react';
import { MANUFACTURERS } from '@/constants/manufacturers';
import type { Manufacturer } from '@/types/game';
import type { GearItem } from '@/types/items';
import {
  getStandingState,
  newStandingTurnInNonce,
  turnInItem,
} from '@/lib/chef/chefClient';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import {
  isStandingManufacturer,
  resolveStandingLevers,
  standingTurnInAward,
  type StandingStateView,
} from '@/content/manufacturerStanding';
import { salvageScrap } from '@/lib/skills/salvageBonuses';
import { legendaryCoreYieldFor } from '@/content/collections';

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };
const slashClip = { clipPath: 'polygon(9px 0,100% 0,calc(100% - 9px) 100%,0 100%)' };

/**
 * Turn-in row on the gear inspect sheet (Manufacturer Standing,
 * 0043) — sits beside the Salvage Forecast with the two payouts side
 * by side BEFORE commit: salvage pays scrap (+ materials, + cores
 * for a Legendary); a turn-in destroys the item for standing only —
 * no scrap, no materials, no cores, ever. The op is the server's
 * (cc_turn_in_item re-derives eligibility + award under the row
 * lock); this panel sends an item id + nonce and renders the
 * confirmed award. Two-step arm/confirm because the item is gone
 * either way once tapped through.
 */
export const TurnInPanel: React.FC<{
  item: GearItem;
  equipped: boolean;
  onDone?: () => void;
}> = ({ item, equipped, onDone }) => {
  const rec = item as unknown as Record<string, unknown>;
  const manufacturer = typeof rec.manufacturer === 'string' ? rec.manufacturer : null;
  const [view, setView] = useState<StandingStateView | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStandingState()
      .then((result) => {
        if (!cancelled) setView(result.standing);
      })
      .catch(() => {
        // Chef unreachable: the row shows values without rank state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isStandingManufacturer(manufacturer)) return null;
  const def = MANUFACTURERS[manufacturer as Manufacturer];
  const levers = resolveStandingLevers();
  const legendaryEffectId = typeof rec.legendaryEffectId === 'string' ? rec.legendaryEffectId : null;
  const scrapValue =
    salvageScrap(item.rarity, item.level) * (legendaryEffectId === 'market_crash' ? 4 : 1);
  const award = standingTurnInAward(
    { rarity: item.rarity, itemLevel: item.level, legendaryEffectId },
    levers.standingScrapDivisor,
  );
  const cores = legendaryCoreYieldFor(rec);
  const mine = view?.manufacturers.find((m) => m.manufacturer === manufacturer);
  const guest = view ? view.isGuest || !view.canUsePlayerEconomy : false;
  const maxed = (mine?.rank ?? 0) >= 5;
  const blockedReason = equipped
    ? 'Unequip this item before turning it in.'
    : item.isLocked
      ? 'Locked gear cannot be turned in.'
      : guest
        ? 'Guests cannot turn in gear — link Google sign-in first.'
        : maxed
          ? `Already at maximum rank with ${def.name}.`
          : null;

  const commit = async () => {
    if (busy || blockedReason) return;
    setBusy(true);
    setError(null);
    try {
      const result = await turnInItem({ nonce: newStandingTurnInNonce(), itemId: item.id });
      syncVerifiedResult(result as unknown as Record<string, unknown>);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Turn-in failed');
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <section
      className="relative mt-3 overflow-hidden border-2 border-border bg-surface/95 p-3 shadow-[5px_5px_0_rgba(0,0,0,0.42)]"
      style={panelClip}
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em]">
        <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: def.color }} />
        <span style={{ color: def.color }}>Turn in to {def.name}</span>
      </div>
      <div className="space-y-1.5">
        <div className="border border-border bg-bg/70 p-2 text-[10px] text-text-muted" style={slashClip}>
          Salvage pays <span className="font-black text-text-primary">{scrapValue.toLocaleString()} scrap</span>
          {cores > 0 ? (
            <>
              {' '}+ <span className="font-black text-text-primary">{cores} legendary core{cores === 1 ? '' : 's'}</span>
            </>
          ) : null}
          . Turning in destroys the item for{' '}
          <span className="font-black" style={{ color: def.color }}>
            +{award} {def.name} standing
          </span>{' '}
          — no scrap, no materials, no cores.
        </div>
        {mine && (
          <div className="text-[10px] text-text-muted">
            Your standing with {def.name}: {mine.standing.toLocaleString()} · Rank {mine.rank}
            {mine.rankTitle ? ` — “${mine.rankTitle}”` : ''}
          </div>
        )}
        {blockedReason ? (
          <div className="border border-border bg-bg/70 p-2 text-[10px] font-bold text-text-secondary" style={slashClip}>
            {blockedReason}
          </div>
        ) : armed ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void commit()}
              className="flex-1 py-2 text-xs font-black disabled:opacity-40"
              style={{ backgroundColor: def.color, color: '#0B0B0F', ...slashClip }}
            >
              {busy ? 'Turning in…' : `Confirm — destroy for +${award} standing`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setArmed(false)}
              className="bl-secondary px-3 py-2 text-xs font-black disabled:opacity-40"
              style={slashClip}
            >
              Keep it
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="w-full py-2 text-xs font-black"
            style={{ backgroundColor: def.color, color: '#0B0B0F', ...slashClip }}
          >
            Turn in to {def.name} • +{award} standing
          </button>
        )}
        {error && <div className="text-[10px] font-bold text-red">{error}</div>}
      </div>
    </section>
  );
};
