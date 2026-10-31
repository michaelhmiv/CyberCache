import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Lock } from 'lucide-react';
import type { BossDef, PhaseAnalysis } from '../../types/boss';
import { RiskSetting } from '../../types/game';
import { CONSUMABLES } from '../../constants/consumables';
import { LEGENDARY_EFFECTS } from '../../constants/legendaryEffects';
import { RARITIES } from '../../constants/rarities';
import { getBossRiskModifiers } from '../../lib/simulation/bossSimulator';
import { buildBossFightActivity } from '../../lib/activity/activityBuilders';
import { buildInitialTimeline, runFightAnimation, type FightTimeline } from '../../lib/animation/fightTimeline';
import { getActionSkillState, verifyBossFight, type ChefVerifyBossResult } from '../../lib/chef/chefClient';
import { ACTION_SKILL_DEFS, type ActionSkillStateView } from '@/content/actionSkills';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import type { SkillTreeType } from '@/types/game';
import { ActionSkillCard } from './ActionSkillCard';
import { bossFeeMultiplier, escalatedBossFee } from '../../lib/bossFees';
import { applyBossConsumableDisplayEvents } from '../../lib/chef/bossResultAdapter';
import { syncBossAttemptResult } from '../../lib/api/verifiedStateSync';
import { useActivityStore, useBossStore, useLoadoutStore, usePlayerStore } from '../../store';
import { MobileCard } from '../layout/MobileCard';
import { BossFightStage } from '../pixelArt/BossFightStage';
import { LootMoment } from '../pixelArt/LootMoment';
import { GhostHpBar } from '../pixelArt/PixelFx';
import { BossSigil } from '@/components/common/BossSigil';
import { BossPortrait } from '@/components/common/BossPortrait';
import { REGION_1_BOSSES } from '../../constants/bosses';
import type { Weapon } from '../../types/items';

/**
 * BossEncounterPanel — the shipped boss flow (Phase 0, Slice 1).
 *
 * Replaces BossPrepModal (deleted): the modal was unreachable, and the
 * panel that shipped in its place only set an activity flag — the
 * fight never resolved. This panel is the whole loop in the Fight
 * workspace:
 *
 *   prep → ONE Chef attempt (POST /api/verify-boss) → Sample-B-paced
 *   animation of the returned outcome → result (LootMoment on victory,
 *   real charged costs on defeat).
 *
 * Design law (owner directive): prep shows BOSS INTEL ONLY — the
 * boss's own stats, mechanic, phases, and declared counters, plus the
 * player's loadout and the consumables they choose to prepare. It
 * NEVER shows a win chance, a readiness %, or a "what you need"
 * verdict: figuring out whether the prep answers the boss is the
 * strategy. The client computes no outcome here — the Chef resolves
 * the attempt and persists fee, consumption, loot, pity, and unlocks.
 */

/** Idempotency nonce for one attempt — unique per user tap, stable per send. */
const nextAttemptNonce = (): number => Date.now();

const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };
const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };

type PanelStage = 'prep' | 'fighting' | 'result';

const rarityColor = (rarity?: string) => RARITIES[rarity as keyof typeof RARITIES]?.color || RARITIES.Common.color;

const legendaryName = (effectId: string) =>
  LEGENDARY_EFFECTS.find((eff) => eff.id === effectId)?.name ?? effectId;

/** Boss vitals as proportional bars — each pool sized against the largest. */
const BossVitals: React.FC<{ boss: BossDef }> = ({ boss }) => {
  const max = Math.max(1, boss.health, boss.shield, boss.armor);
  const rows = [
    { label: 'HP', glyph: '♥', value: boss.health, color: 'bg-red', text: 'text-red' },
    { label: 'Shield', glyph: '⚡', value: boss.shield, color: 'bg-cyan', text: 'text-cyan' },
    { label: 'Armor', glyph: '◈', value: boss.armor, color: 'bg-purple', text: 'text-purple' },
  ];
  return (
    <div className="space-y-1.5" data-testid="boss-vitals">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <div className="flex w-14 items-center gap-1 text-[9px] font-black uppercase text-text-muted">
            <span className={row.text} style={{ fontSize: 11 }}>{row.glyph}</span>{row.label}
          </div>
          <div className="relative h-2.5 flex-1 overflow-hidden border-2 border-border bg-bg" style={slashClip}>
            <motion.div
              className={`absolute inset-y-0 left-0 ${row.color}`}
              initial={{ width: 0 }}
              animate={{ width: `${(row.value / max) * 100}%` }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </div>
          <div className={`w-16 text-right font-mono text-[11px] font-black ${row.text}`}>{row.value.toLocaleString()}</div>
        </div>
      ))}
      <div className="flex items-center gap-2 text-[10px] text-text-muted">
        <span className="font-black uppercase">Boss DPS</span>
        <span className="font-mono font-black text-text-primary">{boss.dps.toLocaleString()}</span>
      </div>
    </div>
  );
};

/** Animated fight card — presentation of the Chef's already-decided outcome. */
const FightCard: React.FC<{
  timeline: FightTimeline;
  phases: PhaseAnalysis[];
  bossName: string;
  bossId: string;
  reducedMotion: boolean | null;
  weapon?: Weapon;
  /** Action skill (0030): the attempt's decided fire facts, if any —
   *  the stage treatment + the charge track draining to its
   *  post-attempt value. Presentation only. */
  actionSkillFire?: { tree: SkillTreeType; fired: boolean; chargeAfter: number } | null;
}> = ({ timeline, phases, bossName, bossId, reducedMotion, weapon, actionSkillFire }) => {
  const playerPct = timeline.playerHpMax > 0 ? (timeline.playerHp / timeline.playerHpMax) * 100 : 0;
  const bossPct = timeline.bossHpMax > 0 ? (timeline.bossHp / timeline.bossHpMax) * 100 : 0;
  const currentPhase = phases[Math.min(timeline.currentPhaseIndex, phases.length - 1)];
  const recentPopups = timeline.damageLog.slice(-3);
  const fireVisual = actionSkillFire ? getSkillTreeVisual(actionSkillFire.tree) : null;
  return (
    <MobileCard className="space-y-2 border-red/30 bg-red/5">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-red">
        <span style={{ fontSize: 14 }}>⚔</span>
        Combat Resolution
      </div>
      <BossFightStage
        timeline={timeline}
        phases={phases}
        bossId={bossId}
        weapon={weapon}
        reduced={reducedMotion === true}
        signatureFire={actionSkillFire?.fired ? actionSkillFire.tree : null}
      />
      {actionSkillFire && fireVisual && (
        <div className="space-y-1" data-testid="fight-action-skill-charge">
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span className="flex items-center gap-1">
              <span style={{ fontSize: 11, color: fireVisual.color }}>{fireVisual.sigil}</span>
              {ACTION_SKILL_DEFS[actionSkillFire.tree].name}
              {actionSkillFire.fired && <span className="font-black" style={{ color: fireVisual.color }}>FIRED</span>}
            </span>
            <span className="font-black text-text-primary">{Math.floor(actionSkillFire.chargeAfter)} charge</span>
          </div>
          <div className="relative h-2 overflow-hidden border-2 border-border bg-bg">
            <motion.div
              className="absolute inset-y-0 left-0"
              style={{ backgroundColor: fireVisual.color }}
              initial={{ width: actionSkillFire.fired ? '100%' : `${actionSkillFire.chargeAfter}%` }}
              animate={{ width: `${actionSkillFire.chargeAfter}%` }}
              transition={{ duration: reducedMotion ? 0 : 1.2, ease: 'easeOut', delay: 0.4 }}
            />
          </div>
        </div>
      )}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span className="flex items-center gap-1"><span style={{ fontSize: 11 }} className="text-green">♥</span> Player</span>
          <span className="font-black text-text-primary">{timeline.playerHp.toLocaleString()} / {timeline.playerHpMax.toLocaleString()}</span>
        </div>
        <GhostHpBar pct={playerPct} color="#4ADE80" reduced={reducedMotion === true} testId="fight-player-hp" />
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span className="flex items-center gap-1"><BossSigil bossId={bossId} size={14} showFrame={false} /> {bossName}</span>
          <span className="font-black text-text-primary">{timeline.bossHp.toLocaleString()} / {timeline.bossHpMax.toLocaleString()}</span>
        </div>
        <GhostHpBar pct={bossPct} color="#F87171" reduced={reducedMotion === true} testId="fight-boss-hp" />
      </div>
      {currentPhase && (
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-text-muted">Phase {Math.min(timeline.currentPhaseIndex + 1, phases.length)} / {phases.length}</span>
          <span className="font-black uppercase text-text-primary">{currentPhase.phaseName}</span>
        </div>
      )}
      {recentPopups.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {recentPopups.map((popup) => (
            <div
              key={popup.id}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-black ${
                popup.target === 'boss' ? 'border-red/40 bg-red/10 text-red' : 'border-amber/40 bg-amber/10 text-amber'
              }`}
            >
              −{popup.value.toLocaleString()} <span className="text-text-muted">· {popup.phaseName}</span>
            </div>
          ))}
        </div>
      )}
    </MobileCard>
  );
};

export const BossEncounterPanel: React.FC<{
  boss: BossDef;
  onChangeBoss: () => void;
  onLeave: () => void;
}> = ({ boss, onChangeBoss, onLeave }) => {
  const player = usePlayerStore();
  const bossStore = useBossStore();
  const loadout = useLoadoutStore();
  const activity = useActivityStore();
  const reducedMotion = useReducedMotion();

  const [stage, setStage] = useState<PanelStage>('prep');
  const [result, setResult] = useState<ChefVerifyBossResult | null>(null);
  const [lootMomentDone, setLootMomentDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fightTimeline, setFightTimeline] = useState<FightTimeline | null>(null);
  const animationCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Action skill (0030): the player's own signature state, from the
  // Chef's payloads only. `fireArmed` is pure intent — the server
  // validates selection, qualification, and charge at resolution.
  const [actionSkillView, setActionSkillView] = useState<ActionSkillStateView | null>(null);
  const [fireArmed, setFireArmed] = useState(false);
  const [fightActionSkill, setFightActionSkill] = useState<{
    tree: SkillTreeType; fired: boolean; chargeAfter: number;
  } | null>(null);
  const loadActionSkill = React.useCallback(() => {
    getActionSkillState()
      .then((r) => setActionSkillView(r.actionSkill))
      .catch(() => { /* the card renders its loading state */ });
  }, []);
  useEffect(() => { loadActionSkill(); }, [loadActionSkill]);

  // Switching targets resets the encounter surface: the parent keys
  // this panel by boss id, so a target change remounts it fresh.
  useEffect(() => () => {
    animationCancelRef.current.cancelled = true;
  }, []);

  const primary = loadout.getWeapon('primary') ?? null;
  const secondary = loadout.getWeapon('secondary') ?? null;
  const heavy = loadout.getWeapon('heavy') ?? null;
  const shield = loadout.getShield() || null;
  const ordnance = loadout.getOrdnance() || null;
  const classMod = loadout.getClassMod() || null;
  const relic = loadout.getRelic() || null;

  const defeated = bossStore.defeatedBossIds.includes(boss.id);
  const unlocked = defeated || bossStore.unlockedBossIds.includes(boss.id);
  // The fee the Chef will charge: def base fee under today's rematch
  // escalation (×2 per victory vs this boss today, capped ×8 — the
  // counts are server-reported; the attempt response's charged fee is
  // the final truth).
  const victoriesToday = bossStore.bossVictoriesToday[boss.id] ?? 0;
  const feeMultiplier = bossFeeMultiplier(victoriesToday);
  const entryFee = escalatedBossFee(defeated ? boss.rematchCost : boss.entryCost, victoriesToday);
  const canAfford = player.credits >= entryFee;

  // The prepared set is the player's strategy: exactly these counts go
  // to the Chef, which validates them against owned inventory and
  // charges exactly the policy-applied subset — nothing else burns.
  const prepared = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [type, count] of Object.entries(bossStore.preparedConsumables)) {
      const owned = player.getConsumableCount(type);
      const clamped = Math.max(0, Math.min(Math.floor(count) || 0, owned));
      if (clamped > 0) out[type] = clamped;
    }
    return out;
  }, [bossStore.preparedConsumables, player]);

  const preparedTotal = Object.values(prepared).reduce((sum, n) => sum + n, 0);

  const ownedConsumables = useMemo(
    () =>
      Object.values(CONSUMABLES)
        .map((def) => ({ def, owned: player.getConsumableCount(def.id) }))
        .filter(({ def, owned }) => owned > 0 || (bossStore.preparedConsumables[def.id] ?? 0) > 0)
        .sort((a, b) => a.def.name.localeCompare(b.def.name)),
    [player, bossStore.preparedConsumables],
  );

  // Animation scaffolding only: the phase names/order come from the
  // boss def. No scores are computed or shown — the Chef's returned
  // outcome drives the walk.
  const animationPhases: PhaseAnalysis[] = useMemo(
    () =>
      boss.phases.map((phase) => ({
        phaseId: phase.id,
        phaseName: phase.name,
        score: 0,
        status: 'close' as const,
        currentAnswers: [],
        missingCounters: [],
        relevantConsumables: [],
        explanation: phase.description,
      })),
    [boss],
  );

  const risk = bossStore.selectedRisk;
  const riskMods = getBossRiskModifiers(risk);

  const handleStart = async () => {
    if (!unlocked || !canAfford || stage !== 'prep') return;
    setError(null);
    setResult(null);
    setFightActionSkill(null);
    setLootMomentDone(false);
    setStage('fighting');

    // Stage the encounter as the active boss_fight activity for this
    // boss (the diorama reads it), then resolve with ONE Chef attempt.
    try {
      const current = activity.current;
      const isThisBoss = current.kind === 'boss_fight' && current.targetType === 'boss' && current.targetId === boss.id;
      if (!isThisBoss) {
        await activity.start(buildBossFightActivity(boss, primary ?? undefined, 'fight'));
      } else if (current.bossPhase !== 'fight') {
        activity.setBossPhase('fight');
      }
    } catch (stageError) {
      setStage('prep');
      setError(stageError instanceof Error ? stageError.message : 'Unable to stage the boss encounter.');
      return;
    }

    let outcome: ChefVerifyBossResult;
    try {
      // Intent only (trust hardening, Phase 0 Slice 6): the Chef
      // derives the loadout, skill bonuses, level, credits, and pity
      // from its own records — the panel's loadout reads above are
      // for display and staging, never sent as sim inputs.
      outcome = await verifyBossFight({
        playerId: player.id,
        bossId: boss.id,
        attemptNonce: nextAttemptNonce(),
        consumables: prepared,
        risk,
        fireActionSkill: fireArmed,
      });
      setFireArmed(false);
      setFightActionSkill(outcome.result.actionSkill
        ? {
            tree: outcome.result.actionSkill.tree as SkillTreeType,
            fired: outcome.result.actionSkill.fired,
            chargeAfter: outcome.actionSkill?.charge ?? actionSkillView?.charge ?? 0,
          }
        : null);
      // Refresh the signature state from the server's own view —
      // the attempt changed the charge (spent on a fire, or accrued).
      loadActionSkill();
      syncBossAttemptResult(outcome);
      applyBossConsumableDisplayEvents({
        attemptId: outcome.result.id,
        consumedConsumables: outcome.consumedConsumables,
      });
    } catch (chefError) {
      setStage('prep');
      setError(chefError instanceof Error ? chefError.message : 'Chef boss attempt failed.');
      return;
    }

    const initialTimeline = buildInitialTimeline(outcome, boss.health, player.level, shield?.hp ?? 0);
    setFightTimeline(initialTimeline);
    const cancel = { cancelled: false };
    animationCancelRef.current = cancel;
    const finalTimeline = await runFightAnimation(
      initialTimeline,
      animationPhases,
      reducedMotion === true,
      cancel,
      (snapshot) => setFightTimeline(snapshot),
    );
    if (cancel.cancelled) return;
    setFightTimeline(finalTimeline);
    setResult(outcome);
    setStage('result');
  };

  const fightAgain = () => {
    animationCancelRef.current.cancelled = true;
    animationCancelRef.current = { cancelled: false };
    setResult(null);
    setError(null);
    setFightTimeline(null);
    setFightActionSkill(null);
    setLootMomentDone(false);
    setStage('prep');
    activity.setBossPhase('prep');
    loadActionSkill();
  };

  const loadoutRows: Array<{ slot: string; name: string | null; rarity?: string; detail?: string }> = [
    { slot: 'Primary', name: primary?.name ?? null, rarity: primary?.rarity, detail: primary ? `${primary.element} ${primary.weaponType}` : undefined },
    { slot: 'Secondary', name: secondary?.name ?? null, rarity: secondary?.rarity, detail: secondary ? `${secondary.element} ${secondary.weaponType}` : undefined },
    { slot: 'Heavy', name: heavy?.name ?? null, rarity: heavy?.rarity, detail: heavy ? `${heavy.element} ${heavy.weaponType}` : undefined },
    { slot: 'Shield', name: shield?.name ?? null, rarity: shield?.rarity, detail: shield ? `${shield.hp} HP` : undefined },
    { slot: 'Ordnance', name: ordnance?.name ?? null, rarity: ordnance?.rarity, detail: ordnance ? `${ordnance.element}` : undefined },
    { slot: 'Class Mod', name: classMod?.name ?? null, rarity: classMod?.rarity, detail: classMod ? classMod.treeBonus : undefined },
    { slot: 'Relic', name: relic?.name ?? null, rarity: relic?.rarity },
  ];

  const bossLootItems = result?.result.victory ? (result.items?.length ? result.items : result.loot) : undefined;
  const unlockedBoss = result?.unlockedBossId ? REGION_1_BOSSES.find((b) => b.id === result.unlockedBossId) : undefined;
  const pityNow = bossStore.pityCounters[boss.id] || 0;

  return (
    <div className="space-y-3" data-testid="boss-encounter-panel">
      {/* Header */}
      <div className="relative overflow-hidden border-2 border-red/40 bg-red/[0.06] p-3" style={panelClip}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <BossPortrait bossId={boss.id} size={48} animate />
            <div>
              <div className="text-lg font-black leading-tight text-text-primary">{boss.name}</div>
              <div className="text-[10px] text-text-muted">Tier {boss.tier} · Lv.{boss.level} · {boss.phases.length} phase{boss.phases.length === 1 ? '' : 's'}</div>
            </div>
          </div>
          <button type="button" onClick={onChangeBoss} className="bl-secondary shrink-0 px-2 py-1 text-[9px] font-black text-amber">
            Change Boss
          </button>
        </div>
        <div className="mt-3">
          <BossVitals boss={boss} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {boss.weaknesses.map((e) => (
            <span key={`w-${e}`} className="border border-green/30 bg-green/10 px-1.5 py-0.5 text-[9px] font-bold text-green">Weak: {e}</span>
          ))}
          {boss.resistances.map((e) => (
            <span key={`r-${e}`} className="border border-red/30 bg-red/10 px-1.5 py-0.5 text-[9px] font-bold text-red">Resist: {e}</span>
          ))}
          {boss.tags.map((tag) => (
            <span key={tag} className="border border-border bg-surface px-1.5 py-0.5 text-[9px] font-bold text-text-secondary">{tag}</span>
          ))}
        </div>
        <div className="mt-2 border-t border-border/40 pt-2 text-[10px] leading-snug text-text-secondary">
          <span className="font-black text-amber">{boss.mechanic.name}: </span>
          {boss.mechanic.description}
        </div>
        <div className="mt-1 text-[10px] text-text-muted">
          Dedicated drops: {boss.dedicatedDrops.map(legendaryName).join(' · ') || 'None'}
        </div>
      </div>

      {stage === 'fighting' && fightTimeline && (
        <FightCard
          timeline={fightTimeline}
          phases={animationPhases}
          bossName={boss.name}
          bossId={boss.id}
          reducedMotion={reducedMotion}
          weapon={primary ?? undefined}
          actionSkillFire={fightActionSkill}
        />
      )}

      {stage === 'prep' && (
        <>
          {/* Phase intel — what the boss does, in order. Intel only. */}
          <MobileCard className="space-y-2">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Phase Intel</div>
            {boss.phases.map((phase, index) => (
              <div key={`${boss.id}-${phase.id}-${index}`} className="border-2 border-border bg-bg/70 p-2" style={slashClip}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-black text-text-primary">{index + 1}. {phase.name}</div>
                  <span className="text-[9px] font-black uppercase text-amber">{phase.type}</span>
                </div>
                <div className="mt-1 text-[10px] leading-snug text-text-muted">{phase.description}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {phase.recommendedCounters.map((counter) => (
                    <span key={counter} className="border border-border bg-surface px-1.5 py-0.5 text-[9px] text-text-secondary">{counter}</span>
                  ))}
                </div>
              </div>
            ))}
          </MobileCard>

          {/* Loadout summary — what you're bringing (change it in the Loadout bench). */}
          <MobileCard className="space-y-1.5">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Your Loadout</div>
            {loadoutRows.map((row) => (
              <div key={row.slot} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="w-20 shrink-0 font-black uppercase text-text-muted">{row.slot}</span>
                {row.name ? (
                  <span className="min-w-0 flex-1 truncate text-right font-bold" style={{ color: rarityColor(row.rarity) }}>
                    {row.name}
                    {row.detail && <span className="ml-1.5 font-normal text-text-muted">{row.detail}</span>}
                  </span>
                ) : (
                  <span className="flex-1 text-right text-text-muted">Empty</span>
                )}
              </div>
            ))}
          </MobileCard>

          {/* Prepared consumables — the strategic choice. Counts are
              capped at owned; the Chef honors exactly this set. */}
          <MobileCard className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Prepare Consumables</div>
              <div className="text-[9px] text-text-muted">{preparedTotal} prepared</div>
            </div>
            {ownedConsumables.length === 0 && (
              <div className="text-[10px] text-text-muted">You own no consumables. Buy them from the Vendor or craft them at the Workshop — the boss will not wait.</div>
            )}
            {ownedConsumables.map(({ def, owned }) => {
              const count = prepared[def.id] ?? 0;
              return (
                <div key={def.id} className="flex items-center gap-2 border border-border bg-bg/70 p-2" style={slashClip}>
                  <span style={{ fontSize: 14 }} className="shrink-0">{def.visual.glyph}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-black text-text-primary">{def.name}</div>
                    <div className="truncate text-[9px] text-text-muted">{def.shortDescription}</div>
                    <div className="text-[9px] text-text-muted">Owned {owned} · spent: {def.consumePolicy}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Prepare fewer ${def.name}`}
                      onClick={() => bossStore.setConsumablePrep(def.id, Math.max(0, count - 1))}
                      className="bl-secondary px-2 py-1 text-xs font-black disabled:opacity-40"
                      disabled={count <= 0}
                    >
                      −
                    </button>
                    <span className="w-6 text-center font-mono text-xs font-black text-text-primary" data-testid={`prepared-${def.id}`}>{count}</span>
                    <button
                      type="button"
                      aria-label={`Prepare more ${def.name}`}
                      onClick={() => bossStore.setConsumablePrep(def.id, Math.min(owned, count + 1))}
                      className="bl-secondary px-2 py-1 text-xs font-black disabled:opacity-40"
                      disabled={count >= owned}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </MobileCard>

          {/* Risk profile — the engine's own setting, now selectable. */}
          <MobileCard className="space-y-2">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Risk Profile</div>
            <div className="grid grid-cols-4 gap-2">
              {Object.values(RiskSetting).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => bossStore.setRisk(r)}
                  className={`rounded-xl py-2 text-[10px] font-bold ${risk === r ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-text-secondary">
              Survival ×{riskMods.survivalMult} · DPS ×{riskMods.dpsMult} · Consumable use ×{riskMods.consumableMult} · Chaos {riskMods.chaos >= 0 ? '+' : ''}{(riskMods.chaos * 100).toFixed(0)}%
            </div>
          </MobileCard>

          {/* Action skill — the player's own signature state (0030).
              Their data only; nothing about the boss. */}
          <ActionSkillCard
            state={actionSkillView}
            armed={fireArmed}
            onToggleArmed={setFireArmed}
            chargeSourceNote="Charges through boss attempts and endless fights — fire it when full for a fight-swinging moment."
          />

          {error && (
            <div className="flex items-start gap-2 border-2 border-red/40 bg-red/10 p-2 text-[11px] text-red">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {!unlocked ? (
            <div className="flex items-start gap-2 border-2 border-border bg-bg/70 p-3 text-[11px] text-text-secondary" style={slashClip}>
              <Lock size={14} className="mt-0.5 shrink-0 text-amber" />
              Locked — defeat the previous boss to unlock {boss.name}.
            </div>
          ) : (
            <button
              type="button"
              data-testid="boss-start"
              onClick={handleStart}
              disabled={!canAfford || activity.pending}
              className="bl-primary w-full py-3 text-xs font-black uppercase tracking-wider disabled:opacity-50"
            >
              {activity.pending
                ? 'Staging…'
                : entryFee > 0
                  ? `Start Boss Encounter — ${entryFee.toLocaleString()}cr ${defeated ? 'rematch' : 'entry'}`
                  : 'Start Boss Encounter — Free Entry'}
            </button>
          )}
          {unlocked && !canAfford && (
            <div className="text-center text-[10px] text-red">You hold {player.credits.toLocaleString()}cr — the {entryFee.toLocaleString()}cr fee is out of reach.</div>
          )}
          {unlocked && defeated && (
            <div className="text-center text-[10px] text-text-muted">Already defeated — rematches cost {entryFee.toLocaleString()}cr and can drop its dedicated legendaries again.</div>
          )}
          {unlocked && feeMultiplier > 1 && (
            <div className="text-center text-[10px] text-amber">Rematch fee escalated ×{feeMultiplier} — {victoriesToday} {victoriesToday === 1 ? 'victory' : 'victories'} today. Resets at 00:00 UTC.</div>
          )}
        </>
      )}

      {stage === 'result' && result && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`space-y-2 border-2 p-4 text-center ${result.result.victory ? 'border-green/40 bg-green/10' : 'border-red/40 bg-red/10'}`}
          style={panelClip}
          data-testid="boss-result"
        >
          {result.result.victory ? (
            <>
              <CheckCircle size={38} className="mx-auto text-green" />
              <div className="text-xl font-black text-green">BOSS DEFEATED</div>
              <div className="text-xs text-text-secondary">
                Credits {result.creditsDelta >= 0 ? '+' : ''}{result.creditsDelta.toLocaleString()} net
                {result.entryFee > 0 && <span className="text-text-muted"> (after the {result.entryFee.toLocaleString()}cr {defeated ? 'rematch' : 'entry'} fee)</span>}
              </div>
              <div className="text-xs text-text-secondary">+{result.xpAwarded.toLocaleString()} XP</div>
              {result.dedicatedDropAwarded && (
                <div className="text-xs font-black text-amber">★ Dedicated drop — one of {boss.name}&apos;s signature legendaries</div>
              )}
              {result.bonusLootRolls > 0 && (
                <div className="text-xs text-amber">+{result.bonusLootRolls} bonus loot roll{result.bonusLootRolls > 1 ? 's' : ''} from your prep</div>
              )}
              {unlockedBoss && <div className="text-xs font-black text-cyan">Unlocked: {unlockedBoss.name}</div>}
            </>
          ) : (
            <>
              <BossSigil bossId={boss.id} size={38} className="mx-auto" />
              <div className="text-xl font-black text-red">DEFEATED</div>
              {result.result.phaseFailed && <div className="text-xs text-text-secondary">Failed during the {result.result.phaseFailed} phase</div>}
              {typeof result.result.bossHpRemaining === 'number' && (
                <div className="text-xs text-text-secondary">Boss HP remaining: {result.result.bossHpRemaining}%</div>
              )}
              {result.entryFee > 0 && <div className="text-xs text-red">−{result.entryFee.toLocaleString()} credits (entry fee)</div>}
              {result.result.creditsLost - result.entryFee > 0 && (
                <div className="text-xs text-red">−{(result.result.creditsLost - result.entryFee).toLocaleString()} credits (death fee)</div>
              )}
              <div className="text-[10px] text-text-muted">Pity banked vs {boss.name}: {pityNow} loss{pityNow === 1 ? '' : 'es'} (+3% per loss, cap +30%)</div>
            </>
          )}
          {result.result.actionSkill?.fired && (
            <div className="text-xs font-black" style={{ color: getSkillTreeVisual(result.result.actionSkill.tree as SkillTreeType).color }} data-testid="boss-result-action-skill">
              {getSkillTreeVisual(result.result.actionSkill.tree as SkillTreeType).sigil} {ACTION_SKILL_DEFS[result.result.actionSkill.tree as SkillTreeType].name} fired
            </div>
          )}
          {Object.keys(result.consumedConsumables).length > 0 && (
            <div className="text-[10px] text-text-muted">
              Used: {Object.entries(result.consumedConsumables).map(([id, count]) => `${CONSUMABLES[id]?.name || id} x${count}`).join(', ')}
            </div>
          )}
          <div className="space-y-1 pt-1">
            {result.result.reasons.slice(0, 3).map((reason) => (
              <div key={reason} className="text-[10px] text-text-secondary">{reason}</div>
            ))}
            {result.result.recommendations[0] && (
              <div className="text-[10px] text-amber">{result.result.recommendations[0]}</div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button type="button" onClick={fightAgain} className="bl-primary py-2.5 text-xs font-black">Fight Again</button>
            <button type="button" onClick={onLeave} className="bl-secondary py-2.5 text-xs font-black text-text-secondary">Leave Encounter</button>
          </div>
        </motion.div>
      )}

      {/* Boss LootMoment over the victory result — the rarity ladder
          for the drops the Chef actually awarded (already synced to
          the inventory; the moment is celebration, not delivery). */}
      {stage === 'result' && result && bossLootItems && bossLootItems.length > 0 && !lootMomentDone && (
        <div className="fixed inset-0 z-[110] bg-black/55" data-testid="boss-loot-moment-backdrop">
          <LootMoment
            items={bossLootItems}
            surface="stage"
            reduced={reducedMotion === true}
            anchorXPct={50}
            groundYPct={72}
            onDone={() => setLootMomentDone(true)}
            testId="boss-loot-moment"
          />
        </div>
      )}
    </div>
  );
};
