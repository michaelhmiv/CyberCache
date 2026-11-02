import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import { useInventoryStore, useLoadoutStore } from '@/store';
import {
  getStandingState,
  newStandingBuyNonce,
  newStandingOrderNonce,
  newStandingRankUpNonce,
  newStandingTurnInNonce,
  rankUpManufacturer,
  standingBuy,
  standingOrder,
  turnInItem,
} from '@/lib/chef/chefClient';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import {
  rarityMeetsMinimum,
  resolveStandingLevers,
  standingTurnInAward,
  type StandingManufacturerView,
  type StandingStateView,
} from '@/content/manufacturerStanding';
import { salvageScrap } from '@/lib/skills/salvageBonuses';
import { legendaryCoreYieldFor } from '@/content/collections';
import type { GearItem } from '@/types/items';

/**
 * Rep Desk (Vendor) — Manufacturer Standing (0043).
 *
 * Six independent ladders, one card per manufacturer. The panel only
 * renders the Chef's state view and sends intent (a nonce + an item
 * id / manufacturer / offer key); awards, thresholds, tributes,
 * prices, and cadence are the server's records. It renders nothing
 * until the Chef answers, so an unreachable Chef simply omits the
 * desk. Guests see the desk read-only — every op refuses
 * server-side until the account is verified.
 *
 * Standing is reputation only: the copy promises access and
 * cosmetics (shelf stock, an exclusive recipe, rig colors, parts
 * crates, signature orders) and never power.
 */
export const RepDeskPanel: React.FC = () => {
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const [view, setView] = useState<StandingStateView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; error: boolean } | null>(null);
  const [tributePick, setTributePick] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const result = await getStandingState();
    setView(result.standing);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getStandingState()
      .then((result) => {
        if (!cancelled) setView(result.standing);
      })
      .catch(() => {
        // Chef unreachable: the desk stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const equippedIds = useMemo(
    () => new Set(Object.values(loadout.slots).filter((id): id is string => Boolean(id))),
    [loadout.slots],
  );

  /** Available, unlocked, unequipped gear of one manufacturer. */
  const eligibleItems = useCallback(
    (manufacturer: string): GearItem[] =>
      inventory.items.filter((item) => {
        const rec = item as unknown as Record<string, unknown>;
        return rec.manufacturer === manufacturer && !item.isLocked && !equippedIds.has(item.id);
      }),
    [inventory.items, equippedIds],
  );

  const run = useCallback(
    async (key: string, op: () => Promise<{ standing: StandingStateView | null }>, done: (r: never) => string) => {
      if (busy) return;
      setBusy(key);
      setFlash(null);
      try {
        const result = await op();
        if (result.standing) setView(result.standing);
        else await refresh();
        syncVerifiedResult(result as unknown as Record<string, unknown>);
        setFlash({ text: done(result as never), error: false });
      } catch (err) {
        setFlash({ text: err instanceof Error ? err.message : 'Rep Desk op failed', error: true });
      } finally {
        setBusy(null);
      }
    },
    [busy, refresh],
  );

  if (!view) return null;
  const levers = resolveStandingLevers();
  const guest = view.isGuest || !view.canUsePlayerEconomy;

  const itemFacts = (item: GearItem) => {
    const rec = item as unknown as Record<string, unknown>;
    const legendaryEffectId = typeof rec.legendaryEffectId === 'string' ? rec.legendaryEffectId : null;
    const scrapValue =
      salvageScrap(item.rarity, item.level) * (legendaryEffectId === 'market_crash' ? 4 : 1);
    const standingValue = standingTurnInAward(
      { rarity: item.rarity, itemLevel: item.level, legendaryEffectId },
      levers.standingScrapDivisor,
    );
    const cores = legendaryCoreYieldFor(item as unknown as Record<string, unknown>);
    return { scrapValue, standingValue, cores };
  };

  const renderManufacturer = (m: StandingManufacturerView) => {
    const eligible = eligibleItems(m.manufacturer);
    const tributeChoices = m.nextRank?.tributeMinRarity
      ? eligible.filter((item) => rarityMeetsMinimum(item.rarity, m.nextRank!.tributeMinRarity!))
      : [];
    const pickedTribute = tributePick[m.manufacturer] ?? tributeChoices[0]?.id ?? '';
    const rankUpBlocked =
      guest || !m.nextRank || !m.nextRank.thresholdMet || busy !== null ||
      (m.nextRank.tributeMinRarity != null && pickedTribute === '');
    return (
      <MobileCard key={m.manufacturer} className="space-y-3">
        {/* Header: name, titles, pips */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: m.color }} />
              <span className="text-sm font-black text-text-primary">{m.name}</span>
            </div>
            <div className="mt-0.5 text-[10px] text-text-muted">
              {m.rank === 0
                ? 'No standing yet'
                : `Rank ${m.rank} · ${m.genericTitle}${m.rankTitle ? ` — “${m.rankTitle}”` : ''}`}
            </div>
          </div>
          <div className="flex shrink-0 gap-1 pt-1" aria-label={`Rank ${m.rank} of 5`}>
            {[1, 2, 3, 4, 5].map((pip) => (
              <span
                key={pip}
                className="inline-block h-2.5 w-2.5 rounded-[3px] border"
                style={{
                  backgroundColor: pip <= m.rank ? m.color : 'transparent',
                  borderColor: m.color,
                  opacity: pip <= m.rank ? 1 : 0.45,
                }}
              />
            ))}
          </div>
        </div>

        {/* Balance + progress to next threshold */}
        <div>
          <div className="flex items-baseline justify-between text-[10px] text-text-muted">
            <span>
              <span className="text-xs font-black text-text-primary">{m.standing.toLocaleString()}</span> standing
            </span>
            {m.nextRank ? (
              <span>
                {m.nextRank.standingNeeded > 0
                  ? `${m.nextRank.standingNeeded.toLocaleString()} more to Rank ${m.nextRank.rank} (${m.nextRank.threshold.toLocaleString()})`
                  : `Rank ${m.nextRank.rank} threshold met`}
              </span>
            ) : (
              <span>Maximum rank</span>
            )}
          </div>
          {m.nextRank && (
            <div className="mt-1 h-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <div
                className="h-1.5 rounded-full"
                style={{
                  width: `${Math.min(100, Math.round((m.standing / m.nextRank.threshold) * 100))}%`,
                  backgroundColor: m.color,
                }}
              />
            </div>
          )}
        </div>

        {/* Unlocks: owned in color, locked as silhouettes with their rank */}
        <div className="space-y-1">
          {m.unlocks.map((u) => (
            <div
              key={u.id}
              className="flex items-start justify-between gap-2 rounded px-2 py-1.5"
              style={{
                backgroundColor: 'rgba(255,255,255,0.04)',
                opacity: u.state === 'owned' ? 1 : 0.55,
              }}
            >
              <div className="min-w-0">
                <div className="text-[11px] font-bold text-text-primary">
                  <span className="inline-flex items-center gap-1">{u.state === 'owned' ? <PxIcon name="check" size={13} /> : <PxIcon name="lock" size={13} />} {u.label}</span>
                </div>
                <div className="text-[10px] leading-snug text-text-muted">{u.detail}</div>
              </div>
              <span
                className="shrink-0 text-[9px] font-black uppercase"
                style={{ color: u.state === 'owned' ? m.color : undefined }}
              >
                {u.state === 'owned' ? 'Owned' : `Rank ${u.rank}`}
              </span>
            </div>
          ))}
        </div>

        {/* Rank up */}
        {m.nextRank && (
          <div className="space-y-2 rounded border border-border px-2 py-2">
            <div className="text-[11px] font-bold text-text-primary">
              Rank {m.nextRank.rank} · {m.nextRank.genericTitle} — “{m.nextRank.title}”
            </div>
            <div className="text-[10px] leading-snug text-text-muted">
              Tribute: {m.nextRank.tributeCredits.toLocaleString()}cr
              {m.nextRank.tributeMinRarity
                ? ` + one ${m.name} item of ${m.nextRank.tributeMinRarity} rarity or better (destroyed, pays no standing)`
                : ''}
              . Your standing balance is not spent.
              {!m.nextRank.thresholdMet &&
                ` Earn ${m.nextRank.standingNeeded.toLocaleString()} more standing first.`}
              {m.nextRank.thresholdMet && !m.nextRank.canAffordTribute &&
                ' You cannot afford the tribute yet.'}
            </div>
            {m.nextRank.tributeMinRarity && (
              <select
                value={pickedTribute}
                onChange={(e) => setTributePick((prev) => ({ ...prev, [m.manufacturer]: e.target.value }))}
                className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-xs text-text-primary"
                disabled={guest || busy !== null}
              >
                {tributeChoices.length === 0 ? (
                  <option value="">No eligible tribute item in your inventory</option>
                ) : (
                  tributeChoices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.rarity} · Lv {item.level}
                    </option>
                  ))
                )}
              </select>
            )}
            <button
              type="button"
              disabled={rankUpBlocked}
              onClick={() =>
                void run(
                  `rankup:${m.manufacturer}`,
                  () =>
                    rankUpManufacturer({
                      nonce: newStandingRankUpNonce(),
                      manufacturer: m.manufacturer,
                      tributeItemId: m.nextRank!.tributeMinRarity ? pickedTribute : null,
                    }),
                  (r: { rankedUp: { newRank: number; tributeCredits: number } }) =>
                    `${m.name} Rank ${r.rankedUp.newRank} granted — ${r.rankedUp.tributeCredits.toLocaleString()}cr tribute paid.`,
                )
              }
              className="w-full py-2 rounded-xl text-xs font-black disabled:opacity-40"
              style={{ backgroundColor: m.color, color: '#0B0B0F' }}
            >
              {busy === `rankup:${m.manufacturer}` ? 'Ranking up…' : `Rank up • ${m.nextRank.tributeCredits.toLocaleString()}cr`}
            </button>
          </div>
        )}

        {/* Rep Shelf + Parts Crate + Signature Order */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-text-secondary">
              <span className="font-bold text-text-primary">Rep Shelf:</span> {m.shelf.consumableType} · flat
              100% quality · always stocked
            </div>
            <button
              type="button"
              disabled={guest || !m.shelf.available || busy !== null}
              onClick={() =>
                void run(
                  `buy:${m.shelf.offerKey}`,
                  () => standingBuy({ nonce: newStandingBuyNonce(), offerKey: m.shelf.offerKey, quantity: 1 }),
                  (r: { bought: { totalPrice: number } }) =>
                    `${m.shelf.consumableType} bought from the ${m.name} shelf for ${r.bought.totalPrice.toLocaleString()}cr.`,
                )
              }
              className="shrink-0 px-3 py-1.5 rounded-lg border border-border bg-surface text-[11px] font-black text-text-primary disabled:opacity-40"
            >
              {m.shelf.available ? `Buy • ${m.shelf.priceCredits.toLocaleString()}cr` : 'Rank 1'}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-text-secondary">
              <span className="font-bold text-text-primary">Parts Crate:</span>{' '}
              {Object.entries({ ...m.crate.materials, ...m.crate.essences })
                .map(([k, v]) => `${k} ×${v}`)
                .join(', ')}{' '}
              · weekly
            </div>
            <button
              type="button"
              disabled={guest || !m.crate.available || busy !== null}
              onClick={() =>
                void run(
                  `buy:${m.crate.offerKey}`,
                  () => standingBuy({ nonce: newStandingBuyNonce(), offerKey: m.crate.offerKey, quantity: 1 }),
                  (r: { bought: { totalPrice: number } }) =>
                    `${m.name} Parts Crate claimed for ${r.bought.totalPrice.toLocaleString()}cr.`,
                )
              }
              className="shrink-0 px-3 py-1.5 rounded-lg border border-border bg-surface text-[11px] font-black text-text-primary disabled:opacity-40"
            >
              {m.crate.boughtThisWeek
                ? <span className="inline-flex items-center gap-1">Claimed <PxIcon name="check" size={13} /></span>
                : m.rank >= 4
                  ? `Claim • ${m.crate.priceCredits.toLocaleString()}cr`
                  : 'Rank 4'}
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[11px] text-text-secondary">
              <span className="font-bold text-text-primary">Signature Order:</span> a {m.name} weapon at your
              level, Rare–Epic · weekly
            </div>
            <button
              type="button"
              disabled={guest || !m.order.available || busy !== null}
              onClick={() =>
                void run(
                  `order:${m.manufacturer}`,
                  () => standingOrder({ nonce: newStandingOrderNonce(), manufacturer: m.manufacturer }),
                  (r: { ordered: { totalPrice: number } }) =>
                    `Signature Order placed — ${r.ordered.totalPrice.toLocaleString()}cr. Your weapon is in your inventory.`,
                )
              }
              className="shrink-0 px-3 py-1.5 rounded-lg border border-border bg-surface text-[11px] font-black text-text-primary disabled:opacity-40"
            >
              {!m.order.enabled
                ? 'Disabled'
                : m.order.orderedThisWeek
                  ? <span className="inline-flex items-center gap-1">Ordered <PxIcon name="check" size={13} /></span>
                  : m.rank >= 5
                    ? `Order • ${m.order.priceCredits.toLocaleString()}cr`
                    : 'Rank 5'}
            </button>
          </div>
        </div>

        {/* Turn-ins */}
        <div className="space-y-1.5">
          <div className="text-[10px] font-black uppercase text-text-secondary">
            Turn in {m.name} gear
          </div>
          {m.rank >= 5 ? (
            <div className="text-[10px] text-text-muted">
              Maximum rank reached — the desk takes no more turn-ins for {m.name}.
            </div>
          ) : eligible.length === 0 ? (
            <div className="text-[10px] text-text-muted">
              No available {m.name} gear in your inventory. Equipped and locked items stay with you.
            </div>
          ) : (
            eligible.slice(0, 6).map((item) => {
              const facts = itemFacts(item);
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)' }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-bold text-text-primary">{item.name}</div>
                    <div className="text-[10px] text-text-muted">
                      {item.rarity} • Lv {item.level} • salvage {facts.scrapValue.toLocaleString()} scrap
                      {facts.cores > 0 ? ` + ${facts.cores} cores if salvaged` : ''} → turn-in pays standing
                      only
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={guest || busy !== null}
                    onClick={() =>
                      void run(
                        `turnin:${item.id}`,
                        () => turnInItem({ nonce: newStandingTurnInNonce(), itemId: item.id }),
                        (r: { turnedIn: { standingAwarded: number; newBalance: number } }) =>
                          `${item.name} turned in: +${r.turnedIn.standingAwarded} ${m.name} standing (${r.turnedIn.newBalance.toLocaleString()} total).`,
                      )
                    }
                    className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-black disabled:opacity-40"
                    style={{ backgroundColor: m.color, color: '#0B0B0F' }}
                  >
                    Turn in • +{facts.standingValue}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </MobileCard>
    );
  };

  return (
    <div className="space-y-3">
      <div className="text-[11px] leading-snug text-text-muted">
        The makers keep score. Kills with a manufacturer&apos;s weapon drip standing for that maker (up to
        a daily cap), and turning in their gear at this desk pays its scrap value in standing. Standing
        buys access, never power: shelf stock, an exclusive recipe, rig colors, parts crates, and — at
        the top — a signature order. Each maker&apos;s ladder is its own; no maker holds another&apos;s
        grudges.
      </div>
      {guest && (
        <div className="rounded border border-border px-2 py-2 text-[11px] text-text-secondary">
          Guest desk is read-only — link Google sign-in to turn in gear, rank up, and buy from the Rep
          Desk.
        </div>
      )}
      {flash && (
        <div
          className="rounded border px-2 py-2 text-[11px]"
          style={{
            borderColor: flash.error ? '#EF4444' : '#22C55E',
            color: flash.error ? '#EF4444' : '#22C55E',
          }}
        >
          {flash.text}
        </div>
      )}
      {view.manufacturers.map(renderManufacturer)}
    </div>
  );
};
