import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { BossDef, PhaseAnalysis } from '../../types/boss';
import { ConsumableSlot, RiskSetting } from '../../types/game';
import { CONSUMABLES, CONSUMABLE_SLOTS, consumableLoadoutToCounts, getConsumablesForSlot } from '../../constants/consumables';
import { RARITIES } from '../../constants/rarities';
import { simulateBoss } from '../../lib/simulation/bossSimulator';
import { buildBossFightActivity } from '../../lib/activity/activityBuilders';
import { computeLoadoutDps } from '../../lib/stats/dpsChain';
import { buildInitialTimeline, runFightAnimation, type FightTimeline } from '../../lib/animation/fightTimeline';
import { verifyBossFight, type ChefVerifyBossResult } from '../../lib/chef/chefClient';
import { applyBossConsumableDisplayEvents } from '../../lib/chef/bossResultAdapter';
import { syncBossAttemptResult } from '../../lib/supabase/verifiedStateSync';
import { useActivityStore, useBossStore, useLoadoutStore, usePlayerStore, useSkillStore } from '../../store';
import { MobileCard } from '../layout/MobileCard';
import { WeaponCanvas } from '../pixelArt/WeaponCanvas';
import { BossSigil } from '@/components/common/BossSigil';
import { BossPortrait } from '@/components/common/BossPortrait';
import { getResourceVisual } from '@/constants/visualAssets';
import type { Weapon } from '../../types/items';

interface BossPrepModalProps {
  boss: BossDef;
  onClose: () => void;
}

const SLOT_LABELS: Record<ConsumableSlot, string> = {
  [ConsumableSlot.PreFight]: 'Slot 1',
  [ConsumableSlot.MidFight]: 'Slot 2',
  [ConsumableSlot.Emergency]: 'Slot 3',
};

const STATUS_LABEL = {
  implemented: 'Live',
  approximated: 'Approx',
  legacy: 'Legacy',
};

const PHASE_STATUS_COLOR: Record<PhaseAnalysis['status'], string> = {
  safe: 'text-green',
  close: 'text-amber',
  risky: 'text-orange-400',
  failing: 'text-red',
};

const PHASE_STATUS_BORDER: Record<PhaseAnalysis['status'], string> = {
  safe: 'border-green/30',
  close: 'border-amber/30',
  risky: 'border-orange-400/30',
  failing: 'border-red/30',
};

const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

/**
 * BossVitalsBars — three proportional horizontal bars (HP, Shield, Armor).
 * Idle-game convention: HP is the thickest bar (the player's primary
 * concern), shield and armor are thinner and stacked below. Each bar
 * animates from 0 to its value on first mount (300ms) so the player gets
 * a "this is a beefy boss" feeling instead of static numbers.
 *
 * Private to BossPrepModal; lives in the same file as a deliberate
 * scope limit. If a future screen needs the same visualization, extract
 * to src/components/boss/BossVitalsBars.tsx.
 */
const BossVitalsBars: React.FC<{ boss: BossDef }> = ({ boss }) => {
  const maxHealth = Math.max(1, boss.health);
  const maxShield = Math.max(1, boss.shield);
  const maxArmor = Math.max(1, boss.armor);
  return (
    <div className="space-y-1.5" data-testid="boss-vitals">
      {/* HP — red, the primary bar */}
      <div className="flex items-center gap-2">
        <div className="flex w-14 items-center gap-1 text-[9px] font-black uppercase text-text-muted">
          <span className="text-red" style={{ fontSize: 11 }}>♥</span>HP
        </div>
        <div className="relative h-3 flex-1 overflow-hidden border-2 border-border bg-bg" style={slashClip}>
          <motion.div
            className="absolute inset-y-0 left-0 bg-red"
            initial={{ width: 0 }}
            animate={{ width: `${(boss.health / maxHealth) * 100}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            data-bar="hp"
            data-width={(boss.health / maxHealth * 100).toFixed(1)}
          />
        </div>
        <div className="w-20 text-right font-mono text-xs font-black text-red">{boss.health.toLocaleString()}</div>
      </div>
      {/* Shield — cyan */}
      <div className="flex items-center gap-2">
        <div className="flex w-14 items-center gap-1 text-[9px] font-black uppercase text-text-muted">
          <span className="text-cyan" style={{ fontSize: 11 }}>⚡</span>Sh
        </div>
        <div className="relative h-2 flex-1 overflow-hidden border-2 border-border bg-bg" style={slashClip}>
          <motion.div
            className="absolute inset-y-0 left-0 bg-cyan"
            initial={{ width: 0 }}
            animate={{ width: `${(boss.shield / maxShield) * 100}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            data-bar="shield"
            data-width={(boss.shield / maxShield * 100).toFixed(1)}
          />
        </div>
        <div className="w-20 text-right font-mono text-[10px] font-black text-cyan">{boss.shield.toLocaleString()}</div>
      </div>
      {/* Armor — purple */}
      <div className="flex items-center gap-2">
        <div className="flex w-14 items-center gap-1 text-[9px] font-black uppercase text-text-muted">
          <span className="text-purple" style={{ fontSize: 11 }}>◈</span>Ar
        </div>
        <div className="relative h-2 flex-1 overflow-hidden border-2 border-border bg-bg" style={slashClip}>
          <motion.div
            className="absolute inset-y-0 left-0 bg-purple"
            initial={{ width: 0 }}
            animate={{ width: `${(boss.armor / maxArmor) * 100}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            data-bar="armor"
            data-width={(boss.armor / maxArmor * 100).toFixed(1)}
          />
        </div>
        <div className="w-20 text-right font-mono text-[10px] font-black text-purple">{boss.armor.toLocaleString()}</div>
      </div>
    </div>
  );
};

/**
 * BossPhaseTimeline — a horizontal segmented bar showing all phases
 * of the boss fight in order, each segment colored by status. Tapping
 * a segment smooth-scrolls the corresponding phase card into view.
 * Idle-game convention: one continuous bar split by vertical dividers
 * (no gaps), with the phase name centered in each segment. The bar
 * shows the *order* of phases, which the existing card list cannot.
 *
 * Private to BossPrepModal; lives in the same file as a deliberate
 * scope limit. If a future screen needs it, extract to
 * src/components/boss/BossPhaseTimeline.tsx.
 */
const PHASE_STATUS_BG: Record<PhaseAnalysis['status'], string> = {
  safe: 'bg-green/40',
  close: 'bg-amber/40',
  risky: 'bg-orange-400/40',
  failing: 'bg-red/40',
};

const BossPhaseTimeline: React.FC<{ phases: PhaseAnalysis[]; onSelect: (phaseId: string) => void }> = ({ phases, onSelect }) => {
  if (phases.length === 0) return null;
  return (
    <div className="flex h-9 border-2 border-border overflow-hidden" data-testid="phase-timeline" role="navigation" aria-label="Boss phase timeline">
      {phases.map((phase, i) => {
        const color = PHASE_STATUS_BG[phase.status];
        const borderRight = i < phases.length - 1 ? 'border-r-2 border-border' : '';
        return (
          <button
            key={phase.phaseId}
            type="button"
            onClick={() => onSelect(phase.phaseId)}
            className={`flex-1 ${color} ${borderRight} px-1 text-[8px] font-black uppercase text-text-primary active:scale-95 truncate`}
            data-phase-segment={phase.phaseId}
            data-status={phase.status}
            aria-label={`Jump to ${phase.phaseName} (${phase.status})`}
          >
            {phase.phaseName}
          </button>
        );
      })}
    </div>
  );
};

/**
 * BossReadinessCard — the recommended-power delta. Surfaces the gap
 * between the player's effective DPS and the boss's recommendedPower.
 * Green = over-geared, red = under-geared, with a percentage delta so
 * the player can read the gap at a glance. The threshold is 0 (zero
 * delta = exactly the recommended power). No "is this beatable"
 * gating here — the win-chance card already does that.
 */
const BossReadinessCard: React.FC<{ boss: BossDef; playerPower: number }> = ({ boss, playerPower }) => {
  const delta = playerPower - boss.recommendedPower;
  const deltaPct = boss.recommendedPower > 0 ? (delta / boss.recommendedPower) * 100 : 0;
  const overgeared = delta >= 0;
  return (
    <div
      className={`flex items-center gap-2 border-2 p-1.5 ${overgeared ? 'border-green/40 bg-green/5' : 'border-red/40 bg-red/5'}`}
      style={slashClip}
      data-testid="boss-readiness"
    >
      <span style={{ fontSize: 14 }} className={overgeared ? 'text-green' : 'text-red'}>✦</span>
      <div className="text-[10px] text-text-muted">Your power:</div>
      <div className="text-xs font-black text-text-primary">{playerPower.toFixed(0).toLocaleString()}</div>
      <div className="text-[10px] text-text-muted">vs</div>
      <div className="text-xs font-black text-text-primary">{boss.recommendedPower.toLocaleString()}</div>
      <div className={`ml-auto text-xs font-black ${overgeared ? 'text-green' : 'text-red'}`} data-delta={deltaPct.toFixed(1)}>
        {overgeared ? '+' : ''}{deltaPct.toFixed(0)}%
      </div>
    </div>
  );
};

// Animation tuning constants and the FightTimeline / DamageLog types live
// in src/lib/animation/fightTimeline.ts. Importing them above keeps the
// constants testable without bootstrapping the React tree, and prevents
// drift between the runtime animation and the parity test.

export const BossPrepModal: React.FC<BossPrepModalProps> = ({ boss, onClose }) => {
  const player = usePlayerStore();
  const bossStore = useBossStore();
  const loadout = useLoadoutStore();
  const skillStore = useSkillStore();
  const activity = useActivityStore();
  const [risk, setRisk] = useState<RiskSetting>(RiskSetting.Balanced);
  const [result, setResult] = useState<ChefVerifyBossResult | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The fight card morphs through three states: 'pre' (win chance %),
  // 'during' (animated HP bars + phase markers), 'post' (victory/defeat
  // result). One card, one slot, no overlap — see plan hud-component-plan.md
  // PR #0 §2.4. The timeline ref lets the animation callback read the
  // latest state without re-creating the closure on every tick.
  const reducedMotion = useReducedMotion();
  const [fightTimeline, setFightTimeline] = useState<FightTimeline | null>(null);
  const animationCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  // PR #3: phase card refs for the timeline scroll-into-view. A Map
  // because phase ids are not in a known order and the count is small
  // (4-6 phases typically). Using a ref-callback pattern so React handles
  // the mount/unmount lifecycle for us.
  const phaseCardRefs = useRef(new Map<string, HTMLElement>());
  const setPhaseCardRef = (phaseId: string) => (node: HTMLElement | null) => {
    if (node) phaseCardRefs.current.set(phaseId, node);
    else phaseCardRefs.current.delete(phaseId);
  };
  // Smooth-scroll the named phase card into view. Called from the
  // segmented timeline at the top of the phase plan. Honors the
  // reducedMotion preference from framer-motion by falling back to
  // instant scroll when set.
  const scrollToPhase = (phaseId: string) => {
    const node = phaseCardRefs.current.get(phaseId);
    if (!node) return;
    node.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const primary = loadout.getWeapon('primary') ?? null;
  const secondary = loadout.getWeapon('secondary') ?? null;
  const heavy = loadout.getWeapon('heavy') ?? null;
  const shield = loadout.getShield() || null;
  const ordnance = loadout.getOrdnance() || null;
  const classMod = loadout.getClassMod() || null;
  const relic = loadout.getRelic() || null;
  const equippedConsumables = loadout.getEquippedConsumables();
  const selectedConsumables = useMemo(() => consumableLoadoutToCounts(equippedConsumables), [equippedConsumables]);
  const selectionAvailable = Object.entries(selectedConsumables).every(([type, count]) => player.getConsumableCount(type) >= count);
  const activityWeapon = primary ?? secondary ?? heavy ?? undefined;
  // Boss-relative DPS for the prep modal. Single source of truth: the chain
  // (src/lib/stats/dpsChain.ts). Each weapon row in the Loadout section gets
  // its own DPS-vs-this-boss number so the player can see which slot is
  // actually contributing, and the element-vs-weakness match status so the
  // "counter / resisted / neutral" indicator is honest.
  const loadoutDpsPerWeapon = useMemo(() => {
    const slots: Array<{ slot: 'Primary' | 'Secondary' | 'Heavy'; weapon: Weapon | null }> = [
      { slot: 'Primary', weapon: primary },
      { slot: 'Secondary', weapon: secondary },
      { slot: 'Heavy', weapon: heavy },
    ];
    return slots.map(({ slot, weapon }) => {
      if (!weapon) {
        return { slot, weapon, dpsVsBoss: 0, matchesWeakness: false, matchesResistance: false };
      }
      const matchesWeakness = boss.weaknesses.includes(weapon.element);
      const matchesResistance = boss.resistances.includes(weapon.element);
      const dpsVsBoss = computeLoadoutDps([weapon], boss.weaknesses, boss.resistances);
      return { slot, weapon, dpsVsBoss, matchesWeakness, matchesResistance };
    });
  }, [primary, secondary, heavy, boss.weaknesses, boss.resistances]);
  const loadoutDpsVsBoss = loadoutDpsPerWeapon.reduce((sum, entry) => sum + entry.dpsVsBoss, 0);
  const isBossPrepActivity = activity.current.kind === 'boss_fight' && activity.current.bossPhase === 'prep' && activity.current.targetType === 'boss' && activity.current.targetId === boss.id;
  const isBossFightActivity = activity.current.kind === 'boss_fight' && activity.current.targetType === 'boss' && activity.current.targetId === boss.id;
  const activityLabel = isBossFightActivity ? 'Boss fight active' : isBossPrepActivity ? 'Boss prep active' : 'Boss prep not active';
  const activityDetail = isBossFightActivity
    ? `${boss.name} is currently the active fight activity.`
    : isBossPrepActivity
      ? `${boss.name} is the active prep target. Roaming is paused.`
      : 'Sync this boss into active prep before combat can resolve.';

  const sim = useMemo(() => {
    return simulateBoss({
      primary,
      secondary,
      heavy,
      ordnance,
      shield,
      classMod,
      relic,
      consumables: selectedConsumables,
      risk,
      boss,
      playerLevel: player.level,
      skillBonuses: skillStore.getBonuses(),
      pityCount: bossStore.pityCounters[boss.id] || 0,
      playerCredits: player.credits,
    });
  }, [primary, secondary, heavy, ordnance, shield, classMod, relic, selectedConsumables, risk, boss, player.level, player.credits, skillStore, bossStore.pityCounters]);

  const winBand = sim.winChance >= 0.95 ? 'Farmable' : sim.winChance >= 0.75 ? 'Favorable' : sim.winChance >= 0.5 ? 'Risky' : sim.winChance >= 0.25 ? 'Underdog' : sim.winChance >= 0.05 ? 'Desperate' : 'Nearly Impossible';
  const bandColor = sim.winChance >= 0.75 ? 'text-green' : sim.winChance >= 0.5 ? 'text-amber' : sim.winChance >= 0.25 ? 'text-orange-400' : 'text-red';
  const projectedFailure = sim.projectedFailurePhase;
  // Player power for the recommended-power delta. We use the boss-relative
  // DPS as the comparison point because it's the same number that the sim
  // already considers when computing win chance — comparing two different
  // metrics (effective DPS vs recommended power) is what the user would do
  // mentally anyway. recommendedPower is on a different scale (abstract
  // power units) so we surface the comparison as a percentage delta, not
  // a raw subtraction.
  const playerPower = sim.effectiveDPS;

  const setConsumableForSlot = (slot: ConsumableSlot, type: string | null) => {
    setError(null);
    loadout.setConsumableSlot(slot, type);
  };

  const syncBossPrepActivity = async () => {
    try {
      // The prep phase is now just a sub-state of boss_fight — we
      // build the same activity shape with bossPhase='prep' rather
      // than starting a distinct 'boss_prep' activity.
      await activity.start(buildBossFightActivity(boss, activityWeapon, 'prep'));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to set boss prep activity.');
    }
  };

  const handleFight = async () => {
    if (!selectionAvailable) {
      setError('Selected consumables are not available in your inventory.');
      return;
    }
    if (!isBossPrepActivity) {
      setError('Boss combat requires this boss to be the active boss prep activity first.');
      return;
    }

    setSimulating(true);
    setError(null);
    setResult(null);

    // Flip the existing prep activity into the fight phase. This avoids
    // racing the chef with a fresh `start()` call — the boss_id and
    // target_id are preserved on the same activity, just the phase flips.
    activity.setBossPhase('fight');

    let outcome: ChefVerifyBossResult;
    try {
      outcome = await verifyBossFight({
        playerId: player.id,
        bossId: boss.id,
        attemptNonce: Date.now(),
        primary,
        secondary,
        heavy,
        ordnance,
        shield,
        classMod,
        relic,
        consumables: selectedConsumables,
        risk,
        playerLevel: player.level,
        skillBonuses: skillStore.getBonuses(),
        pityCount: bossStore.pityCounters[boss.id] || 0,
        playerCredits: player.credits,
      });
      syncBossAttemptResult(outcome);
      applyBossConsumableDisplayEvents({
        attemptId: outcome.result.id,
        consumedConsumables: outcome.consumedConsumables,
      });
    } catch (chefError) {
      setSimulating(false);
      setError(chefError instanceof Error ? chefError.message : 'Chef boss attempt failed.');
      return;
    }

    // Set up the fight timeline so the fight card can render the animation
    // (or the reduced-motion skip). The animation walks the phase
    // boundaries; the player/boss HP bar values interpolate linearly. The
    // initial values are derived from the sim outcome: victory starts the
    // boss at 100% and walks it down; defeat starts the boss at the
    // bossHpRemaining percentage and leaves it there.
    const shieldHpValue = shield?.hp ?? 0;
    const initialTimeline: FightTimeline = buildInitialTimeline(
      outcome,
      boss.health,
      player.level,
      shieldHpValue
    );
    setFightTimeline(initialTimeline);

    const cancel = { cancelled: false };
    animationCancelRef.current = cancel;
    // The animation callback receives a per-phase snapshot and pushes it
    // into state, so the fight card's HP bars tick in real time rather
    // than jumping from initial to final. With reduced-motion, the
    // callback is never called and the fight card shows the final state.
    const onPhase = (snapshot: FightTimeline) => setFightTimeline(snapshot);
    const finalTimeline = await runFightAnimation(
      initialTimeline,
      sim.phaseAnalyses,
      reducedMotion === true,
      cancel,
      onPhase
    );
    if (cancel.cancelled) return; // a new fight started before this one finished

    setFightTimeline({ ...finalTimeline, finishedAt: performance.now() });
    setResult(outcome);
    setSimulating(false);

    try {
      await activity.clear();
    } catch (nextError) {
      console.warn('Boss activity clear skipped:', nextError);
    }
  };

  // If the user closes the modal or starts a new fight mid-animation,
  // cancel the running animation so it doesn't fight with the new state.
  useEffect(() => {
    return () => {
      animationCancelRef.current.cancelled = true;
    };
  }, []);

  const reset = () => {
    setResult(null);
    setError(null);
    setFightTimeline(null);
  };

  const getRarityColor = (rarity?: string) => RARITIES[rarity as keyof typeof RARITIES]?.color || RARITIES.Common.color;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/80 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BossPortrait bossId={boss.id} size={56} animate />
            <div>
              <div className="bl-title text-3xl leading-none text-text-primary">{boss.name}</div>
              <div className="text-xs text-text-muted">Tier {boss.tier} • Lv.{boss.level}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bl-secondary">
            <X size={20} />
          </button>
        </div>

        <MobileCard className="space-y-2 border-amber/30 bg-amber/5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber">
            <span style={{ fontSize: 14 }}>📡</span>
            {activityLabel}
          </div>
          <div className="text-[10px] text-text-secondary leading-relaxed">{activityDetail}</div>
          {!isBossPrepActivity && !isBossFightActivity && !result && (
            <button
              type="button"
              onClick={syncBossPrepActivity}
              disabled={activity.pending}
              className="rounded-lg border border-amber/30 bg-amber/10 px-2 py-1 text-[10px] font-bold text-amber disabled:opacity-50"
            >
              Sync Boss Prep
            </button>
          )}
        </MobileCard>

        <MobileCard className="space-y-2">
          {/* Boss vitals: HP / Shield / Armor as proportional bars. Each bar
              animates from 0 to its value on first mount (300ms) — the "this
              is a beefy boss" feeling. The bar max is the boss's own value
              (1:1 visualization per hud-component-plan.md PR #2 §4.1
              decision (a)). Idle-game convention: thicker HP bar, thinner
              shield/armor bars below. */}
          <BossVitalsBars boss={boss} />
          <div className="flex flex-wrap gap-2">
            {boss.tags.map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised border border-border-light text-text-secondary font-bold">
                {tag}
              </span>
            ))}
            {boss.weaknesses.map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green font-bold">Weak: {e}</span>
            ))}
            {boss.resistances.map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-red/10 text-red font-bold">Resist: {e}</span>
            ))}
          </div>
          <div className="text-[10px] text-amber">{boss.mechanic.description}</div>
        </MobileCard>

        <BossReadinessCard boss={boss} playerPower={playerPower} />

        {!result && !fightTimeline && (
          <div className="grid grid-cols-3 gap-3">
            <MobileCard className="text-center space-y-1">
              <div className="text-xs text-text-muted uppercase tracking-wider">Win Chance</div>
              <div className={`font-mono text-3xl font-black ${bandColor}`}>{(sim.winChance * 100).toFixed(1)}%</div>
              <div className={`text-sm font-bold ${bandColor}`}>{winBand}</div>
              <div className="text-[10px] text-text-muted">Death fee: {sim.deathFee.toLocaleString()}cr</div>
            </MobileCard>
            <MobileCard className="text-center space-y-1">
              <div className="text-xs text-text-muted uppercase tracking-wider">Time to Kill</div>
              <div className="font-mono text-3xl font-black text-red">
                {sim.timeToKill >= 999 ? '∞' : `${sim.timeToKill.toFixed(1)}s`}
              </div>
              <div className="text-sm font-bold text-text-secondary">@ {sim.effectiveDPS.toFixed(0)} DPS</div>
              <div className="text-[10px] text-text-muted">vs {boss.health.toLocaleString()} HP</div>
            </MobileCard>
            <MobileCard className="space-y-1">
              <div className="text-xs text-text-muted uppercase tracking-wider">Projected Failure</div>
              <div className={`text-sm font-black ${projectedFailure ? PHASE_STATUS_COLOR[projectedFailure.status] : 'text-green'}`}>
                {projectedFailure ? projectedFailure.phaseName : 'None'}
              </div>
              <div className="text-[10px] text-text-secondary leading-snug">
                {projectedFailure ? projectedFailure.explanation : 'Current prep answers every modeled phase.'}
              </div>
            </MobileCard>
          </div>
        )}

        {/* The fight card replaces the win-chance grid mid-fight. It
            renders the animated HP bars and phase markers driven by the
            fightTimeline state (see runFightAnimation above). */}
        {!result && fightTimeline && (
          <FightCard timeline={fightTimeline} phases={sim.phaseAnalyses} bossName={boss.name} bossId={boss.id} reducedMotion={reducedMotion} />
        )}

        {/* Hide the phase-plan and current-answers sections during the
            fight animation — the fight card is doing the visual work
            there. The plan re-appears in the post-fight view via the
            result card's reasons. */}
        {!result && !fightTimeline && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase flex items-center gap-2">
              <span style={{ fontSize: 14 }}>📡</span>
              Phase Plan
            </div>
            {/* Segmented timeline — tap a segment to jump to the
                corresponding phase card below. The timeline is the
                only place in the modal that shows the *order* of the
                phases. The card list shows them but not as a flow. */}
            <BossPhaseTimeline phases={sim.phaseAnalyses} onSelect={scrollToPhase} />
            {sim.phaseAnalyses.map((phase) => (
              <div
                key={phase.phaseId}
                data-phase-id={phase.phaseId}
                ref={setPhaseCardRef(phase.phaseId)}
                className={`rounded-xl bg-surface p-3 border-2 ${PHASE_STATUS_BORDER[phase.status]} space-y-2`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-text-primary">{phase.phaseName}</div>
                    <div className="text-[10px] text-text-secondary leading-snug">{phase.explanation}</div>
                  </div>
                  <div className={`text-[10px] font-black uppercase ${PHASE_STATUS_COLOR[phase.status]}`}>{phase.status}</div>
                </div>
                <div className="text-[10px] text-text-muted">Score {(phase.score * 100).toFixed(0)}%</div>
                {phase.currentAnswers.length > 0 && (
                  <div className="text-[10px] text-green">Answers: {phase.currentAnswers.join(', ')}</div>
                )}
                {phase.missingCounters.length > 0 && (
                  <div className="text-[10px] text-amber">Missing: {phase.missingCounters.join(', ')}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {!result && (
          <div className="grid grid-cols-1 gap-3">
            <MobileCard className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase">
                <span style={{ fontSize: 14 }}>◎</span>
                Current Answers
              </div>
              {sim.equippedAnswers.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sim.equippedAnswers.slice(0, 12).map((answer) => (
                    <span key={answer} className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green font-bold">
                      {answer}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-text-secondary">No clear boss counters detected in the current loadout.</div>
              )}
            </MobileCard>

            <MobileCard className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-text-muted uppercase">
                <AlertTriangle size={14} />
                Missing Counters
              </div>
              {sim.missingCounters.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {sim.missingCounters.map((counter) => (
                    <span key={counter} className="text-[10px] px-1.5 py-0.5 rounded bg-amber/10 text-amber font-bold">
                      {counter}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-green">Every modeled phase has at least one answer.</div>
              )}
            </MobileCard>
          </div>
        )}

        {!result && sim.reasons.length > 0 && (
          <div className="space-y-1">
            {sim.reasons.map((r, i) => (
              <div key={i} className="text-xs text-text-secondary flex items-start gap-2">
                <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber" />
                {r}
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-text-muted uppercase">Loadout</div>
            <div
              className="border-2 border-border bg-bg/85 px-2 py-1 text-right"
              style={{ clipPath: 'polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px)' }}
              data-testid="bossprep-loadout-dps"
            >
              <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">vs {boss.name}</div>
              <div className="text-sm font-black text-red">{loadoutDpsVsBoss.toLocaleString()} DPS</div>
            </div>
          </div>
          {loadoutDpsPerWeapon.map(({ slot, weapon, dpsVsBoss, matchesWeakness, matchesResistance }) => (
            <div
              key={slot}
              className="flex items-center gap-3 bg-surface rounded-xl p-2 border-2 border-border shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
              style={{ borderLeftColor: weapon ? getRarityColor(weapon.rarity) : undefined, borderLeftWidth: weapon ? 5 : undefined }}
            >
              {weapon && <WeaponCanvas type={weapon.weaponType} manufacturer={weapon.manufacturer} element={weapon.element} rarity={weapon.rarity} size={40} />}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold truncate" style={{ color: weapon ? getRarityColor(weapon.rarity) : undefined }}>{weapon?.name || 'Empty'}</div>
                <div className="flex items-center gap-1.5 text-[9px] font-mono text-text-muted">
                  <span>⚡ {weapon ? Math.round(weapon.bossPower).toLocaleString() : '—'} bossPower</span>
                  {weapon && <span className={matchesWeakness ? 'text-green font-bold' : matchesResistance ? 'text-red font-bold' : 'text-text-muted'}>{matchesWeakness ? '✓ counter' : matchesResistance ? '✗ resisted' : '○ neutral'}</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{slot}</div>
                <div className="text-sm font-black text-red">{Math.round(dpsVsBoss).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>

        {!result && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase">Boss Consumables</div>
            {CONSUMABLE_SLOTS.map((slot) => {
              const selectedId = equippedConsumables[slot];
              const selected = selectedId ? CONSUMABLES[selectedId] : null;
              return (
                <MobileCard key={slot} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-black text-text-primary">{SLOT_LABELS[slot]}</div>
                      <div className="text-[10px] text-text-muted">{selected?.tacticalRole || 'No consumable selected'}</div>
                    </div>
                    <select
                      value={selectedId || ''}
                      onChange={(e) => setConsumableForSlot(slot, e.target.value || null)}
                      className="max-w-[58%] bg-surface border-2 border-border rounded-xl px-2 py-2 text-xs text-text-primary"
                    >
                      <option value="">Empty</option>
                      {getConsumablesForSlot(slot).map((c) => {
                        const selectedCount = Object.values(equippedConsumables).filter((id) => id === c.id).length;
                        const owned = player.getConsumableCount(c.id);
                        const available = owned > 0 || selectedId === c.id;
                        const remaining = owned - (selectedId === c.id ? selectedCount - 1 : selectedCount);
                        return (
                          <option key={c.id} value={c.id} disabled={!available}>
                            {c.name} ({remaining}/{owned})
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {selected && (
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber/10 text-amber font-bold">{selected.tacticalRole}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary">{selected.family}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary">{selected.trigger}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary">{selected.consumePolicy}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green">{STATUS_LABEL[selected.implementationStatus]}</span>
                      </div>
                      <div className="text-[10px] text-text-secondary">{selected.shortDescription}</div>
                      <div className="flex flex-wrap gap-1">
                        {selected.counterTags.map((tag) => (
                          <span key={tag} className="text-[10px] text-text-muted">#{tag}</span>
                        ))}
                      </div>
                      <div className="text-[10px] text-text-muted">{selected.uiHints[0]}</div>
                    </div>
                  )}
                </MobileCard>
              );
            })}
            {!selectionAvailable && (
              <div className="text-xs text-red flex items-center gap-2">
                <AlertTriangle size={12} /> Selected loadout exceeds owned consumable counts.
              </div>
            )}
          </div>
        )}

        {!result && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase flex items-center gap-2">
              <span style={{ fontSize: 14 }}>◔</span>
              Risk Profile
            </div>
            <div className="grid grid-cols-4 gap-2">
              {Object.values(RiskSetting).map((r) => (
                <button
                  key={r}
                  onClick={() => setRisk(r)}
                  className={`py-2 rounded-xl text-[10px] font-bold transition-colors ${risk === r ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-text-secondary">{sim.riskSummary}</div>
          </div>
        )}

        {!result && (
          <MobileCard className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase">Consumables At Risk</div>
            {sim.consumablesAtRisk.length > 0 ? (
              sim.consumablesAtRisk.map((riskLine) => (
                <div key={riskLine} className="text-[10px] text-text-secondary flex items-start gap-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5 text-amber" />
                  {riskLine}
                </div>
              ))
            ) : (
              <div className="text-[10px] text-text-secondary">No selected consumables are currently tied to risky phases.</div>
            )}
          </MobileCard>
        )}

        {error && <div className="text-xs text-red">{error}</div>}

        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`rounded-xl p-4 text-center space-y-2 border ${result.result.victory ? 'bg-green/10 border-green/30' : 'bg-red/10 border-red/30'}`}
            >
              {result.result.victory ? (
                <>
                  <CheckCircle size={40} className="mx-auto text-green" />
                  <div className="text-xl font-black text-green">BOSS DEFEATED</div>
                  <div className="text-xs text-text-secondary">+{result.creditsDelta.toLocaleString()} credits</div>
                  <div className="text-xs text-text-secondary">+{result.xpAwarded.toLocaleString()} XP</div>
                  {result.bonusLootRolls > 0 && (
                    <div className="text-xs text-amber flex justify-center items-center gap-1">
                      <span className="shrink-0 font-black" style={{ color: getResourceVisual('loot').color, fontSize: '12px' }}>{getResourceVisual('loot').mark}</span> +{result.bonusLootRolls} bonus loot roll{result.bonusLootRolls > 1 ? 's' : ''}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <BossSigil bossId={boss.id} size={40} className="mx-auto" />
                  <div className="text-xl font-black text-red">DEFEATED</div>
                  <div className="text-xs text-text-secondary">Failed during {result.result.phaseFailed} phase</div>
                  <div className="text-xs text-text-secondary">Boss HP remaining: {result.result.bossHpRemaining}%</div>
                  <div className="text-xs text-red">-{result.result.creditsLost.toLocaleString()} credits (death fee)</div>
                  <div className="text-[10px] text-text-muted mt-1">{result.result.recommendations[0]}</div>
                </>
              )}
              {Object.keys(result.consumedConsumables).length > 0 && (
                <div className="text-[10px] text-text-muted">
                  Used: {Object.entries(result.consumedConsumables).map(([id, count]) => `${CONSUMABLES[id]?.name || id} x${count}`).join(', ')}
                </div>
              )}
              <div className="space-y-1 pt-2">
                {result.result.reasons.slice(0, 3).map((reason) => (
                  <div key={reason} className="text-[10px] text-text-secondary">{reason}</div>
                ))}
                {result.result.recommendations[0] && (
                  <div className="text-[10px] text-amber">{result.result.recommendations[0]}</div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="shrink-0 p-4 border-t-2 border-border bg-surface">
        {result ? (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={reset} className="py-3 rounded-xl bl-primary font-bold text-sm">Fight Again</button>
            <button onClick={onClose} className="py-3 rounded-xl bl-secondary font-bold text-sm">Back</button>
          </div>
        ) : !isBossPrepActivity ? (
          <button
            onClick={syncBossPrepActivity}
            disabled={activity.pending}
            className="w-full py-4 rounded-xl bl-primary font-black text-sm uppercase tracking-wider disabled:opacity-50"
          >
            {activity.pending ? 'Syncing...' : 'SYNC BOSS PREP ACTIVITY'}
          </button>
        ) : (
          <button
            onClick={handleFight}
            disabled={simulating || !selectionAvailable || activity.pending}
            className="w-full py-4 rounded-xl bl-primary font-black text-sm uppercase tracking-wider disabled:opacity-50"
          >
            {simulating ? 'Simulating...' : 'INITIATE COMBAT'}
          </button>
        )}
      </div>
    </motion.div>
  );
};

// The walk-phases animation function lives in src/lib/animation/fightTimeline.ts
// so it can be unit-tested without bootstrapping the React tree. This
// module exports the FightCard subcomponent (and constants are re-imported
// from the animation module).

// Keep the FightCard component as a small subcomponent to keep the main
// BossPrepModal JSX clean. It only renders when simulating && !result.
const FightCard: React.FC<{ timeline: FightTimeline; phases: PhaseAnalysis[]; bossName: string; bossId: string; reducedMotion: boolean | null }> = ({ timeline, phases, bossName, bossId, reducedMotion }) => {
  const playerPct = timeline.playerHpMax > 0 ? (timeline.playerHp / timeline.playerHpMax) * 100 : 0;
  const bossPct = timeline.bossHpMax > 0 ? (timeline.bossHp / timeline.bossHpMax) * 100 : 0;
  const currentPhase = phases[Math.min(timeline.currentPhaseIndex, phases.length - 1)];
  const recentPopups = timeline.damageLog.slice(-3);

  return (
    <MobileCard className="space-y-2 border-red/30 bg-red/5">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red">
        <span style={{ fontSize: 14 }}>⚔</span>
        Combat Resolution
      </div>
      {/* Player HP bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span className="flex items-center gap-1"><span style={{ fontSize: 11 }} className="text-green">♥</span> Player</span>
          <span className="font-black text-text-primary">{timeline.playerHp.toLocaleString()} / {timeline.playerHpMax.toLocaleString()}</span>
        </div>
        <div className="relative h-4 overflow-hidden border-2 border-border bg-bg">
          <motion.div
            className="h-full bg-green"
            initial={{ width: `${(timeline.outcome?.result.victory ? 30 : 100)}%` }}
            animate={{ width: `${playerPct}%` }}
            transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18 }}
          />
        </div>
      </div>
      {/* Boss HP bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span className="flex items-center gap-1"><BossSigil bossId={bossId} size={14} showFrame={false} /> {bossName}</span>
          <span className="font-black text-text-primary">{timeline.bossHp.toLocaleString()} / {timeline.bossHpMax.toLocaleString()}</span>
        </div>
        <div className="relative h-4 overflow-hidden border-2 border-border bg-bg">
          <motion.div
            className="h-full bg-red"
            initial={{ width: '100%' }}
            animate={{ width: `${bossPct}%` }}
            transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 18 }}
          />
        </div>
      </div>
      {/* Phase marker */}
      {currentPhase && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-muted">Phase {Math.min(timeline.currentPhaseIndex + 1, phases.length)} / {phases.length}</span>
          <span className={`font-black uppercase ${PHASE_STATUS_COLOR[currentPhase.status]}`}>{currentPhase.phaseName}</span>
        </div>
      )}
      {/* Recent damage popups */}
      {recentPopups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {recentPopups.map((popup) => (
            <div
              key={popup.id}
              className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${
                popup.target === 'boss'
                  ? 'border-red/40 bg-red/10 text-red'
                  : 'border-amber/40 bg-amber/10 text-amber'
              }`}
            >
              {popup.target === 'boss' ? '−' : '−'}{popup.value.toLocaleString()} <span className="text-text-muted">· {popup.phaseName}</span>
            </div>
          ))}
        </div>
      )}
    </MobileCard>
  );
};

