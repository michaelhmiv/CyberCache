import React, { useCallback, useEffect, useState } from 'react';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  getCacheRankState,
  newCacheRankNonce,
  spendCacheRankBonus,
} from '@/lib/chef/chefClient';
import {
  formatCacheRankPct,
  type CacheRankStateView,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import { usePlayerStore } from '@/store';

/**
 * Cache Rank panel (Profile) — the Badass-rank analogue (0031).
 *
 * Tokens come from LEVELS only (1 per level + milestone bundles at
 * 10/25/50/75/100), granted server-side from the server's own level
 * record; this panel only renders the Chef's state view and sends
 * spend intent (a nonce + a bonus id). The balance, ranks, and
 * effects it shows are the server's — after a spend it re-renders
 * from the spend response's state and syncs the player store from
 * the same server values. Renders nothing until the Chef answers,
 * so an unreachable Chef simply omits the panel.
 */
export const CacheRankPanel: React.FC = () => {
  const [state, setState] = useState<CacheRankStateView | null>(null);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyState = useCallback((next: CacheRankStateView) => {
    setState(next);
    const spends: Record<string, number> = {};
    for (const track of next.tracks) spends[track.id] = track.ranks;
    usePlayerStore.getState().syncFromServer({
      cacheRankTokens: next.tokens,
      cacheRankSpends: spends,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCacheRankState()
      .then((result) => {
        if (!cancelled) applyState(result.cacheRank);
      })
      .catch(() => {
        // Chef unreachable: the panel stays hidden (Profile renders
        // the rest from its own services).
      });
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  const spend = useCallback(
    async (track: CacheRankTrackView) => {
      if (busyTrack || track.maxed || track.nextCost === null || !state || state.tokens < track.nextCost) {
        return;
      }
      setBusyTrack(track.id);
      setError(null);
      try {
        const result = await spendCacheRankBonus({ nonce: newCacheRankNonce(), bonusId: track.id });
        if (result.cacheRank) {
          applyState(result.cacheRank);
        } else {
          const fresh = await getCacheRankState();
          applyState(fresh.cacheRank);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Spend failed');
      } finally {
        setBusyTrack(null);
      }
    },
    [applyState, busyTrack, state],
  );

  if (!state) return null;

  const progressPct =
    state.xpForLevel > 0 ? Math.min(100, Math.round((state.xpIntoLevel / state.xpForLevel) * 100)) : 100;

  return (
    <MobileCard className="space-y-3" rarityColor="#F2C063" glow={state.tokens > 0}>
      <div className="flex items-center gap-2">
        <span className="font-black" style={{ fontSize: '16px', color: '#F2C063' }}>⬢</span>
        <div className="text-xs font-black uppercase tracking-wide text-text-primary">Cache Rank</div>
        <div className="ml-auto flex items-baseline gap-1">
          <span className="text-lg font-black" style={{ color: '#F2C063' }}>{state.tokens}</span>
          <span className="text-[10px] font-bold uppercase text-text-muted">
            {state.tokens === 1 ? 'token' : 'tokens'}
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-text-muted">
          <span>
            {state.nextTokenLevel
              ? `Next token at Lv ${state.nextTokenLevel}`
              : 'Level cap reached — every token earned'}
          </span>
          <span>
            Lv {state.level} · {state.tokensEarned} earned
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded bg-black/40">
          <div
            className="h-full rounded"
            style={{ width: `${progressPct}%`, backgroundColor: '#F2C063' }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {state.milestones.map((m) => (
          <span
            key={m.level}
            className="rounded px-1.5 py-0.5 text-[10px] font-black"
            style={{
              backgroundColor: m.claimed ? '#F2C063' : 'rgba(255,255,255,0.06)',
              color: m.claimed ? '#1A1206' : '#9CA3AF',
            }}
          >
            Lv {m.level} · +{m.bundle}
          </span>
        ))}
      </div>

      <div className="space-y-2">
        {state.tracks.map((track) => {
          const affordable = track.nextCost !== null && state.tokens >= track.nextCost;
          return (
            <div
              key={track.id}
              className="bl-card flex items-center gap-3 p-2.5"
              style={{ borderLeftColor: track.color, borderLeftWidth: 5 }}
            >
              <div
                className="bl-icon-plate flex h-9 w-9 shrink-0 items-center justify-center font-black"
                style={{ backgroundColor: `${track.color}18`, color: track.color, fontSize: '16px' }}
              >
                {track.glyph}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-black uppercase tracking-wide text-text-primary">
                    {track.name}
                  </span>
                  <span className="text-xs font-black" style={{ color: track.color }}>
                    {track.effect > 0 ? formatCacheRankPct(track.effect) : '—'}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {formatCacheRankPct(track.perRank)}/rank
                  </span>
                </div>
                <div className="truncate text-[10px] text-text-muted">{track.summary}</div>
                <div className="mt-1 flex gap-0.5" aria-label={`${track.ranks} of ${track.maxRanks} ranks`}>
                  {Array.from({ length: track.maxRanks }, (_, i) => (
                    <span
                      key={i}
                      className="inline-block h-1.5 w-3 rounded-sm"
                      style={{ backgroundColor: i < track.ranks ? track.color : 'rgba(255,255,255,0.12)' }}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={() => void spend(track)}
                disabled={track.maxed || !affordable || busyTrack !== null}
                className="shrink-0 rounded px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide transition-transform active:scale-95 disabled:opacity-40"
                style={{
                  backgroundColor: track.maxed ? 'rgba(255,255,255,0.08)' : '#F2C063',
                  color: track.maxed ? '#9CA3AF' : '#1A1206',
                }}
              >
                {track.maxed
                  ? 'Max'
                  : busyTrack === track.id
                    ? '…'
                    : `⬢ ${track.nextCost}`}
              </button>
            </div>
          );
        })}
      </div>

      {error && <div className="text-[11px] font-bold text-red">{error}</div>}
      <div className="text-[10px] text-text-muted">
        Tokens come from levels only — one per level, plus bundles at the milestones above. Ranks are
        permanent and there is no respec: bonuses are tiny and broad by design.
      </div>
    </MobileCard>
  );
};
