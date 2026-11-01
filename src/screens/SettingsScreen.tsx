import React, { useEffect, useState } from 'react';
import { Clock, AlertTriangle, Info, Settings, ExternalLink } from 'lucide-react';
import { usePlayerStore, useIdleStore, useSkillStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { resetRuntimeStoresToInitialState, saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { BASE_OFFLINE_CAP_HOURS, OFFLINE_CAP_LIMITER_OPTIONS, OFFLINE_CAP_TIERS, earnedOfflineCapHours, effectiveOfflineCapHours, nextOfflineCapTier } from '@/content/offlineCap';
import { setOfflineCapLimiter } from '@/lib/api/offlineCapService';
import { HUNTER_HEAD_VARIANTS, isHunterHeadVariantId, type HunterHeadVariantId } from '@/lib/pixel/rig';
import { getStandingState } from '@/lib/chef/chefClient';
import { STANDING_COSMETICS } from '@/content/manufacturerStanding';
import type { Manufacturer } from '@/types/game';

const DATA_DELETION_URL = 'https://chef-production.up.railway.app/data-deletion.html';

export const SettingsScreen: React.FC = () => {
  const player = usePlayerStore();
  const idle = useIdleStore();
  const skills = useSkillStore();

  // Offline cap law (src/content/offlineCap.ts): the cap is EARNED by
  // level (+ the Scavenger keystone's bonus), the player may set a
  // LIMITER below it, and a 24h ceiling binds everything. Settlement
  // enforces min(earned, limiter, 24h) server-side; this card shows
  // the same math and writes the limiter. The stored profile value
  // reaches the client as a number where 0 (or the pre-hydration
  // default) means "no limiter set" — a real limiter is 1..24.
  const offlineCapBonus = Math.max(0, Math.floor(skills.getBonuses().offlineCapBonus ?? 0));
  const earnedCapHours = earnedOfflineCapHours(player.level);
  const storedLimiter = player.offlineCapHours >= 1 && player.offlineCapHours <= 24 ? Math.floor(player.offlineCapHours) : null;
  const [headVariant, setHeadVariant] = useState<HunterHeadVariantId>(() => {
    try {
      const value = window.localStorage.getItem('cc-head-variant');
      return isHunterHeadVariantId(value) ? value : 'visor';
    } catch {
      return 'visor';
    }
  });
  // Manufacturer Standing cosmetics (0043): the rank-3 head variants
  // are listed only when the account owns them (granted rank >= 3 on
  // that manufacturer's ladder — server state read from the Chef).
  // Until the read lands, only the base variants show.
  const [ownedHeadVariants, setOwnedHeadVariants] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    getStandingState()
      .then((result) => {
        if (cancelled) return;
        const owned = new Set<string>();
        for (const m of result.standing.manufacturers) {
          if (m.rank >= 3) owned.add(STANDING_COSMETICS[m.manufacturer as Manufacturer].headVariantId);
        }
        setOwnedHeadVariants(owned);
      })
      .catch(() => {
        // Chef unreachable: base variants only.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Draft-override pattern: undefined follows the stored profile value
  // (hydration-safe, no effect sync); a pick replaces it locally.
  const [limiterDraft, setLimiterDraft] = useState<number | null | undefined>(undefined);
  const limiter = limiterDraft !== undefined ? limiterDraft : storedLimiter;
  const [limiterSaving, setLimiterSaving] = useState(false);
  const [limiterError, setLimiterError] = useState<string | null>(null);
  const effectiveCapHours = effectiveOfflineCapHours({
    level: player.level,
    bonusHours: offlineCapBonus,
    userCapHours: limiter,
  });
  const nextCapTier = nextOfflineCapTier(player.level);

  const handleLimiter = async (value: number | null) => {
    if (limiterSaving || value === limiter) return;
    setLimiterSaving(true);
    setLimiterError(null);
    const result = await setOfflineCapLimiter(value);
    setLimiterSaving(false);
    if (!result.ok) {
      setLimiterError(result.error ?? 'Could not save the limiter.');
      return;
    }
    setLimiterDraft(value);
    player.setPlayer({ offlineCapHours: value ?? 0 });
  };
  const [showReset, setShowReset] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const salvageOptions = ['Common', 'Uncommon', 'Rare', 'Epic'];
  const qualityOptions = [0, 20, 40, 60, 80];

  const handleReset = async () => {
    if (!resetConfirmed) {
      setResetConfirmed(true);
      return;
    }

    setResetting(true);
    setResetError(null);
    try {
      await verifiedOps.resetProgress();
      resetRuntimeStoresToInitialState();
      await saveCurrentRuntimeStores();
      window.location.reload();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Unable to reset account progress.');
      setResetting(false);
    }
  };

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Options Board</div>
          <div className="text-xs text-text-muted">Idle tuning, salvage rules, and account controls.</div>
        </div>
        <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
          <Settings size={22} />
        </div>
      </div>

      <MobileCard className="space-y-2" rarityColor="#3B82F6">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Offline Earnings Cap</div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-text-primary">{effectiveCapHours}h</span>
          <span className="text-[10px] text-text-muted">
            effective cap · earned {earnedCapHours + offlineCapBonus}h at level {player.level}
            {offlineCapBonus > 0 && <> (incl. +{offlineCapBonus}h King of Scrap)</>}
            {limiter !== null && <> · limited by you to {limiter}h</>}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[{ minLevel: 1, hours: BASE_OFFLINE_CAP_HOURS }, ...OFFLINE_CAP_TIERS].map((tier) => {
            const earned = player.level >= tier.minLevel;
            const current = earnedCapHours === tier.hours;
            return (
              <div
                key={tier.hours}
                className={`py-1.5 text-center text-xs font-black ${current ? 'bl-primary' : earned ? 'bl-secondary text-text-secondary' : 'bl-secondary text-text-muted opacity-50'}`}
              >
                {tier.hours}h
                <div className="text-[8px] font-bold uppercase tracking-wide">{earned ? `Lv ${tier.minLevel}` : `Lv ${tier.minLevel} 🔒`}</div>
              </div>
            );
          })}
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Your limiter — settle at most</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => void handleLimiter(null)}
              disabled={limiterSaving}
              className={`py-1.5 px-2.5 text-[10px] font-black ${limiter === null ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
            >
              No limit
            </button>
            {OFFLINE_CAP_LIMITER_OPTIONS.map((hours) => (
              <button
                key={hours}
                onClick={() => void handleLimiter(hours)}
                disabled={limiterSaving}
                className={`py-1.5 px-2.5 text-[10px] font-black ${limiter === hours ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {hours}h
              </button>
            ))}
          </div>
          {limiterError && <div className="text-[10px] font-bold text-red-400">{limiterError}</div>}
          <div className="text-[10px] text-text-muted">
            The limiter can only shorten a settlement — it never raises the cap past what you have earned. Nothing can exceed the 24h ceiling.
          </div>
        </div>
        <div className="text-[10px] text-text-muted">
          {nextCapTier
            ? `Maximum hours of offline rewards that can pile up while away. Reach level ${nextCapTier.minLevel} to raise the earned cap to ${nextCapTier.hours}h.`
            : 'Maximum hours of offline rewards that can pile up while away. Top tier earned.'}
        </div>
      </MobileCard>

      <MobileCard className="space-y-3" rarityColor="#39D0D8">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }} className="text-amber">⛑</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Hunter Appearance</div>
        </div>
        <div className="text-[10px] text-text-muted">
          Head variant worn by your hunter on the roaming stage. Stored on this device.
          Manufacturer variants unlock at Rank 3 with each maker — earn them at the Vendor&apos;s Rep Desk.
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {HUNTER_HEAD_VARIANTS.filter(
            (variant) => !variant.standingManufacturer || ownedHeadVariants.has(variant.id),
          ).map((variant) => (
            <button
              key={variant.id}
              onClick={() => {
                try {
                  window.localStorage.setItem('cc-head-variant', variant.id);
                } catch {
                  // storage unavailable — the default visor stays
                }
                setHeadVariant(variant.id);
              }}
              className={`py-1.5 text-[10px] font-black ${headVariant === variant.id ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              data-testid={`head-variant-${variant.id}`}
            >
              {variant.label}
            </button>
          ))}
        </div>
      </MobileCard>

      <MobileCard className="space-y-3" rarityColor="#FF9000">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }} className="text-amber">♻</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Auto-Salvage Rules</div>
        </div>
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Max Rarity to Auto-Salvage</div>
          <div className="grid grid-cols-4 gap-1.5">
            {salvageOptions.map((r) => (
              <button
                key={r}
                onClick={() => idle.setAutoSalvage(r, idle.autoSalvageQuality)}
                className={`py-1.5 text-[10px] font-black ${idle.autoSalvageRarity === r ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Max Roll Quality to Salvage</div>
          <div className="grid grid-cols-5 gap-1.5">
            {qualityOptions.map((q) => (
              <button
                key={q}
                onClick={() => idle.setAutoSalvage(idle.autoSalvageRarity, q)}
                className={`py-1.5 text-[10px] font-black ${idle.autoSalvageQuality === q ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#3B82F6">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">About</div>
        </div>
        <div className="space-y-1 text-[10px] text-text-secondary">
          <div>CyberCache v0.1.0</div>
          <div>Mobile-first idle roguelite looter RPG</div>
          <div>React 19 · TypeScript · Tailwind CSS · Framer Motion</div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#FF4B5C">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red" />
          <div className="text-xs font-black uppercase tracking-wide text-red">Danger Zone</div>
        </div>
        {resetError && (
          <div className="bl-card p-2 text-[10px] text-red">
            {resetError}
          </div>
        )}
        {!showReset ? (
          <button
            onClick={() => setShowReset(true)}
            className="bl-secondary w-full py-2 text-xs font-black text-red"
          >
            Reset All Save Data
          </button>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] text-red">This permanently resets Supabase-backed progress, items, and runtime settings. This cannot be undone.</div>
            <button
              onClick={handleReset}
              disabled={resetting}
              className={`w-full py-2 text-xs font-black disabled:opacity-50 ${resetConfirmed ? 'bl-primary animate-pulse' : 'bl-secondary text-red'}`}
            >
              {resetting ? 'Resetting…' : resetConfirmed ? 'RESET EVERYTHING' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => { setShowReset(false); setResetConfirmed(false); setResetError(null); }}
              disabled={resetting}
              className="bl-secondary w-full py-2 text-xs font-black text-text-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="border-t border-border/60 pt-3">
          <div className="mb-2 text-[10px] text-text-muted">
            Request deletion of your CyberCache account and associated server-side gameplay data.
          </div>
          <button
            onClick={() => window.open(DATA_DELETION_URL, '_blank', 'noopener,noreferrer')}
            className="bl-secondary flex w-full items-center justify-center gap-2 py-2 text-xs font-black text-red"
          >
            <ExternalLink size={14} />
            Delete Account / Data
          </button>
        </div>
      </MobileCard>
    </div>
  );
};
