import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, AlertTriangle, CheckCircle, Crosshair, Gauge, PackageCheck, Shield, Skull, Target, X, Zap } from 'lucide-react';
import { BossDef, PhaseAnalysis } from '../../types/boss';
import { ConsumableSlot, RiskSetting } from '../../types/game';
import { CONSUMABLES, CONSUMABLE_SLOTS, consumableLoadoutToCounts, getConsumablesForSlot } from '../../constants/consumables';
import { RARITIES } from '../../constants/rarities';
import { REGION_1_BOSSES } from '../../constants/bosses';
import { executeBossAttempt, simulateBoss } from '../../lib/simulation/bossSimulator';
import { buildBossFightActivity, buildBossPrepActivity } from '../../lib/activity/activityBuilders';
import { useActivityStore, useBossStore, useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore } from '../../store';
import { MobileCard } from '../layout/MobileCard';
import { WeaponCanvas } from '../pixelArt/WeaponCanvas';

interface BossPrepModalProps {
  boss: BossDef;
  onClose: () => void;
}

const SLOT_LABELS: Record<ConsumableSlot, string> = {
  [ConsumableSlot.PreFight]: 'Pre-Fight',
  [ConsumableSlot.MidFight]: 'Mid-Fight',
  [ConsumableSlot.Emergency]: 'Emergency',
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

export const BossPrepModal: React.FC<BossPrepModalProps> = ({ boss, onClose }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadout = useLoadoutStore();
  const skillStore = useSkillStore();
  const activity = useActivityStore();
  const [risk, setRisk] = useState<RiskSetting>(RiskSetting.Balanced);
  const [result, setResult] = useState<ReturnType<typeof executeBossAttempt> | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const primary = loadout.getWeapon('primary') || inventory.getWeapons()[0] || null;
  const secondary = loadout.getWeapon('secondary') || inventory.getWeapons()[1] || null;
  const heavy = loadout.getWeapon('heavy') || inventory.getWeapons().find((w) => w.weaponType === 'Launcher') || null;
  const shield = loadout.getShield() || null;
  const ordnance = loadout.getOrdnance() || null;
  const classMod = loadout.getClassMod() || null;
  const relic = loadout.getRelic() || null;
  const equippedConsumables = loadout.getEquippedConsumables();
  const selectedConsumables = useMemo(() => consumableLoadoutToCounts(equippedConsumables), [equippedConsumables]);
  const selectionAvailable = Object.entries(selectedConsumables).every(([type, count]) => player.getConsumableCount(type) >= count);
  const activityWeapon = primary ?? secondary ?? heavy ?? undefined;
  const isBossPrepActivity = activity.current.kind === 'boss_prep' && activity.current.targetType === 'boss' && activity.current.targetId === boss.id;
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

  const setConsumableForSlot = (slot: ConsumableSlot, type: string | null) => {
    setError(null);
    loadout.setConsumableSlot(slot, type);
  };

  const syncBossPrepActivity = async () => {
    try {
      await activity.start(buildBossPrepActivity(boss, activityWeapon));
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

    try {
      await activity.start(buildBossFightActivity(boss, activityWeapon));
    } catch (nextError) {
      setSimulating(false);
      setError(nextError instanceof Error ? nextError.message : 'Unable to set boss fight activity.');
      return;
    }

    window.setTimeout(async () => {
      const outcome = executeBossAttempt(
        {
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
        },
        player.credits
      );

      Object.entries(outcome.consumedConsumables).forEach(([type, count]) => {
        if (count > 0) player.removeConsumable(type, count);
      });

      setResult(outcome);
      if (outcome.result.victory) {
        player.addCredits(outcome.creditsDelta);
        player.addXP(boss.level * 20);
        const wasNewDefeat = !bossStore.defeatedBossIds.includes(boss.id);
        bossStore.defeatBoss(boss.id);
        bossStore.resetPity(boss.id);
        if (wasNewDefeat) {
          const currentIndex = REGION_1_BOSSES.findIndex((b) => b.id === boss.id);
          const nextBoss = REGION_1_BOSSES[currentIndex + 1];
          if (nextBoss && !bossStore.unlockedBossIds.includes(nextBoss.id)) {
            bossStore.unlockBoss(nextBoss.id);
          }
        }
        inventory.generateAndAdd({ source: 'Boss Drop', level: boss.level, bossTier: boss.tier });
        if (Math.random() < 0.3) {
          inventory.generateAndAdd({ source: 'Boss Drop', level: boss.level, bossTier: boss.tier });
        }
        for (let i = 0; i < outcome.bonusLootRolls; i++) {
          inventory.generateAndAdd({ source: 'Boss Drop', level: boss.level, bossTier: boss.tier });
        }
      } else {
        player.removeCredits(-outcome.creditsDelta);
        bossStore.incrementPity(boss.id);
      }
      bossStore.addAttempt(outcome.result);

      try {
        await activity.clear();
      } catch (nextError) {
        console.warn('Boss activity clear skipped:', nextError);
      }
      setSimulating(false);
    }, 1200);
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  const getRarityColor = (rarity?: string) => RARITIES[rarity as keyof typeof RARITIES]?.color || RARITIES.Common.color;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/80 flex flex-col">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="bl-title text-3xl leading-none text-text-primary">{boss.name}</div>
            <div className="text-xs text-text-muted">Tier {boss.tier} • Lv.{boss.level}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bl-secondary">
            <X size={20} />
          </button>
        </div>

        <MobileCard className="space-y-2 border-amber/30 bg-amber/5">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber">
            <Activity size={14} />
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
          <div className="flex items-center gap-4 text-xs text-text-secondary">
            <div className="flex items-center gap-1"><Shield size={14} /> HP {boss.health.toLocaleString()}</div>
            <div className="flex items-center gap-1"><Zap size={14} /> Shield {boss.shield.toLocaleString()}</div>
            <div className="flex items-center gap-1"><Crosshair size={14} /> Armor {boss.armor.toLocaleString()}</div>
          </div>
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

        {!result && (
          <div className="grid grid-cols-2 gap-3">
            <MobileCard className="text-center space-y-1">
              <div className="text-xs text-text-muted uppercase tracking-wider">Estimated Win Chance</div>
              <div className={`font-mono text-3xl font-black ${bandColor}`}>{(sim.winChance * 100).toFixed(1)}%</div>
              <div className={`text-sm font-bold ${bandColor}`}>{winBand}</div>
              <div className="text-[10px] text-text-muted">Death fee: {sim.deathFee.toLocaleString()}cr</div>
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

        {!result && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase flex items-center gap-2">
              <Activity size={14} />
              Phase Plan
            </div>
            {sim.phaseAnalyses.map((phase) => (
              <div key={phase.phaseId} className={`rounded-xl bg-surface p-3 border-2 ${PHASE_STATUS_BORDER[phase.status]} space-y-2`}>
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
                <Target size={14} />
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
          <div className="text-xs font-bold text-text-muted uppercase">Loadout</div>
          {[primary, secondary, heavy].filter(Boolean).map((w, i) => (
            <div
              key={i}
              className="flex items-center gap-3 bg-surface rounded-xl p-2 border-2 border-border shadow-[0_4px_12px_rgba(0,0,0,0.5)]"
              style={{ borderLeftColor: w ? getRarityColor(w.rarity) : undefined, borderLeftWidth: w ? 5 : undefined }}
            >
              {w && <WeaponCanvas type={w.weaponType} manufacturer={w.manufacturer} element={w.element} rarity={w.rarity} size={40} />}
              <div className="text-xs font-bold" style={{ color: w ? getRarityColor(w.rarity) : undefined }}>{w?.name || 'Empty'}</div>
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
              <Gauge size={14} />
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
                  <div className="text-xs text-text-secondary">+{boss.level * 20} XP</div>
                  {result.bonusLootRolls > 0 && (
                    <div className="text-xs text-amber flex justify-center items-center gap-1">
                      <PackageCheck size={12} /> +{result.bonusLootRolls} bonus loot roll{result.bonusLootRolls > 1 ? 's' : ''}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Skull size={40} className="mx-auto text-red" />
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
