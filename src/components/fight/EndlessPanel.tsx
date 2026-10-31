import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, CheckCircle, Lock } from 'lucide-react';
import type { PhaseAnalysis } from '../../types/boss';
import { RiskSetting } from '../../types/game';
import { CONSUMABLES } from '../../constants/consumables';
import { RARITIES } from '../../constants/rarities';
import { getBossRiskModifiers } from '../../lib/simulation/bossSimulator';
import { buildInitialTimeline, runFightAnimation, type FightOutcome, type FightTimeline } from '../../lib/animation/fightTimeline';
import {
  advanceEndlessEncounter,
  bankEndlessRun,
  getEndlessMe,
  newEndlessNonce,
  startEndlessRun,
  type ChefEndlessEncounterResult,
  type ChefEndlessMeResult,
  type ChefEndlessRun,
} from '../../lib/chef/chefClient';
import { syncEndlessResult } from '../../lib/api/verifiedStateSync';
import type { ActionSkillStateView } from '@/content/actionSkills';
import type { SkillTreeType } from '@/types/game';
import { ActionSkillCard } from './ActionSkillCard';
import { endlessDepthBand, endlessEncounterForDepth } from '../../content/endless';
import { useActivityStore, useBossStore, useLoadoutStore, usePlayerStore } from '../../store';
import { MobileCard } from '../layout/MobileCard';
import { BossFightStage } from '../pixelArt/BossFightStage';
import { LootMoment } from '../pixelArt/LootMoment';
import { GhostHpBar } from '../pixelArt/PixelFx';

/**
 * EndlessPanel — the Chaos Chamber (0028), the Fight workspace's
 * endless surface. The whole run is server-owned: this panel sends
 * intent (enter / next depth / bank) and presents returned facts.
 *
 *   prep (INTEL ONLY — the Chamber's scaling facts, the entry fee,
 *   the death rule, your best depth; never a readiness figure)
 *   → run (depth by depth; escrow accrues server-side and pays only
 *   at run end) → ended (banked in full, or the death fraction).
 *
 * Death in the Chamber is CONTAINED: it ends the run and taxes the
 * escrow, but never writes the roaming death record — the panel
 * says so on the prep surface, because the rule is the strategy:
 * push deeper, or bank now.
 */

const slashClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };
const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };

type PanelStage = 'loading' | 'prep' | 'run' | 'fighting' | 'ended';

const rarityColor = (rarity?: string) => RARITIES[rarity as keyof typeof RARITIES]?.color || RARITIES.Common.color;

const fmtDate = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/** Encounter vitals as proportional bars — each pool sized against the largest. */
const EncounterVitals: React.FC<{ health: number; shield: number; armor: number; dps: number }> = ({ health, shield, armor, dps }) => {
  const max = Math.max(1, health, shield, armor);
  const rows = [
    { label: 'HP', glyph: '♥', value: health, color: 'bg-red', text: 'text-red' },
    { label: 'Shield', glyph: '⚡', value: shield, color: 'bg-cyan', text: 'text-cyan' },
    { label: 'Armor', glyph: '◈', value: armor, color: 'bg-purple', text: 'text-purple' },
  ];
  return (
    <div className="space-y-1.5" data-testid="endless-vitals">
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
        <span className="font-black uppercase">Enemy DPS</span>
        <span className="font-mono font-black text-text-primary">{dps.toLocaleString()}</span>
      </div>
    </div>
  );
};

export const EndlessPanel: React.FC<{ onLeave: () => void }> = ({ onLeave }) => {
  const player = usePlayerStore();
  const bossStore = useBossStore();
  const loadout = useLoadoutStore();
  const activity = useActivityStore();
  const reducedMotion = useReducedMotion();

  const [me, setMe] = useState<ChefEndlessMeResult | null>(null);
  const [run, setRun] = useState<ChefEndlessRun | null>(null);
  const [stage, setStage] = useState<PanelStage>('loading');
  const [lastEncounter, setLastEncounter] = useState<ChefEndlessEncounterResult | null>(null);
  const [endSummary, setEndSummary] = useState<{ status: string; depth: number; payout: { credits: number; xp: number; scrap: number; fraction: number } | null } | null>(null);
  const [carriedOut, setCarriedOut] = useState<{ depth: number; credits: number } | null>(null);
  const [lootMomentDone, setLootMomentDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fightTimeline, setFightTimeline] = useState<FightTimeline | null>(null);
  const animationCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Action skill (0030): the state view rides the /me payload; the
  // charge carries across encounters inside a run and resets at run
  // end. `fireArmed` is intent for the NEXT encounter only.
  const [fireArmed, setFireArmed] = useState(false);
  const [fightActionSkill, setFightActionSkill] = useState<{
    tree: SkillTreeType; fired: boolean; chargeAfter: number;
  } | null>(null);
  const actionSkillView: ActionSkillStateView | null = me?.actionSkill ?? null;

  useEffect(() => () => {
    animationCancelRef.current.cancelled = true;
  }, []);

  // Promise-chain shape (the RepairBoard idiom): state lands in
  // .then/.catch, never synchronously inside the mount effect.
  const load = useCallback((): Promise<ChefEndlessMeResult | null> => {
    return getEndlessMe()
      .then((facts) => {
        setMe(facts);
        setRun(facts.activeRun);
        setStage(facts.activeRun ? 'run' : 'prep');
        return facts;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load the Chamber.');
        setStage('prep');
        return null;
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const primary = loadout.getWeapon('primary') ?? null;
  const secondary = loadout.getWeapon('secondary') ?? null;
  const heavy = loadout.getWeapon('heavy') ?? null;
  const shield = loadout.getShield() || null;
  const ordnance = loadout.getOrdnance() || null;
  const classMod = loadout.getClassMod() || null;
  const relic = loadout.getRelic() || null;

  const intel = me?.intel;
  const fee = intel?.entry.feeCredits ?? 0;
  const canAfford = player.credits >= fee;

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

  const risk = bossStore.selectedRisk;
  const riskMods = getBossRiskModifiers(risk);

  const loadoutRows: Array<{ slot: string; name: string | null; rarity?: string; detail?: string }> = [
    { slot: 'Primary', name: primary?.name ?? null, rarity: primary?.rarity, detail: primary ? `${primary.element} ${primary.weaponType}` : undefined },
    { slot: 'Secondary', name: secondary?.name ?? null, rarity: secondary?.rarity, detail: secondary ? `${secondary.element} ${secondary.weaponType}` : undefined },
    { slot: 'Heavy', name: heavy?.name ?? null, rarity: heavy?.rarity, detail: heavy ? `${heavy.element} ${heavy.weaponType}` : undefined },
    { slot: 'Shield', name: shield?.name ?? null, rarity: shield?.rarity, detail: shield ? `${shield.hp} HP` : undefined },
    { slot: 'Ordnance', name: ordnance?.name ?? null, rarity: ordnance?.rarity, detail: ordnance ? `${ordnance.element}` : undefined },
    { slot: 'Class Mod', name: classMod?.name ?? null, rarity: classMod?.rarity, detail: classMod ? classMod.treeBonus : undefined },
    { slot: 'Relic', name: relic?.name ?? null, rarity: relic?.rarity },
  ];

  // The next encounter's facts, from the shared content rules (the
  // server resolves the same def; this is display scaffolding only).
  const nextDepth = run ? run.depth_reached + 1 : 1;
  const nextEncounter = useMemo(
    () => (run ? endlessEncounterForDepth(nextDepth, run.start_level) : null),
    [run, nextDepth],
  );
  const animationPhases: PhaseAnalysis[] = useMemo(
    () =>
      (nextEncounter?.def.phases ?? []).map((phase) => ({
        phaseId: phase.id,
        phaseName: phase.name,
        score: 0,
        status: 'close' as const,
        currentAnswers: [],
        missingCounters: [],
        relevantConsumables: [],
        explanation: phase.description,
      })),
    [nextEncounter],
  );

  const handleStart = async () => {
    if (busy || !canAfford) return;
    setBusy(true);
    setError(null);
    setCarriedOut(null);
    try {
      const started = await startEndlessRun({
        nonce: newEndlessNonce('start'),
        consumables: prepared,
        risk,
      });
      syncEndlessResult({ profile: started.profile });
      if (started.abandonedSettlement) {
        setCarriedOut({
          depth: started.abandonedSettlement.depth_reached,
          credits: started.abandonedSettlement.payout.credits,
        });
      }
      setRun(started.run);
      await activity.hydrate().catch(() => undefined);
      const facts = await getEndlessMe().catch(() => null);
      if (facts) setMe(facts);
      setStage('run');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The Chamber refused entry.');
    } finally {
      setBusy(false);
    }
  };

  const handleAdvance = async () => {
    if (busy || !run || !nextEncounter) return;
    setBusy(true);
    setError(null);
    setLootMomentDone(false);
    setStage('fighting');
    let outcome: ChefEndlessEncounterResult;
    try {
      outcome = await advanceEndlessEncounter({ nonce: newEndlessNonce('encounter'), fireActionSkill: fireArmed });
      setFireArmed(false);
      setFightActionSkill(outcome.result?.actionSkill
        ? {
            tree: outcome.result.actionSkill.tree as SkillTreeType,
            fired: outcome.result.actionSkill.fired,
            chargeAfter: outcome.actionSkill?.charge ?? actionSkillView?.charge ?? 0,
          }
        : null);
      if (outcome.actionSkill) {
        const echo = outcome.actionSkill;
        setMe((prev) => {
          if (!prev?.actionSkill) return prev;
          const selected = (echo.selection as SkillTreeType | null) ?? prev.actionSkill.selected;
          return {
            ...prev,
            actionSkill: {
              ...prev.actionSkill,
              selected,
              charge: echo.charge,
              charged: echo.charge >= 100 && selected !== null,
            },
          };
        });
      }
      syncEndlessResult({ profile: outcome.profile, items: outcome.items });
      setRun(outcome.run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The encounter failed to resolve.');
      setStage('run');
      setBusy(false);
      return;
    }

    // Present the already-decided outcome at Sample B pacing (the
    // boss card's walk) — presentation only, never an outcome input.
    const fightOutcome: FightOutcome = {
      result: {
        victory: outcome.victory,
        winChance: outcome.result?.winChance ?? 0,
        bossHpRemaining: outcome.result?.bossHpRemaining,
        phaseFailed: outcome.result?.phaseFailed,
      },
      creditsDelta: 0,
      bonusLootRolls: 0,
      consumedConsumables: {},
      loot: [],
      extraLoot: false,
    };
    const initialTimeline = buildInitialTimeline(fightOutcome, nextEncounter.health, player.level, shield?.hp ?? 0);
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
    setLastEncounter(outcome);
    setBusy(false);
    if (outcome.runStatus !== 'active') {
      setEndSummary({
        status: outcome.runStatus,
        depth: outcome.run.depth_reached,
        payout: outcome.payout,
      });
      await activity.hydrate().catch(() => undefined);
      const facts = await getEndlessMe().catch(() => null);
      if (facts) setMe(facts);
      setStage('ended');
    } else {
      setStage('run');
    }
  };

  const handleBank = async () => {
    if (busy || !run) return;
    setBusy(true);
    setError(null);
    try {
      const banked = await bankEndlessRun({ nonce: newEndlessNonce('bank') });
      syncEndlessResult({ profile: banked.profile });
      setRun(banked.run);
      setEndSummary({ status: 'banked', depth: banked.depthReached, payout: banked.payout });
      await activity.hydrate().catch(() => undefined);
      const facts = await getEndlessMe().catch(() => null);
      if (facts) setMe(facts);
      setStage('ended');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Banking failed.');
    } finally {
      setBusy(false);
    }
  };

  const enterAgain = () => {
    animationCancelRef.current.cancelled = true;
    animationCancelRef.current = { cancelled: false };
    setLastEncounter(null);
    setEndSummary(null);
    setFightTimeline(null);
    setError(null);
    void load();
  };

  const deathPct = intel?.deathRule.payoutPercentOnDeath ?? 50;
  const band = endlessDepthBand(nextDepth);
  const escrow = run
    ? { credits: run.escrow_credits, xp: run.escrow_xp, scrap: run.escrow_scrap }
    : lastEncounter?.escrow;

  return (
    <div className="space-y-3" data-testid="endless-panel">
      {/* Header */}
      <div className="relative overflow-hidden border-2 border-fuchsia-500/40 bg-fuchsia-500/[0.06] p-3" style={panelClip}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span style={{ fontSize: 34 }} className="text-fuchsia-400">∞</span>
            <div>
              <div className="text-lg font-black leading-tight text-text-primary">Chaos Chamber</div>
              <div className="text-[10px] text-text-muted">
                Endless gauntlet · depth is the score · escrow pays when the run ends
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-text-muted">Best Depth</div>
            <div className="font-mono text-xl font-black text-fuchsia-300" data-testid="endless-best-depth">
              {me?.bestDepth ?? 0}
            </div>
          </div>
        </div>
        {run && stage !== 'ended' && (
          <div className="mt-2 flex items-center gap-2 text-[10px] text-text-secondary">
            <span className="border border-fuchsia-500/40 bg-fuchsia-500/10 px-1.5 py-0.5 font-black text-fuchsia-300">
              DEPTH {run.depth_reached} CLEARED
            </span>
            <span>Run anchored at Lv.{run.start_level} · belt of {Object.values(run.prepared_consumables).reduce((a, b) => a + b, 0)} priced in</span>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 border-2 border-red/40 bg-red/10 p-2 text-[11px] text-red">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {carriedOut && stage === 'run' && (
        <div className="border-2 border-amber/40 bg-amber/10 p-2 text-[11px] text-amber" data-testid="endless-carried-out">
          Previous run carried out at depth {carriedOut.depth} — its bank paid {carriedOut.credits.toLocaleString()}cr at the death fraction.
        </div>
      )}

      {stage === 'loading' && (
        <MobileCard>
          <div className="text-[11px] text-text-muted">Reading the Chamber…</div>
        </MobileCard>
      )}

      {stage === 'prep' && intel && (
        <>
          {/* Chamber intel — the RUN's facts. Intel only, by law. */}
          <MobileCard className="space-y-2">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300">Chamber Intel</div>
            <div className="text-[11px] font-black text-text-primary">
              Depth 1 — {intel.firstEncounter.name} · Lv.{intel.firstEncounter.level}
            </div>
            <EncounterVitals
              health={intel.firstEncounter.health}
              shield={intel.firstEncounter.shield}
              armor={intel.firstEncounter.armor}
              dps={intel.firstEncounter.dps}
            />
            <div className="grid grid-cols-2 gap-1.5 text-[10px]">
              <div className="border border-border bg-bg/70 p-2" style={slashClip}>
                <span className="text-text-muted">Escalation</span>
                <div className="font-black text-text-primary">HP +{intel.escalation.healthGrowthPercentPerDepth}% · DMG +{intel.escalation.damageGrowthPercentPerDepth}% / depth</div>
              </div>
              <div className="border border-border bg-bg/70 p-2" style={slashClip}>
                <span className="text-text-muted">Boss Depths</span>
                <div className="font-black text-text-primary">Every {intel.bossEvery} · first: {intel.firstBossEncounter.name}</div>
              </div>
              <div className="border border-border bg-bg/70 p-2" style={slashClip}>
                <span className="text-text-muted">Per Depth Cleared</span>
                <div className="font-black text-text-primary">{intel.rewards.xpPerEncounterLevel} XP · {intel.rewards.creditsPerEncounterLevel}cr · {intel.rewards.scrapPerEncounterLevel} scrap per level, +{intel.rewards.rewardGrowthPercentPerDepth}%/depth</div>
              </div>
              <div className="border border-border bg-bg/70 p-2" style={slashClip}>
                <span className="text-text-muted">Milestone Drops</span>
                <div className="font-black text-text-primary">Every {intel.milestoneEvery} depths · item at encounter level</div>
              </div>
            </div>
            <div className="border-t border-border/40 pt-2 text-[10px] leading-snug text-text-secondary">
              <span className="font-black text-fuchsia-300">{intel.firstBossEncounter.mechanicName}: </span>
              {intel.firstBossEncounter.mechanicDescription}
            </div>
            <div className="text-[10px] leading-snug text-text-muted">
              The Chamber is contained: dying ends the run and pays {deathPct}% of the escrow — it never writes a
              roaming death record and never asks for a resurrection. Banking out alive pays 100%. Your prepared
              belt is burned once at entry and priced into every depth. Depth cap {intel.maxDepth}.
            </div>
          </MobileCard>

          {/* Your record — server facts only. */}
          {me && me.recentRuns.length > 0 && (
            <MobileCard className="space-y-1.5">
              <div className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300">Recent Runs</div>
              {me.recentRuns.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-black text-text-primary">Depth {r.depth_reached}</span>
                  <span className="text-text-muted">
                    {r.status} · {fmtDate(r.ended_at)} · paid {r.paid_credits.toLocaleString()}cr / {r.paid_xp.toLocaleString()} XP
                  </span>
                </div>
              ))}
            </MobileCard>
          )}

          {/* Loadout summary */}
          <MobileCard className="space-y-1.5">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300">Your Loadout</div>
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

          {/* Prepared belt — burned once at entry. */}
          <MobileCard className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300">Prepare Belt</div>
              <div className="text-[9px] text-text-muted">{preparedTotal} prepared · burned at entry</div>
            </div>
            {ownedConsumables.length === 0 && (
              <div className="text-[10px] text-text-muted">You own no consumables. The Chamber does not require a belt — but depth is hungry.</div>
            )}
            {ownedConsumables.map(({ def, owned }) => {
              const count = prepared[def.id] ?? 0;
              return (
                <div key={def.id} className="flex items-center gap-2 border border-border bg-bg/70 p-2" style={slashClip}>
                  <span style={{ fontSize: 14 }} className="shrink-0">{def.visual.glyph}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-black text-text-primary">{def.name}</div>
                    <div className="truncate text-[9px] text-text-muted">{def.shortDescription}</div>
                    <div className="text-[9px] text-text-muted">Owned {owned}</div>
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
                    <span className="w-6 text-center font-mono text-xs font-black text-text-primary">{count}</span>
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

          {/* Risk profile */}
          <MobileCard className="space-y-2">
            <div className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300">Risk Profile</div>
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

          {/* Action skill — the player's own signature state (0030). */}
          <ActionSkillCard
            state={actionSkillView}
            armed={fireArmed}
            onToggleArmed={setFireArmed}
            chargeSourceNote="Charge carries across encounters inside a run and resets when the run ends."
          />

          <button
            type="button"
            data-testid="endless-start"
            onClick={handleStart}
            disabled={!canAfford || busy}
            className="bl-primary w-full py-3 text-xs font-black uppercase tracking-wider disabled:opacity-50"
          >
            {busy
              ? 'Entering…'
              : fee > 0
                ? `Enter the Chamber — ${fee.toLocaleString()}cr entry`
                : 'Enter the Chamber — Free Entry'}
          </button>
          {!canAfford && (
            <div className="text-center text-[10px] text-red">You hold {player.credits.toLocaleString()}cr — the {fee.toLocaleString()}cr entry fee is out of reach.</div>
          )}
          {intel.entry.feeMultiplier > 1 && (
            <div className="text-center text-[10px] text-amber">
              Entry fee escalated ×{intel.entry.feeMultiplier} — {intel.entry.runsStartedToday} {intel.entry.runsStartedToday === 1 ? 'run' : 'runs'} started today. Resets at 00:00 UTC.
            </div>
          )}
        </>
      )}

      {(stage === 'run' || stage === 'fighting') && run && nextEncounter && (
        <>
          {/* Escrow — the bank at stake. */}
          <MobileCard className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300">Escrow</div>
              <div className="text-[9px] text-text-muted">pays at run end</div>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center" data-testid="endless-escrow">
              <div className="border border-border bg-bg/70 p-2" style={slashClip}>
                <div className="text-[9px] text-text-muted">Credits</div>
                <div className="font-mono font-black text-cyan">{(escrow?.credits ?? 0).toLocaleString()}</div>
              </div>
              <div className="border border-border bg-bg/70 p-2" style={slashClip}>
                <div className="text-[9px] text-text-muted">XP</div>
                <div className="font-mono font-black text-green">{(escrow?.xp ?? 0).toLocaleString()}</div>
              </div>
              <div className="border border-border bg-bg/70 p-2" style={slashClip}>
                <div className="text-[9px] text-text-muted">Scrap</div>
                <div className="font-mono font-black text-amber">{(escrow?.scrap ?? 0).toLocaleString()}</div>
              </div>
            </div>
            <div className="text-[10px] text-text-muted">
              Bank now: 100%. Die at depth {nextDepth}: {deathPct}%. Milestone drop at depth {Math.ceil(nextDepth / 5) * 5}.
            </div>
          </MobileCard>

          {stage === 'fighting' && fightTimeline ? (
            <MobileCard className="space-y-2 border-fuchsia-500/30 bg-fuchsia-500/5">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fuchsia-300">
                <span style={{ fontSize: 14 }}>⚔</span>
                Depth {nextDepth} — {nextEncounter.name}
              </div>
              <BossFightStage
                timeline={fightTimeline}
                phases={animationPhases}
                bossId={nextEncounter.id}
                backgroundId={nextEncounter.kind === 'pack' ? `zone-${nextEncounter.areaId.split('_')[0]}-bg` : undefined}
                depthBadge={{ depth: nextDepth, band }}
                weapon={primary ?? undefined}
                reduced={reducedMotion === true}
                signatureFire={fightActionSkill?.fired ? fightActionSkill.tree : null}
              />
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-text-muted">
                  <span className="flex items-center gap-1"><span style={{ fontSize: 11 }} className="text-green">♥</span> Player</span>
                  <span className="font-black text-text-primary">{fightTimeline.playerHp.toLocaleString()} / {fightTimeline.playerHpMax.toLocaleString()}</span>
                </div>
                <GhostHpBar pct={fightTimeline.playerHpMax > 0 ? (fightTimeline.playerHp / fightTimeline.playerHpMax) * 100 : 0} color="#4ADE80" reduced={reducedMotion === true} />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-text-muted">
                  <span>{nextEncounter.name}</span>
                  <span className="font-black text-text-primary">{fightTimeline.bossHp.toLocaleString()} / {fightTimeline.bossHpMax.toLocaleString()}</span>
                </div>
                <GhostHpBar pct={fightTimeline.bossHpMax > 0 ? (fightTimeline.bossHp / fightTimeline.bossHpMax) * 100 : 0} color="#F87171" reduced={reducedMotion === true} />
              </div>
            </MobileCard>
          ) : (
            <>
              <MobileCard className="space-y-2">
                <div className="text-[9px] font-black uppercase tracking-[0.22em] text-fuchsia-300">
                  Next — Depth {nextDepth} {nextEncounter.kind === 'boss' ? '· BOSS' : ''}
                </div>
                <div className="text-[13px] font-black text-text-primary">
                  {nextEncounter.name} · Lv.{nextEncounter.level}
                </div>
                <EncounterVitals
                  health={nextEncounter.health}
                  shield={nextEncounter.shield}
                  armor={nextEncounter.armor}
                  dps={nextEncounter.dps}
                />
                {nextEncounter.def.weaknesses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {nextEncounter.def.weaknesses.map((e) => (
                      <span key={`w-${e}`} className="border border-green/30 bg-green/10 px-1.5 py-0.5 text-[9px] font-bold text-green">Weak: {e}</span>
                    ))}
                    {nextEncounter.def.resistances.map((e) => (
                      <span key={`r-${e}`} className="border border-red/30 bg-red/10 px-1.5 py-0.5 text-[9px] font-bold text-red">Resist: {e}</span>
                    ))}
                  </div>
                )}
                {lastEncounter && stage === 'run' && (
                  <div className="border-t border-border/40 pt-2 text-[10px] text-text-secondary" data-testid="endless-last-result">
                    Depth {lastEncounter.result?.depth ?? run.depth_reached} cleared — escrowed +
                    {lastEncounter.rewards.credits.toLocaleString()}cr · +{lastEncounter.rewards.xp.toLocaleString()} XP · +
                    {lastEncounter.rewards.scrap.toLocaleString()} scrap.
                    {lastEncounter.milestone && lastEncounter.items[0] && (
                      <span className="font-black" style={{ color: rarityColor(lastEncounter.items[0].rarity) }}>
                        {' '}Milestone drop: {lastEncounter.items[0].name} ({lastEncounter.items[0].rarity}) — yours outright.
                      </span>
                    )}
                  </div>
                )}
              </MobileCard>
              {/* Action skill — arm the signature for the next depth (0030). */}
              <ActionSkillCard
                state={actionSkillView}
                armed={fireArmed}
                onToggleArmed={setFireArmed}
                chargeSourceNote="Charge carries across encounters inside this run and resets when the run ends."
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="endless-advance"
                  onClick={handleAdvance}
                  disabled={busy}
                  className="bl-primary py-3 text-xs font-black uppercase tracking-wider disabled:opacity-50"
                >
                  {busy ? 'Resolving…' : `Face Depth ${nextDepth}`}
                </button>
                <button
                  type="button"
                  data-testid="endless-bank"
                  onClick={handleBank}
                  disabled={busy}
                  className="bl-secondary py-3 text-xs font-black uppercase tracking-wider text-text-secondary disabled:opacity-50"
                >
                  Bank &amp; Leave
                </button>
              </div>
            </>
          )}
        </>
      )}

      {stage === 'ended' && endSummary && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`space-y-2 border-2 p-4 text-center ${endSummary.status === 'banked' ? 'border-green/40 bg-green/10' : 'border-red/40 bg-red/10'}`}
          style={panelClip}
          data-testid="endless-ended"
        >
          {endSummary.status === 'banked' ? (
            <>
              <CheckCircle size={38} className="mx-auto text-green" />
              <div className="text-xl font-black text-green">BANKED — DEPTH {endSummary.depth}</div>
              <div className="text-xs text-text-secondary">You left the Chamber alive. The escrow paid in full.</div>
            </>
          ) : (
            <>
              <span style={{ fontSize: 34 }} className="text-red">☠</span>
              <div className="text-xl font-black text-red">THE CHAMBER CLAIMS ANOTHER — DEPTH {endSummary.depth}</div>
              <div className="text-xs text-text-secondary">
                Contained death: no roaming death record, no resurrection. The escrow paid at {Math.round((endSummary.payout?.fraction ?? 0) * 100)}%.
              </div>
            </>
          )}
          {endSummary.payout && (
            <div className="text-xs text-text-secondary">
              Paid: {endSummary.payout.credits.toLocaleString()}cr · {endSummary.payout.xp.toLocaleString()} XP · {endSummary.payout.scrap.toLocaleString()} scrap
            </div>
          )}
          <div className="text-xs text-text-muted">Best depth: {me?.bestDepth ?? endSummary.depth}</div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <button type="button" onClick={enterAgain} className="bl-primary py-2.5 text-xs font-black">Enter Again</button>
            <button type="button" onClick={onLeave} className="bl-secondary py-2.5 text-xs font-black text-text-secondary">Leave Chamber</button>
          </div>
        </motion.div>
      )}

      {stage === 'prep' && !intel && (
        <div className="flex items-start gap-2 border-2 border-border bg-bg/70 p-3 text-[11px] text-text-secondary" style={slashClip}>
          <Lock size={14} className="mt-0.5 shrink-0 text-amber" />
          The Chamber intel failed to load. Check your connection and reopen the Fight tab.
        </div>
      )}

      {/* Milestone LootMoment — the drop is already in the inventory;
          the moment is the celebration (Loot Directive). */}
      {lastEncounter && lastEncounter.milestone && lastEncounter.items.length > 0 && !lootMomentDone && stage !== 'fighting' && (
        <div className="fixed inset-0 z-[110] bg-black/55" data-testid="endless-loot-moment-backdrop">
          <LootMoment
            items={lastEncounter.items}
            surface="stage"
            reduced={reducedMotion === true}
            anchorXPct={50}
            groundYPct={72}
            onDone={() => setLootMomentDone(true)}
            testId="endless-loot-moment"
          />
        </div>
      )}
    </div>
  );
};
