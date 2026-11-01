/**
 * Offline Recap — "While You Were Away" Card
 *
 * Rendered when the player logs back in and offline settlement returns
 * rewards. Shows a durable, dismissible recap of what was earned while
 * offline. Not a transient toast — persists until the user taps "Got it".
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock } from 'lucide-react';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { MaterialBadge } from '@/components/common/MaterialBadge';
import { getVisualAsset } from '@/constants/visualAssets';
import { getCraftRecipe } from '@/content/crafting';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { PushPrimerRow } from './PushPrimer';

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function RewardRow({
  icon,
  label,
  value,
  accent = 'text-amber',
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className="text-xs text-zinc-400 flex-1">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}

export function OfflineRecap() {
  const { lastSettlement, dismissed, dismiss } = useOfflineRecapStore();

  if (!lastSettlement || dismissed) return null;

  // Craft settlement (0024): the away time went to the benches, not
  // the wilds — render the crafting section (completions the server
  // settled under the offline cap, flag F5).
  if ('crafting' in lastSettlement) {
    const c = lastSettlement.crafting;
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
            <div className="px-5 pt-5 pb-3 border-b border-amber/10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-amber tracking-tight">
                    While You Were Away
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">The benches kept working</p>
                </div>
                <button onClick={dismiss} className="bl-secondary p-1.5 rounded" aria-label="Dismiss">
                  <X className="w-4 h-4" size={16} />
                </button>
              </div>
            </div>
            <div className="px-5 py-3 space-y-1 border-b border-amber/10">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber" size={16} />
                <span className="text-sm text-zinc-300">
                  Bench time settled under your {c.capHours}h offline cap
                </span>
              </div>
              <div className="text-xs text-zinc-500">
                {c.jobsCompleted} job{c.jobsCompleted === 1 ? '' : 's'} finished · {c.completions.length} unit
                {c.completions.length === 1 ? '' : 's'} completed
              </div>
            </div>
            <div className="px-5 py-3 space-y-1">
              {c.xpAwarded > 0 && (
                <RewardRow
                  icon={<ResourceIcon id="xp" size={16} />}
                  label="Crafting XP"
                  value={`+${formatNumber(c.xpAwarded)}`}
                  accent="text-purple-400"
                />
              )}
              {c.completions.slice(0, 8).map((completion, i) => {
                const name =
                  getCraftRecipe(String(completion.recipeId ?? ''))?.name ?? 'Crafted unit';
                const detail =
                  typeof completion.quality === 'number'
                    ? `${completion.quality}% quality`
                    : typeof completion.outputMaterial === 'string'
                      ? `${completion.outputMaterial} ×${String(completion.outputQuantity ?? 0)}`
                      : typeof completion.rarity === 'string'
                        ? `${completion.rarity} frame`
                        : 'completed';
                return (
                  <RewardRow
                    key={`craft-${i}`}
                    icon={<ResourceIcon id="loot" size={16} />}
                    label={name}
                    value={detail}
                    accent="text-green-400"
                  />
                );
              })}
              {c.completions.length === 0 && (
                <p className="text-xs text-zinc-500 text-center">
                  No units finished this time — the jobs are still on the benches.
                </p>
              )}
            </div>
            <PushPrimerRow />
            <div className="px-5 pb-5 pt-2">
              <button onClick={dismiss} className="w-full bl-primary text-sm font-black py-2">
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Extraction settlement (0033): the away time went to the dig
  // site — render the extraction section: passes finalized under
  // the offline cap, their XP, and the finds the passes brought in.
  if ('extraction' in lastSettlement) {
    const x = lastSettlement.extraction;
    const findRows = [
      ...Object.entries(x.materials).map(([id, qty]) => ({ id, qty, kind: 'material' as const })),
      ...Object.entries(x.essences).map(([id, qty]) => ({ id, qty, kind: 'essence' as const })),
    ].sort((a, b) => b.qty - a.qty);
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
            <div className="px-5 pt-5 pb-3 border-b border-amber/10">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-amber tracking-tight">
                    While You Were Away
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">The site kept producing</p>
                </div>
                <button onClick={dismiss} className="bl-secondary p-1.5 rounded" aria-label="Dismiss">
                  <X className="w-4 h-4" size={16} />
                </button>
              </div>
            </div>
            <div className="px-5 py-3 space-y-1 border-b border-amber/10">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-amber" size={16} />
                <span className="text-sm text-zinc-300">
                  Site time settled under your {x.capHours}h offline cap
                </span>
              </div>
              <div className="text-xs text-zinc-500">
                {x.passesCompleted} pass{x.passesCompleted === 1 ? '' : 'es'} completed
              </div>
            </div>
            <div className="px-5 py-3 space-y-1">
              {x.xpAwarded > 0 && (
                <RewardRow
                  icon={<ResourceIcon id="xp" size={16} />}
                  label="Extraction XP"
                  value={`+${formatNumber(x.xpAwarded)}`}
                  accent="text-purple-400"
                />
              )}
              {findRows.slice(0, 8).map((find) => (
                <RewardRow
                  key={`extract-${find.kind}-${find.id}`}
                  icon={<ResourceIcon id="loot" size={16} />}
                  label={find.id}
                  value={`×${find.qty}`}
                  accent="text-green-400"
                />
              ))}
              {findRows.length === 0 && (
                <p className="text-xs text-zinc-500 text-center">
                  No passes finished this time — the current pass is still running.
                </p>
              )}
            </div>
            <PushPrimerRow />
            <div className="px-5 pb-5 pt-2">
              <button onClick={dismiss} className="w-full bl-primary text-sm font-black py-2">
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

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
              <span className="w-4 h-4 text-amber/60" style={{ fontSize: 16 }}>⚡</span>
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
                  icon={<ResourceIcon id="credits" size={16} />}
                  label="Credits"
                  value={`+${formatNumber(s.rewards.creditsAwarded)}`}
                  accent="text-amber"
                />
              )}
              {s.rewards.scrapAwarded > 0 && (
                <RewardRow
                  icon={<ResourceIcon id="scrap" size={16} />}
                  label="Scrap"
                  value={`+${formatNumber(s.rewards.scrapAwarded)}`}
                  accent="text-zinc-300"
                />
              )}
              {s.rewards.xpAwarded > 0 && (
                <RewardRow
                  icon={<ResourceIcon id="xp" size={16} />}
                  label="XP"
                  value={`+${formatNumber(s.rewards.xpAwarded)}`}
                  accent="text-purple-400"
                />
              )}
              {s.rewards.cacheFragmentsAwarded > 0 && (
                <RewardRow
                  icon={<ResourceIcon id="cacheFragment" size={16} />}
                  label="Key Fragments"
                  value={`+${s.rewards.cacheFragmentsAwarded}`}
                  accent="text-cyan-400"
                />
              )}
              {s.standing && s.standing.points > 0 && (
                <RewardRow
                  icon={<ResourceIcon id="masteryPoint" size={16} />}
                  label={`${s.standing.manufacturer} Standing`}
                  value={`+${s.standing.points}`}
                  accent="text-emerald-400"
                />
              )}
              {Object.entries(s.rewards.materials).map(([type, count]) => (
                <RewardRow
                  key={`mat-${type}`}
                  icon={<MaterialBadge id={type} count={count} />}
                  label={getVisualAsset('material', type).label}
                  value={`+${count}`}
                  accent="text-blue-400"
                />
              ))}
              {Object.entries(s.rewards.essences).map(([type, count]) => (
                <RewardRow
                  key={`ess-${type}`}
                  icon={<MaterialBadge id={type} count={count} />}
                  label={type}
                  value={`+${count}`}
                  accent="text-pink-400"
                />
              ))}
              {s.items.length > 0 && (
                <RewardRow
                  icon={<ResourceIcon id="loot" size={16} />}
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
          <PushPrimerRow />
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
