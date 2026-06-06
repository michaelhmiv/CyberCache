import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sword, Shield, Zap, Crosshair, AlertTriangle, CheckCircle, Skull } from 'lucide-react';
import { BossDef } from '../../types/boss';
import { Weapon, Shield as ShieldItem, Ordnance, ClassMod, Relic } from '../../types/items';
import { RiskSetting, Element } from '../../types/game';
import { CONSUMABLES } from '../../constants/consumables';
import { simulateBoss, executeBossAttempt } from '../../lib/simulation/bossSimulator';
import { usePlayerStore, useInventoryStore, useBossStore, useLoadoutStore, useSkillStore } from '../../store';
import { MobileCard } from '../layout/MobileCard';
import { WeaponCanvas } from '../pixelArt/WeaponCanvas';
import { ElementIcon } from '../common/RarityGlow';

interface BossPrepModalProps {
  boss: BossDef;
  onClose: () => void;
}

const SLOT_LABELS = {
  PreFight: 'Pre-Fight',
  MidFight: 'Mid-Fight',
  Emergency: 'Emergency',
};

export const BossPrepModal: React.FC<BossPrepModalProps> = ({ boss, onClose }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadout = useLoadoutStore();
  const skillStore = useSkillStore();
  const [risk, setRisk] = useState<RiskSetting>(RiskSetting.Balanced);
  const [result, setResult] = useState<ReturnType<typeof executeBossAttempt> | null>(null);
  const [simulating, setSimulating] = useState(false);

  const primary = loadout.getWeapon('primary') || inventory.getWeapons()[0] || null;
  const secondary = loadout.getWeapon('secondary') || inventory.getWeapons()[1] || null;
  const heavy = loadout.getWeapon('heavy') || inventory.getWeapons().find((w) => w.weaponType === 'Launcher') || null;
  const shield = loadout.getShield() || null;
  const ordnance = loadout.getOrdnance() || null;
  const classMod = loadout.getClassMod() || null;
  const relic = loadout.getRelic() || null;
  const equippedConsumables = loadout.getEquippedConsumables();

  // Build consumable inventory map for simulation
  const consumablesMap = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(equippedConsumables).forEach((type) => {
      if (type) {
        const owned = player.getConsumableCount(type);
        map[type] = owned > 0 ? 1 : 0; // Each slot uses 1 if available
      }
    });
    return map;
  }, [equippedConsumables, player]);

  const sim = useMemo(() => {
    return simulateBoss({
      primary,
      secondary,
      heavy,
      ordnance: ordnance ? { id: ordnance.id, name: ordnance.name, level: ordnance.level, rarity: ordnance.rarity, damage: ordnance.damage, shieldDamage: ordnance.shieldDamage, armorDamage: ordnance.armorDamage, element: ordnance.element, effect: ordnance.effect, sourceTag: ordnance.sourceTag, isLocked: ordnance.isLocked } : null,
      shield: shield ? { id: shield.id, name: shield.name, level: shield.level, rarity: shield.rarity, hp: shield.hp, rechargeRate: shield.rechargeRate, mitigation: shield.mitigation, element: shield.element, affixes: shield.affixes, sourceTag: shield.sourceTag, isLocked: shield.isLocked, pixelSeed: shield.pixelSeed } : null,
      classMod: classMod ? { id: classMod.id, name: classMod.name, level: classMod.level, rarity: classMod.rarity, treeBonus: classMod.treeBonus, nodeBoosts: classMod.nodeBoosts, affixes: classMod.affixes, sourceTag: classMod.sourceTag, isLocked: classMod.isLocked } : null,
      relic: relic ? { id: relic.id, name: relic.name, level: relic.level, rarity: relic.rarity, affixes: relic.affixes, sourceTag: relic.sourceTag, isLocked: relic.isLocked } : null,
      consumables: consumablesMap,
      risk,
      boss,
      playerLevel: player.level,
      skillBonuses: skillStore.getBonuses(),
    });
  }, [primary, secondary, heavy, shield, ordnance, classMod, relic, consumablesMap, risk, boss, player.level, skillStore]);

  const winBand = sim.winChance >= 0.95 ? 'Farmable' : sim.winChance >= 0.75 ? 'Favorable' : sim.winChance >= 0.5 ? 'Risky' : sim.winChance >= 0.25 ? 'Underdog' : sim.winChance >= 0.05 ? 'Desperate' : 'Nearly Impossible';
  const bandColor = sim.winChance >= 0.75 ? 'text-green' : sim.winChance >= 0.5 ? 'text-amber' : sim.winChance >= 0.25 ? 'text-orange-400' : 'text-red';

  const setConsumableForSlot = (slot: keyof typeof SLOT_LABELS, type: string | null) => {
    loadout.setConsumableSlot(slot, type);
  };

  const handleFight = () => {
    setSimulating(true);
    setTimeout(() => {
      const outcome = executeBossAttempt(
        {
          primary,
          secondary,
          heavy,
          ordnance: ordnance ? { id: ordnance.id, name: ordnance.name, level: ordnance.level, rarity: ordnance.rarity, damage: ordnance.damage, shieldDamage: ordnance.shieldDamage, armorDamage: ordnance.armorDamage, element: ordnance.element, effect: ordnance.effect, sourceTag: ordnance.sourceTag, isLocked: ordnance.isLocked } : null,
          shield: shield ? { id: shield.id, name: shield.name, level: shield.level, rarity: shield.rarity, hp: shield.hp, rechargeRate: shield.rechargeRate, mitigation: shield.mitigation, element: shield.element, affixes: shield.affixes, sourceTag: shield.sourceTag, isLocked: shield.isLocked, pixelSeed: shield.pixelSeed } : null,
          classMod: classMod ? { id: classMod.id, name: classMod.name, level: classMod.level, rarity: classMod.rarity, treeBonus: classMod.treeBonus, nodeBoosts: classMod.nodeBoosts, affixes: classMod.affixes, sourceTag: classMod.sourceTag, isLocked: classMod.isLocked } : null,
          relic: relic ? { id: relic.id, name: relic.name, level: relic.level, rarity: relic.rarity, affixes: relic.affixes, sourceTag: relic.sourceTag, isLocked: relic.isLocked } : null,
          consumables: consumablesMap,
          risk,
          boss,
          playerLevel: player.level,
          skillBonuses: skillStore.getBonuses(),
        },
        player.credits
      );
      setResult(outcome);

      // Deduct consumed consumables
      Object.entries(outcome.consumedConsumables).forEach(([type, count]) => {
        if (count > 0) {
          player.removeConsumable(type, count);
        }
      });

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

        {/* Consumable Loadout Slots */}
        {!result && (
          <div className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase">Consumable Loadout</div>
            {(Object.keys(SLOT_LABELS) as Array<keyof typeof SLOT_LABELS>).map((slot) => {
              const selected = equippedConsumables[slot];
              return (
                <MobileCard key={slot} className="space-y-1">
                  <div className="text-[10px] text-amber font-bold uppercase">{SLOT_LABELS[slot]}</div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-text-primary">{selected ? CONSUMABLES[selected]?.name || selected : 'None'}</div>
                    <div className="text-[10px] text-text-muted">{selected ? `Owned: ${player.getConsumableCount(selected)}` : ''}</div>
                  </div>
                  <select
                    className="w-full text-xs bg-surface border border-border rounded-lg px-2 py-1 text-text-primary"
                    value={selected || ''}
                    onChange={(e) => setConsumableForSlot(slot, e.target.value || null)}
                  >
                    <option value="">-- None --</option>
                    {Object.values(CONSUMABLES).map((c) => (
                      <option key={c.id} value={c.id}>{c.name} ({c.effect})</option>
                    ))}
                  </select>
                </MobileCard>
              );
            })}
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
