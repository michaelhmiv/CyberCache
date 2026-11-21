import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { Clock, AlertTriangle, Info, ExternalLink, LifeBuoy } from 'lucide-react';
import { usePlayerStore, useIdleStore, useSkillStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { resetRuntimeStoresToInitialState, saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { BASE_OFFLINE_CAP_HOURS, OFFLINE_CAP_LIMITER_OPTIONS, OFFLINE_CAP_MILESTONES, earnedOfflineCapHours, effectiveOfflineCapHours, nextOfflineCapMilestone } from '@/content/offlineCap';
import { setOfflineCapLimiter } from '@/lib/api/offlineCapService';
import { getAutoSalvageRule, setAutoSalvageRule, type AutoSalvageRule } from '@/lib/api/autoSalvageService';
import { getResearchState } from '@/lib/chef/chefClient';
import { DeleteAccountControl } from '@/components/profile/DeleteAccountControl';

const SUPPORT_URL = 'https://chef-production.up.railway.app/support.html';

export const SettingsScreen: React.FC = () => {
  const player = usePlayerStore();
  const idle = useIdleStore();
  const skills = useSkillStore();

  // Offline cap law (src/content/offlineCap.ts): the cap is EARNED
  // through Research — the Logistics & Markets track's grants over a
  // 2h base (+ the Scavenger keystone's bonus) — the player may set a
  // LIMITER below it, and a 24h ceiling binds everything. Settlement
  // enforces min(earned, limiter, 24h) server-side; this card shows
  // the same math and writes the limiter. The Research grants are
  // Chef-owned state, read through the research state view (the
  // ResearchChip pattern): until the read lands — or if the Chef is
  // unreachable — the card shows the 2h base, which is display-only;
  // settlement always derives from server records. The stored profile
  // value reaches the client as a number where 0 (or the pre-hydration
  // default) means "no limiter set" — a real limiter is 1..24.
  const [researchCapHours, setResearchCapHours] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (!cancelled) setResearchCapHours(result.research.bonuses.offlineCapBonus);
      })
      .catch(() => {
        // Chef unreachable: base-only display (settlement is server-derived).
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const offlineCapBonus = Math.max(0, Math.floor(skills.getBonuses().offlineCapBonus ?? 0));
  const earnedCapHours = earnedOfflineCapHours(researchCapHours);
  const storedLimiter = player.offlineCapHours >= 1 && player.offlineCapHours <= 24 ? Math.floor(player.offlineCapHours) : null;
  // Draft-override pattern: undefined follows the stored profile value
  // (hydration-safe, no effect sync); a pick replaces it locally.
  const [limiterDraft, setLimiterDraft] = useState<number | null | undefined>(undefined);
  const limiter = limiterDraft !== undefined ? limiterDraft : storedLimiter;
  const [limiterSaving, setLimiterSaving] = useState(false);
  const [limiterError, setLimiterError] = useState<string | null>(null);
  const effectiveCapHours = effectiveOfflineCapHours({
    researchCapHours,
    bonusHours: offlineCapBonus,
    userCapHours: limiter,
  });
  const nextCapMilestone = nextOfflineCapMilestone(researchCapHours);

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

  // Auto-Salvage Rules (migration 0080): the rule is PROFILE-owned
  // and enforced by the Chef at claim settlement — the idle store
  // fields below are display state only. On mount the card re-reads
  // the authoritative rule from the profile and mirrors it into the
  // display store; every change writes through to the profile
  // first-class (validation reports as data, like the limiter), and
  // a failed save re-reads so the card never shows a rule the
  // server does not hold.
  const [salvageDraft, setSalvageDraft] = useState<AutoSalvageRule | undefined>(undefined);
  const [salvageSaving, setSalvageSaving] = useState(false);
  const [salvageError, setSalvageError] = useState<string | null>(null);
  const salvageRule: AutoSalvageRule = salvageDraft ?? {
    enabled: true,
    maxRarity: idle.autoSalvageRarity,
    maxQuality: idle.autoSalvageQuality,
    toMaterials: idle.autoSalvageToMaterials,
  };
  const mirrorSalvageToDisplay = (rule: AutoSalvageRule) => {
    idle.setAutoSalvage(rule.maxRarity, rule.maxQuality);
    idle.setAutoSalvageToMaterials(rule.toMaterials);
  };
  useEffect(() => {
    let cancelled = false;
    getAutoSalvageRule()
      .then((rule) => {
        if (cancelled || !rule) return;
        setSalvageDraft(rule);
        mirrorSalvageToDisplay(rule);
      })
      .catch(() => {
        // Chef unreachable: the display values stand; settlement is
        // server-derived from the profile either way.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleSalvage = async (next: AutoSalvageRule) => {
    if (salvageSaving) return;
    setSalvageSaving(true);
    setSalvageError(null);
    setSalvageDraft(next);
    mirrorSalvageToDisplay(next);
    const result = await setAutoSalvageRule(next);
    setSalvageSaving(false);
    if (!result.ok) {
      setSalvageError(result.error ?? 'Could not save the Auto-Salvage Rules.');
      const authoritative = await getAutoSalvageRule();
      if (authoritative) {
        setSalvageDraft(authoritative);
        mirrorSalvageToDisplay(authoritative);
      }
      return;
    }
    if (result.rule) {
      setSalvageDraft(result.rule);
      mirrorSalvageToDisplay(result.rule);
    }
  };

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
      <MobileCard className="space-y-2" rarityColor="#3B82F6">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Offline Earnings Cap</div>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-black text-text-primary">{effectiveCapHours}h</span>
          <span className="text-[11px] text-text-muted">
            effective cap · earned {earnedCapHours + offlineCapBonus}h — {BASE_OFFLINE_CAP_HOURS}h base
            {researchCapHours > 0 && <> + {researchCapHours}h from Research</>}
            {offlineCapBonus > 0 && <> (incl. +{offlineCapBonus}h King of Scrap)</>}
            {limiter !== null && <> · limited by you to {limiter}h</>}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[{ courseId: '', courseName: 'Base', hours: BASE_OFFLINE_CAP_HOURS }, ...OFFLINE_CAP_MILESTONES.map((m) => ({ courseId: m.courseId, courseName: m.courseName, hours: m.capHours }))].map((step) => {
            const earned = earnedCapHours >= step.hours;
            const current = earnedCapHours === step.hours;
            return (
              <div
                key={step.hours}
                className={`border py-1.5 text-center text-xs font-black ${current ? 'border-amber/70 bg-amber/15 text-amber' : earned ? 'bl-secondary text-text-secondary' : 'bl-secondary text-text-muted opacity-50'}`}
              >
                {step.hours}h
                <div className="text-[11px] font-bold uppercase tracking-wide">{earned ? step.courseName : <span className="inline-flex items-center justify-center gap-0.5">{step.courseName} <PxIcon name="lock" size={13} /></span>}</div>
              </div>
            );
          })}
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Your limiter — settle at most</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => void handleLimiter(null)}
              disabled={limiterSaving}
              className={`min-h-[44px] px-3 py-2 text-[11px] font-black ${limiter === null ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
            >
              No limit
            </button>
            {OFFLINE_CAP_LIMITER_OPTIONS.map((hours) => (
              <button
                key={hours}
                onClick={() => void handleLimiter(hours)}
                disabled={limiterSaving}
                className={`min-h-[44px] px-3 py-2 text-[11px] font-black ${limiter === hours ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {hours}h
              </button>
            ))}
          </div>
          {limiterError && <div className="text-[11px] font-bold text-red-400">{limiterError}</div>}
          <div className="text-[11px] text-text-muted">
            {nextCapMilestone
              ? `Next cap: complete ${nextCapMilestone.courseName} in Research for ${nextCapMilestone.capHours}h.`
              : 'Maximum Research offline cap earned (24h ceiling).'}
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-3" rarityColor="#FF9000">
        <div className="flex items-center gap-2">
          <PxIcon name="recycle" size={17} className="text-amber" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Auto-Salvage Rules</div>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Auto-Salvage</div>
          <div className="grid grid-cols-2 gap-1.5">
            {([true, false] as const).map((on) => (
              <button
                key={String(on)}
                onClick={() => void handleSalvage({ ...salvageRule, enabled: on })}
                disabled={salvageSaving}
                className={`min-h-[44px] py-2 text-[11px] font-black ${salvageRule.enabled === on ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {on ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Max Rarity to Auto-Salvage</div>
          <div className="grid grid-cols-4 gap-1.5">
            {salvageOptions.map((r) => (
              <button
                key={r}
                onClick={() => void handleSalvage({ ...salvageRule, maxRarity: r })}
                disabled={salvageSaving}
                className={`min-h-[44px] py-2 text-[11px] font-black ${salvageRule.maxRarity === r ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Max Roll Quality to Salvage</div>
          <div className="grid grid-cols-5 gap-1.5">
            {qualityOptions.map((q) => (
              <button
                key={q}
                onClick={() => void handleSalvage({ ...salvageRule, maxQuality: q })}
                disabled={salvageSaving}
                className={`min-h-[44px] py-2 text-[11px] font-black ${salvageRule.maxQuality === q ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Salvage Yield</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => void handleSalvage({ ...salvageRule, toMaterials: false })}
              disabled={salvageSaving}
              className={`min-h-[44px] py-2 text-[11px] font-black ${!salvageRule.toMaterials ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
            >
              Scrap
            </button>
            <button
              onClick={() => void handleSalvage({ ...salvageRule, toMaterials: true })}
              disabled={salvageSaving}
              className={`min-h-[44px] py-2 text-[11px] font-black ${salvageRule.toMaterials ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
            >
              Materials
            </button>
          </div>
          <div className="text-[11px] text-text-muted">
            Materials converts salvaged drops into crafting materials scaled by scrap value.
          </div>
        </div>
        {salvageError && <div className="text-[11px] font-bold text-red-400">{salvageError}</div>}
        <div className="text-[11px] text-text-muted">
          Applies to new roaming and offline drops only — boss, cache, market, crafted, and bag items are never auto-salvaged.
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#3B82F6">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">About</div>
        </div>
        <div className="space-y-1 text-[11px] text-text-secondary">
          <div>CyberCache</div>
          <div>Idle roguelite looter RPG</div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#3B82F6">
        <div className="flex items-center gap-2">
          <LifeBuoy size={16} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Support</div>
        </div>
        <button
          type="button"
          data-testid="settings-support-row"
          onClick={() => window.open(SUPPORT_URL, '_blank', 'noopener,noreferrer')}
          className="bl-secondary flex min-h-[44px] w-full items-center justify-center gap-2 py-2 text-xs font-black text-text-secondary"
        >
          <ExternalLink size={14} />
          Open the support page
        </button>
        <div className="text-[11px] text-text-muted">
          Help, account questions, and contact — opens in your browser.
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#FF4B5C">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red" />
          <div className="text-xs font-black uppercase tracking-wide text-red">Danger Zone</div>
        </div>
        {resetError && (
          <div className="bl-card p-2 text-[11px] text-red">
            {resetError}
          </div>
        )}
        {!showReset ? (
          <button
            onClick={() => setShowReset(true)}
            className="bl-secondary min-h-[44px] w-full py-2 text-xs font-black text-red"
          >
            Reset All Save Data
          </button>
        ) : (
          <div className="space-y-2">
            <div className="text-[11px] text-red">This permanently resets your saved progress, items, and settings. This cannot be undone.</div>
            <button
              onClick={handleReset}
              disabled={resetting}
              className={`min-h-[44px] w-full py-2 text-xs font-black disabled:opacity-50 ${resetConfirmed ? 'bl-primary animate-pulse' : 'bl-secondary text-red'}`}
            >
              {resetting ? 'Resetting…' : resetConfirmed ? 'RESET EVERYTHING' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => { setShowReset(false); setResetConfirmed(false); setResetError(null); }}
              disabled={resetting}
              className="bl-secondary min-h-[44px] w-full py-2 text-xs font-black text-text-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
        <DeleteAccountControl />
      </MobileCard>
    </div>
  );
};
