import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sword, Shield, Zap, Crosshair, AlertTriangle, CheckCircle, Skull } from 'lucide-react';
import { BossDef } from '../../types/boss';
import { Weapon, Shield as ShieldItem, Ordnance, ClassMod, Relic } from '../../types/items';
import { ConsumableType, RiskSetting, Element } from '../../types/game';
import { CONSUMABLES } from '../../constants/consumables';
import { simulateBoss, executeBossAttempt } from '../../lib/simulation/bossSimulator';
import { usePlayerStore, useInventoryStore, useBossStore } from '../../store';
import { MobileCard } from '../layout/MobileCard';
import { WeaponCanvas } from '../pixelArt/WeaponCanvas';
import { ElementIcon } from '../common/RarityGlow';

interface BossPrepModalProps {
  boss: BossDef;
  onClose: () => void;
}

export const BossPrepModal: React.FC<BossPrepModalProps> = ({ boss, onClose }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const [risk, setRisk] = useState<RiskSetting>(RiskSetting.Balanced);
  const [consumables, setConsumables] = useState<Record<string, number>>({});
  const [result, setResult] = useState<ReturnType<typeof executeBossAttempt> | null>(null);
  const [simulating, setSimulating] = useState(false);

  const weapons = inventory.getWeapons();
  const primary = weapons[0] || null; // simplistic for MVP
  const secondary = weapons[1] || null;
  const heavy = weapons.find((w) => w.weaponType === 'Launcher') || null;

  const sim = useMemo(() => {
    return simulateBoss({
      primary,
      secondary,
      heavy,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables,
      risk,
      boss,
      playerLevel: player.level,
      skillBonuses: {},
    });
  }, [primary, secondary, heavy, consumables, risk, boss, player.level]);

  const winBand = sim.winChance >= 0.95 ? 'Farmable' : sim.winChance >= 0.75 ? 'Favorable' : sim.winChance >= 0.5 ? 'Risky' : sim.winChance >= 0.25 ? 'Underdog' : sim.winChance >= 0.05 ? 'Desperate' : 'Nearly Impossible';
  const bandColor = sim.winChance >= 0.75 ? 'text-green' : sim.winChance >= 0.5 ? 'text-amber' : sim.winChance >= 0.25 ? 'text-orange-400' : 'text-red';

  const adjustConsumable = (type: string, delta: number) => {
    setConsumables((prev) => {
      const next = { ...prev, [type]: Math.max(0, (prev[type] || 0) + delta) };
      if (next[type] === 0) delete next[type];
      return next;
    });
  };

  const handleFight = () => {
    setSimulating(true);
    setTimeout(() => {
      const outcome = executeBossAttempt(
        {
          primary,
          secondary,
          heavy,
          ordnance: null,
          shield: null,
          classMod: null,
          relic: null,
          consumables,
          risk,
          boss,
          playerLevel: player.level,
          skillBonuses: {},
        },
        player.credits
      );
      setResult(outcome);
      if (outcome.result.victory) {
        player.addCredits(outcome.creditsDelta);
        player.addXP(boss.level * 20);
        bossStore.defeatBoss(boss.id);
        bossStore.incrementPity(boss.id);
        // Generate loot
        const loot = inventory.generateAndAdd({ source: 'Boss Drop', level: boss.level, bossTier: boss.tier });
        if (Math.random() < 0.3) {
          inventory.generateAndAdd({ source: 'Boss Drop', level: boss.level, bossTier: boss.tier });
        }
      } else {
        player.removeCredits(-outcome.creditsDelta);
        bossStore.incrementPity(boss.id);
      }
      bossStore.addAttempt(outcome.result);
      setSimulating(false);
    }, 1200);
  };

  const reset = () => {
    setResult(null);
    setConsumables({});
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 flex flex-col"
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-bold text-text-primary">{boss.name}</div>
            <div className="text-xs text-text-muted">Tier {boss.tier} • Lv.{boss.level}</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bg-surface border border-border">
            <X size={20} />
          </button>
        </div>

        {/* Boss Profile */}
        <MobileCard className="space-y-2">
          <div className="flex items-center gap-4 text-xs text-text-secondary">
            <div className="flex items-center gap-1"><Shield size={14} /> HP {boss.health.toLocaleString()}</div>
            <div className="flex items-center gap-1"><Zap size={14} /> Shield {boss.shield.toLocaleString()}</div>
            <div className="flex items-center gap-1"><Crosshair size={14} /> Armor {boss.armor.toLocaleString()}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {boss.weaknesses.map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green font-bold">Weak: {e}</span>
            ))}
            {boss.resistances.map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-red/10 text-red font-bold">Resist: {e}</span>
            ))}
          </div>
          <div className="text-[10px] text-amber">{boss.mechanic.description}</div>
        </MobileCard>

        {/* Win Chance */}
        {!result && (
          <MobileCard className="text-center space-y-1">
            <div className="text-xs text-text-muted uppercase tracking-wider">Estimated Win Chance</div>
            <div className={`text-3xl font-black ${bandColor}`}>{(sim.winChance * 100).toFixed(1)}%</div>
            <div className={`text-sm font-bold ${bandColor}`}>{winBand}</div>
          </MobileCard>
        )}

        {/* Reasons */}
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

        {/* Loadout Snapshot */}
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase">Loadout</div>
          {[primary, secondary, heavy].filter(Boolean).map((w, i) => (
            <div key={i} className="flex items-center gap-3 bg-surface-raised rounded-lg p-2 border border-border">
              {w && <WeaponCanvas type={w.weaponType} manufacturer={w.manufacturer} element={w.element} rarity={w.rarity} size={40} />}
              <div className="text-xs text-text-primary font-bold">{w?.name || 'Empty'}</div>
            </div>
          ))}
        </div>

        {/* Consumable Planner */}
        {!result && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase">Consumables</div>
            {Object.values(CONSUMABLES).slice(0, 5).map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-surface-raised rounded-lg p-2 border border-border">
                <div className="text-xs text-text-primary">{c.name}</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => adjustConsumable(c.id, -1)}
                    className="w-6 h-6 rounded bg-border text-text-primary font-bold text-xs"
                  >
                    -
                  </button>
                  <span className="text-xs font-bold w-4 text-center">{consumables[c.id] || 0}</span>
                  <button
                    onClick={() => adjustConsumable(c.id, 1)}
                    className="w-6 h-6 rounded bg-amber text-bg font-bold text-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Risk Selector */}
        {!result && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase">Risk Profile</div>
            <div className="grid grid-cols-4 gap-2">
              {Object.values(RiskSetting).map((r) => (
                <button
                  key={r}
                  onClick={() => setRisk(r)}
                  className={`py-2 rounded-lg text-[10px] font-bold border transition-colors ${
                    risk === r ? 'bg-amber text-bg border-amber' : 'bg-surface-raised text-text-secondary border-border'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`rounded-xl p-4 text-center space-y-2 border ${
                result.result.victory ? 'bg-green/10 border-green/30' : 'bg-red/10 border-red/30'
              }`}
            >
              {result.result.victory ? (
                <>
                  <CheckCircle size={40} className="mx-auto text-green" />
                  <div className="text-xl font-black text-green">BOSS DEFEATED</div>
                  <div className="text-xs text-text-secondary">+{result.creditsDelta.toLocaleString()} credits</div>
                  <div className="text-xs text-text-secondary">+{boss.level * 20} XP</div>
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Action */}
      <div className="shrink-0 p-4 border-t border-border bg-surface">
        {result ? (
          <div className="grid grid-cols-2 gap-3">
            <button onClick={reset} className="py-3 rounded-xl bg-amber text-bg font-bold text-sm">Fight Again</button>
            <button onClick={onClose} className="py-3 rounded-xl bg-surface-raised text-text-primary font-bold text-sm border border-border">Back</button>
          </div>
        ) : (
          <button
            onClick={handleFight}
            disabled={simulating}
            className="w-full py-4 rounded-xl bg-amber text-bg font-black text-sm uppercase tracking-wider disabled:opacity-50"
          >
            {simulating ? 'Simulating...' : 'INITIATE COMBAT'}
          </button>
        )}
      </div>
    </motion.div>
  );
};
