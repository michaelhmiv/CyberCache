/**
 * Offline Recap — "While You Were Away" Card
 *
 * Rendered when the player logs back in and offline settlement returns
 * rewards. Shows a durable, dismissible recap of what was earned while
 * offline. Not a transient toast — persists until the user taps "Got it".
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, Zap, Coins, Wrench, Key, Gem, Package } from 'lucide-react';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function RewardRow({
  icon: Icon,
  label,
  value,
  accent = 'text-amber',
}: {
  icon: React.FC<{ className?: string; size?: number }>;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Icon className={`w-4 h-4 shrink-0 ${accent}`} size={16} />
      <span className="text-xs text-zinc-400 flex-1">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}

export function OfflineRecap() {
  const { lastSettlement, dismissed, dismiss } = useOfflineRecapStore();

  if (!lastSettlement || dismissed) return null;

  const s = lastSettlement;
  const hasRewards =
    s.rewards.creditsAwarded > 0 ||
    s.rewards.scrapAwarded > 0 ||
    s.rewards.xpAwarded > 0 ||
    s.rewards.cacheFragmentsAwarded > 0 ||
    Object.keys(s.rewards.materials).length > 0 ||
    Object.keys(s.rewards.essences).length > 0 ||
    s.items.length > 0;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 24, stiffness: 200 }}
          className="bl-card w-full max-w-sm overflow-hidden"
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-3 border-b border-amber/10">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-amber tracking-tight">
                  While You Were Away
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">{s.areaName}</p>
              </div>
              <button
                onClick={dismiss}
                className="bl-secondary p-1.5 rounded"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" size={16} />
              </button>
            </div>
          </div>

          {/* Time away & cap info */}
          <div className="px-5 py-3 space-y-1 border-b border-amber/10">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber" size={16} />
              <span className="text-sm text-zinc-300">
                Away for <span className="font-bold text-white">{s.timeAway}</span>
              </span>
              {s.capReached && (
                <span className="text-[10px] bg-amber/20 text-amber px-1.5 py-0.5 rounded font-bold">
                  CAPPED
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber/60" size={16} />
              <span className="text-xs text-zinc-500">
                {formatNumber(s.ticksSettled)} ticks settled
                {s.capReached && (
                  <span className="text-zinc-600">
                    {' '}
                    · capped at {s.capHours}h · {formatNumber(s.startTick)} → {formatNumber(s.endTick)}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Rewards */}
          {hasRewards ? (
            <div className="px-5 py-3 space-y-1">
              {s.rewards.creditsAwarded > 0 && (
                <RewardRow
                  icon={Coins}
                  label="Credits"
                  value={`+${formatNumber(s.rewards.creditsAwarded)}`}
                  accent="text-amber"
                />
              )}
              {s.rewards.scrapAwarded > 0 && (
                <RewardRow
                  icon={Wrench}
                  label="Scrap"
                  value={`+${formatNumber(s.rewards.scrapAwarded)}`}
                  accent="text-zinc-300"
                />
              )}
              {s.rewards.xpAwarded > 0 && (
                <RewardRow
                  icon={Zap}
                  label="XP"
                  value={`+${formatNumber(s.rewards.xpAwarded)}`}
                  accent="text-purple-400"
                />
              )}
              {s.rewards.cacheFragmentsAwarded > 0 && (
                <RewardRow
                  icon={Key}
                  label="Key Fragments"
                  value={`+${s.rewards.cacheFragmentsAwarded}`}
                  accent="text-cyan-400"
                />
              )}
              {Object.entries(s.rewards.materials).map(([type, count]) => (
                <RewardRow
                  key={`mat-${type}`}
                  icon={Gem}
                  label={type}
                  value={`+${count}`}
                  accent="text-blue-400"
                />
              ))}
              {Object.entries(s.rewards.essences).map(([type, count]) => (
                <RewardRow
                  key={`ess-${type}`}
                  icon={Gem}
                  label={type}
                  value={`+${count}`}
                  accent="text-pink-400"
                />
              ))}
              {s.items.length > 0 && (
                <RewardRow
                  icon={Package}
                  label="Gear Drops"
                  value={s.items.length}
                  accent="text-green-400"
                />
              )}
            </div>
          ) : (
            <div className="px-5 py-3">
              <p className="text-xs text-zinc-500 text-center">
                No offline rewards to collect this time.
              </p>
            </div>
          )}

          {/* Dismiss CTA */}
          <div className="px-5 pb-5 pt-2">
            <button
              onClick={dismiss}
              className="w-full bl-primary text-sm font-black py-2"
            >
              Got it
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
