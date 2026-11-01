/**
 * Starter Bundle Reveal — "Supply Drop Secured" card (audit FR-02).
 *
 * The initial bundle used to land silently: a new hunter's balances
 * simply changed between glances, and nothing ever said the game had
 * handed them a starter stake and a bike. This card is the one-time
 * announcement, presented in the game's loot language and fed ONLY
 * by the grant the op just performed (see
 * src/lib/api/initialBundle.ts — the amounts are deltas read off the
 * op's own post-grant profile snapshot, the vehicle name off the
 * granted item row). It renders only in the session whose bootstrap
 * performed the grant; already-granted accounts never see it.
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { useInitialBundleRevealStore } from '@/store/slices/initialBundleRevealSlice';

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function GrantRow({
  icon,
  label,
  value,
  accent = 'text-amber',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className="flex-1 text-xs text-zinc-400">{label}</span>
      <span className={`text-sm font-bold tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}

export function StarterBundleReveal() {
  const grant = useInitialBundleRevealStore((state) => state.grant);
  const dismiss = useInitialBundleRevealStore((state) => state.dismiss);

  if (!grant) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss();
        }}
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 24, stiffness: 200 }}
          className="bl-card w-full max-w-sm overflow-hidden"
          role="dialog"
          aria-label="Starter supply drop"
        >
          <div className="border-b border-amber/10 px-5 pb-3 pt-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">
                  Starter supply drop
                </div>
                <h2 className="text-lg font-black tracking-tight text-amber">Loot Secured</h2>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Every hunter starts with a stake. Here&apos;s yours:
                </p>
              </div>
              <button onClick={dismiss} className="bl-secondary rounded p-1.5" aria-label="Dismiss">
                <X className="h-4 w-4" size={16} />
              </button>
            </div>
          </div>
          <div className="space-y-1 px-5 py-3">
            {grant.credits > 0 && (
              <GrantRow
                icon={<ResourceIcon id="credits" size={16} />}
                label="Credits"
                value={`+${formatNumber(grant.credits)}`}
              />
            )}
            {grant.scrap > 0 && (
              <GrantRow
                icon={<ResourceIcon id="scrap" size={16} />}
                label="Scrap"
                value={`+${formatNumber(grant.scrap)}`}
                accent="text-zinc-300"
              />
            )}
            {grant.cacheKeys > 0 && (
              <GrantRow
                icon={<ResourceIcon id="cacheKey" size={16} />}
                label="Cache Keys"
                value={`+${formatNumber(grant.cacheKeys)}`}
                accent="text-cyan-400"
              />
            )}
            {grant.vehicleName && (
              <GrantRow
                icon={<ResourceIcon id="loot" size={16} />}
                label="Vehicle — equipped"
                value={grant.vehicleName}
                accent="text-green-400"
              />
            )}
          </div>
          <div className="px-5 pb-5 pt-2">
            <button onClick={dismiss} className="bl-primary min-h-11 w-full py-2 text-sm font-black">
              Collect
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
