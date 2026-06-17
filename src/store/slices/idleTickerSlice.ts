import { create } from 'zustand';
import {
  useActivityStore,
  useIdleStore,
  useInventoryStore,
  usePlayerStore,
  useCombatStatsStore,
  useSurvivalStore,
  useSkillStore,
  useLoadoutStore,
} from '@/store';
import {
  ROAMING_AREAS,
  getRoamingArea,
  rollAreaMaterialFind,
  rollAreaDropKind,
  buildAreaWeaponDropOptions,
} from '@/constants/roamingAreas';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { syncVerifiedResult } from '@/lib/supabase/verifiedStateSync';
import { sumActivityModifier } from '@/lib/stats/activityModifiers';
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import type { GearItem, Weapon } from '@/types/items';
import { useTickFeedStore, type TickEvent } from './tickSlice';
import { useActiveBuffsStore } from './activeBuffsSlice';
import { pickAreaMonster, resolveAreaMonsters } from '@/lib/combat/areaMonsterSelector';
import {
  computeMonsterDamageVsHunter,
  computePlayerDamageVsMonster,
  type WeaponDamageSource,
} from '@/lib/combat/damageContract';
import { loadoutSurvivalStats, loadoutEffectiveDps, equippedShieldRechargeRate, equippedShieldMitigation } from '@/lib/combat/loadoutSurvival';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { pickNextTarget } from '@/lib/combat/killCycleHelpers';
import { bossTick, bossDamagePerSecond } from '@/lib/combat/bossTick';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { useBossStore } from '@/store/slices/bossSlice';
import { createTickRng } from '@/lib/rng/tickRng';
import { generateWeapon } from '@/lib/generators/weaponGenerator';
import { generateShield } from '@/lib/generators/shieldGenerator';
import { generateClassMod } from '@/lib/generators/classModGenerator';
import { generateRelic } from '@/lib/generators/relicGenerator';
import { generateOrdnance } from '@/lib/generators/ordnanceGenerator';

const TICK_MS = 3000;
const DROP_CHANCE = 0.22;
const FRAGMENT_CHANCE = 0.03;
const MATERIAL_FIND_CHANCE = 0.08;
const DEFAULT_AREA_ID = ROAMING_AREAS[0]?.id ?? 'dustwaste_frontier';

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let lastTickedAreaId: string | null = null;
let ticking = false;
let totalTickCount = 0;
let roamingConsumableState: unknown = undefined;

export interface IdleTickerState {
  running: boolean;
  lastTickAt: number;
  /** Monotonically increasing tick counter — used as the RNG seed and server nonce. */
  totalTickCount: number;
  start: () => void;
  stop: () => void;
  /** Force a single tick (e.g. when the user resumes the tab or comes back from offline). */
  tickNow: () => Promise<void>;
}

const pushPreviewEvents = (events: TickEvent[]) => {
  if (events.length === 0) return;

  // Phase 1b: preview events are cosmetic only. No store mutations here —
  // credits, XP, scrap, gear, materials, and essences are all sourced from
  // the server response via syncRuntimeProfile / syncVerifiedResult.
  useTickFeedStore.getState().push(events);
};

/**
 * rollPreviewEvents — COSMETIC ONLY. Generates preview tick events
 * for immediate display in the tick feed. Does NOT mutate any store
 * (inventory, player resources, survival, kill cycle).
 *
 * All item generation, resource awards, and state mutations are
 * owned by the Chef server (src/server/chef.ts). This function
 * produces preview events that include the actual generated gear
 * using the same deterministic RNG as the Chef, so the preview
 * matches the server-authoritative result. The Chef response
 * replaces these with canonical events (which should be identical).
 *
 * Phase 3b: Now generates actual gear using the same RNG stream
 * as the Chef, eliminating "graphical blobs" placeholder particles.
 */
const rollPreviewEvents = (
  areaId: string,
  ticks: number,
  rng: () => number,
  effectiveCreditsPerTick: number,
  effectiveScrapPerTick: number,
  effectiveXpPerTick: number,
  playerLevel: number,
): TickEvent[] => {
  const area = getRoamingArea(areaId);
  const events: TickEvent[] = [];
  const now = Date.now();

  for (let i = 0; i < ticks; i += 1) {
    const at = now - (ticks - 1 - i) * TICK_MS;
    const roll = rng();

    if (roll < DROP_CHANCE) {
      // Gear drop — generate actual gear using same RNG as Chef
      // so preview matches server-authoritative result.
      const kind = rollAreaDropKind(area, rng);
      let gear: GearItem | undefined;

      switch (kind) {
        case 'weapon': {
          const opts = buildAreaWeaponDropOptions(area, playerLevel, rng);
          gear = generateWeapon(opts, rng);
          break;
        }
        case 'shield':
          gear = generateShield(playerLevel, rng);
          break;
        case 'classMod':
          gear = generateClassMod(playerLevel, rng);
          break;
        case 'relic':
          gear = generateRelic(playerLevel, rng);
          break;
        case 'ordnance':
          gear = generateOrdnance(playerLevel, rng);
          break;
      }

      if (gear) {
        const typeLabel = 'weaponType' in gear ? gear.weaponType : 'gear';
        const powerLabel = 'combatPower' in gear ? ` · ${gear.combatPower} Power` : '';
        const elemLabel = 'element' in gear ? ` · ${gear.element}` : '';
        const mfgLabel = 'manufacturer' in gear ? ` · ${gear.manufacturer}` : '';
        events.push({
          id: '',
          at,
          tone: 'loot',
          label: gear.name,
          detail: `${gear.rarity} ${typeLabel}${powerLabel}${elemLabel}${mfgLabel}`,
          gear,
          areaId,
        });
      }
    } else {
      const subRoll = rng();
      if (subRoll < FRAGMENT_CHANCE) {
        events.push({
          id: '',
          at,
          tone: 'fragment',
          label: '+1 cache fragment',
          detail: `${area.enemyType} patrol yielded a cache key fragment.`,
          areaId,
          value: 1,
        });
      } else if (subRoll < FRAGMENT_CHANCE + MATERIAL_FIND_CHANCE) {
        const find = rollAreaMaterialFind(area, rng);
        if (find) {
          events.push({
            id: '',
            at,
            tone: find.kind === 'material' ? 'material' : 'essence',
            label: `+1 ${find.type}`,
            detail: `Field sweep recovered ${find.type}.`,
            areaId,
            value: 1,
          });
        }
      } else {
        // Resource-only tick — NOT a real kill. Use 'cash' tone so the
        // diorama doesn't trigger enemy death animations for every resource drop.
        events.push({
          id: '',
          at,
          tone: 'cash',
          label: `+${effectiveCreditsPerTick}cr · +${effectiveScrapPerTick} scrap · +${effectiveXpPerTick} XP`,
          detail: `${area.enemyType} routed in ${area.name}.`,
          areaId,
          value: effectiveCreditsPerTick,
        });
      }
    }
  }

  return events;
};

/**
 * Per-tick survival damage application. Picks a monster from the
 * current area's roster, rolls a hit, applies damage to the survival
 * slice, then decides whether to auto-eat a consumable. Emits feed
 * events for hits, heals, and death. Returns the events so the
 * caller can push them to the tick feed alongside loot events.
 *
 * This is the only place per-tick monster damage is applied. PR 2
 * adds it; future PRs may add per-weapon damage to the monster (the
 * kill cycle in PR 4) but the hunter's damage intake is owned here.
 */
const applySurvivalTick = (areaId: string, ticks: number): TickEvent[] => {
  const events: TickEvent[] = [];
  const area = getRoamingArea(areaId);
  const now = Date.now();

  for (let i = 0; i < ticks; i += 1) {
    if (useSurvivalStore.getState().isDead) break;

    const monster = pickAreaMonster({ ...area, unlockLevel: area.unlockLevel });
    if (!monster) continue;

    const hunter = loadoutSurvivalStats();
    // Refresh the hunter's shield from the survival slice — it may
    // have been refilled by a recent auto-eat in the same tick.
    hunter.shieldHp = useSurvivalStore.getState().shieldHp;

    const hit = computeMonsterDamageVsHunter(monster, hunter);
    const at = now - (ticks - 1 - i) * TICK_MS;

    if (hit.missed) {
      // Miss events are not pushed to the feed (would be spammy); the
      // damage event will appear on the next successful hit.
      continue;
    }

    if (hit.shieldAbsorbed > 0) {
      useSurvivalStore.getState().refillShield(-hit.shieldAbsorbed);
    }

    if (hit.hpDamage > 0) {
      useSurvivalStore.getState().applyDamage(hit.hpDamage);
      events.push({
        id: '',
        at,
        tone: 'damage',
        label: `-${hit.hpDamage} HP`,
        detail: `${monster.name} hit you for ${hit.hpDamage} HP${hit.shieldAbsorbed > 0 ? ` (${hit.shieldAbsorbed} absorbed by shield)` : ''}.`,
        areaId,
        value: hit.hpDamage,
      });
    } else if (hit.fullyBlocked) {
      events.push({
        id: '',
        at,
        tone: 'damage',
        label: 'Blocked',
        detail: `${monster.name}'s attack absorbed by your shield.`,
        areaId,
        value: 0,
      });
    }

    // Consumable processing (Nano Swarm regen, Adrenaline trigger,
    // Shield Cell restore, Med Kit buffer depletion) is now handled
    // server-side by the Chef. The client only sends loadout consumables
    // and prior roaming state in the claim, then syncs from the response.

    // Death check — applies AFTER the damage event so the feed shows
    // the killing blow, then a death marker, in that order.
    if (useSurvivalStore.getState().currentHp === 0) {
      useSurvivalStore.getState().die({
        monsterId: monster.id,
        monsterName: monster.name,
        areaId,
        at,
      });
      useCombatStatsStore.getState().recordDeath({});
      events.push({
        id: '',
        at,
        tone: 'death',
        label: 'Hunter Down',
        detail: `Killed by ${monster.name} in ${area.name}.`,
        areaId,
        value: 0,
      });
      // Stop the ticker on death. The resurrection flow (PR 5) will
      // restart it via `mountIdleTicker` after the player recovers.
      useIdleTickerStore.getState().stop();
      break;
    }
  }

  // Shield recharge: per-tick regen (Phase 4).
  const rechargeRate = equippedShieldRechargeRate();
  if (rechargeRate > 0 && !useSurvivalStore.getState().isDead) {
    const shieldProfile = useLoadoutStore.getState().getShield();
    const shieldCap = shieldProfile?.hp ?? 0;
    const rechargeAmount = rechargeRate * ticks * (TICK_MS / 1000);
    const currentShield = useSurvivalStore.getState().shieldHp;
    if (currentShield < shieldCap) {
      const actualRecharge = Math.min(rechargeAmount, shieldCap - currentShield);
      useSurvivalStore.getState().refillShield(actualRecharge);
    }
  }

  return events;
};

/**
 * Per-tick kill cycle — apply hunter→monster damage, check for kill,
 * spawn the next target. Returns the events to push to the feed.
 *
 * The kill cycle is separate from the survival tick because:
 *   1. The monster can die mid-tick (rare with low DPS, common with
 *      high DPS), so the loop body needs to recheck the target state
 *      after each application.
 *   2. On a kill, we want to fire a single consolidated "kill" event
 *      (with XP) rather than scattering it.
 *   3. The spawn logic needs the area's full roster, which is a
 *      different lookup than the per-tick monster selector used by
 *      applySurvivalTick.
 *
 * This is PR 4's headline change. The user originally asked for
 * "I see a small HP bar under the enemy and it dies" — that's what
 * this function powers.
 */
const applyKillCycleTick = (areaId: string, ticks: number): TickEvent[] => {
  const events: TickEvent[] = [];
  const area = getRoamingArea(areaId);
  const killCycle = useKillCycleStore.getState();
  const now = Date.now();

  // If no current target, spawn one. This happens on the first tick
  // after entering the area, or after a kill. We do this *once* at
  // the top of the function, not per-tick, to avoid spawning a new
  // target every 3s for a player who's idling with 0 DPS.
  if (!killCycle.currentTargetId) {
    const roster = resolveAreaMonsters(area);
    if (roster.length === 0) return events;
    const next = pickNextTarget(roster, killCycle.lastKilledMonsterId);
    if (next) {
      useKillCycleStore.getState().spawnTarget(next);
    }
  }

  const effectiveDps = loadoutEffectiveDps();

  for (let i = 0; i < ticks; i += 1) {
    if (useSurvivalStore.getState().isDead) break;
    const currentKillCycle = useKillCycleStore.getState();
    if (!currentKillCycle.currentTargetId) break;

    // Resolve the current monster from the slice.
    const targetId = currentKillCycle.currentTargetId;
    const roster = resolveAreaMonsters(area);
    const monster = roster.find((m) => m.id === targetId);
    if (!monster) {
      // Stale target id (e.g. area was reconfigured). Clear and break.
      useKillCycleStore.getState().clearTarget();
      break;
    }

    // No DPS? Skip the damage application (the kill cycle pauses
    // visually until the player equips a weapon).
    if (effectiveDps <= 0) break;

    const weapon: WeaponDamageSource = { effectiveDps };
    const damage = computePlayerDamageVsMonster(weapon, monster);
    useKillCycleStore.getState().applyPlayerDamage(damage);

    const at = now - (ticks - 1 - i) * TICK_MS;
    const afterDmg = useKillCycleStore.getState();

    if (afterDmg.currentTargetHp > 0) {
      // Normal hit — emit a damage event for the feed.
      events.push({
        id: '',
        at,
        tone: 'loot', // reuse the 'loot' tone (green dot) for hit feedback
        label: `-${damage} HP`,
        detail: `Hit ${monster.name} for ${damage} HP.`,
        areaId,
        value: damage,
      });
    } else {
      // KILL! The local cycle advances targets for display only. XP and
      // resources come from the Chef claim so the same kill cannot award
      // local XP and server XP.
      const killedId = useKillCycleStore.getState().killCurrentTarget();
      events.push({
        id: '',
        at,
        tone: 'kill',
        label: 'Kill pending',
        detail: `Killed ${monster.name}; rewards resolve through Chef.`,
        areaId,
        value: 0,
      });

      // Spawn the next target. We use the just-killed id as the
      // "previous" so pickNextTarget rotates forward.
      const nextRoster = resolveAreaMonsters(area);
      const next = pickNextTarget(nextRoster, killedId);
      if (next) {
        useKillCycleStore.getState().spawnTarget(next);
        events.push({
          id: '',
          at,
          tone: 'kill',
          label: 'New target',
          detail: `${next.name} approaches.`,
          areaId,
          value: 0,
        });
      }
    }
  }

  return events;
};

/**
 * applyBossFightTick — advance the live boss fight by one ticker step.
 *
 * PR 6 — this is what makes the boss fight "real medkit attrition"
 * instead of a one-shot sim. The 3s ticker calls this once per tick
 * when the active activity is `boss_fight`. The function:
 *
 *   1. Looks up the boss by ID.
 *   2. Reads the live-fight state from `useBossStore`.
 *   3. Reads player loadout DPS, current HP, shield, auto-eat threshold,
 *      and medkit count.
 *   4. Calls the pure `bossTick()` from `@/lib/combat/bossTick`.
 *   5. Applies the result: HP delta → `applyDamage`/`heal` on the
 *      survival slice, medkits consumed → `removeConsumable` on the
 *      player store, boss state → `applyLiveTick` on the boss store.
 *   6. On victory: `endLiveFight('victory')`, `defeatBoss(bossId)`,
 *      push a 'victory' tick event, and clear the live fight after
 *      a short delay so the result UI has time to read the state.
 *   7. On defeat: `endLiveFight('defeat')`, increment pity, call
 *      `die()` on the survival slice (PR 5 death overlay takes over),
 *      push a 'defeat' tick event.
 *
 * If the fight is not 'active' (idle, victory, defeat) we bail early
 * so the ticker doesn't double-apply a result.
 */
const applyBossFightTick = async (bossId: string): Promise<void> => {
  const boss = REGION_1_BOSSES.find((b) => b.id === bossId);
  if (!boss) return;

  const bossStore = useBossStore.getState();
  if (bossStore.activeStatus !== 'active' || bossStore.activeBossId !== bossId) {
    return;
  }

  const player = usePlayerStore.getState();
  const survival = useSurvivalStore.getState();

  // Player effective DPS from the same chain the kill cycle uses.
  // loadoutEffectiveDps() reads useLoadoutStore.getState() internally.
  const playerDps = loadoutEffectiveDps();

  const medkitCount = player.getConsumableCount('MedKit');
  const shieldMit = equippedShieldMitigation();
  const effectiveBossDps = bossDamagePerSecond(boss) * (1 - Math.min(0.8, shieldMit));
  const result = bossTick({
    boss,
    currentBossHp: bossStore.activeBossHp,
    currentPlayerHp: survival.currentHp,
    currentPlayerShield: survival.shieldHp,
    playerDps,
    bossDps: effectiveBossDps,
    maxPlayerHp: survival.maxHp,
    autoEatThreshold: survival.autoEatThreshold,
    medkitsAvailable: medkitCount,
  });

  // 1. Push the per-tick damage events to the feed.
  const events: TickEvent[] = [];
  const tickAt = Date.now();
  if (result.damageDealt > 0) {
    events.push({
      id: '',
      at: tickAt,
      tone: 'kill',
      label: boss.name,
      detail: `−${Math.round(result.damageDealt).toLocaleString()} HP`,
      areaId: 'boss_arena',
      value: 0,
    });
  }
  if (result.damageTaken > 0) {
    events.push({
      id: '',
      at: tickAt,
      tone: 'damage',
      label: boss.name,
      detail: `−${Math.round(result.damageTaken).toLocaleString()} HP`,
      areaId: 'boss_arena',
      value: Math.round(result.damageTaken),
    });
  }
  if (result.medkitsConsumed > 0) {
    events.push({
      id: '',
      at: tickAt,
      tone: 'heal',
      label: 'MedKit (auto)',
      detail: `+${result.medkitsConsumed} used`,
      areaId: 'boss_arena',
      value: result.medkitsConsumed,
    });
  }

  // 2. Apply HP delta to the player. Boss damage is post-shield, so
  //    applyDamage with that net number. If auto-eat healed us, the
  //    net result.playerHp is higher than currentPlayerHp.
  const hpDelta = result.playerHp - survival.currentHp;
  if (hpDelta < 0) {
    survival.applyDamage(-hpDelta);
  } else if (hpDelta > 0) {
    survival.heal(hpDelta);
  }
  // Sync shield too — bossTick() may have absorbed some damage.
  if (result.playerShield !== survival.shieldHp) {
    useSurvivalStore.setState({ shieldHp: result.playerShield });
  }

  // 3. Consume medkits (real, not just a flag).
  if (result.medkitsConsumed > 0) {
    player.removeConsumable('MedKit', result.medkitsConsumed);
  }

  // 4. Update the boss store's live-fight state.
  bossStore.applyLiveTick({
    bossHp: result.bossHp,
    medkitsConsumed: result.medkitsConsumed,
    damageDealt: result.damageDealt,
  });

  // 5. Resolve status.
  if (result.status === 'victory') {
    events.push({
      id: '',
      at: tickAt,
      tone: 'loot',
      label: `${boss.name} defeated`,
      detail: `${result.damageDealt.toLocaleString(undefined, { maximumFractionDigits: 0 })} damage dealt`,
      areaId: 'boss_arena',
      value: 0,
    });
    bossStore.endLiveFight('victory');
    bossStore.defeatBoss(bossId);
    bossStore.resetPity(bossId);
    // Clear the live fight on the next microtask so any UI reading
    // activeStatus='victory' has a frame to render the result.
    queueMicrotask(() => bossStore.clearLiveFight());
  } else if (result.status === 'defeat') {
    events.push({
      id: '',
      at: tickAt,
      tone: 'damage',
      label: 'Hunter down',
      detail: `Killed by ${boss.name}`,
      areaId: 'boss_arena',
      value: 0,
    });
    bossStore.endLiveFight('defeat');
    bossStore.incrementPity(bossId);
    // Trigger the PR 5 death overlay with this boss as the killer.
    survival.die({
      monsterId: boss.id,
      monsterName: boss.name,
      areaId: 'boss_arena',
      at: tickAt,
    });
    queueMicrotask(() => bossStore.clearLiveFight());
  }

  if (events.length > 0) {
    useTickFeedStore.getState().push(events);
  }

  // Shield recharge: per-tick regen during boss fights (Phase 4).
  if (result.status === 'ongoing') {
    const rechargeRate = equippedShieldRechargeRate();
    if (rechargeRate > 0) {
      const shieldProfile = useLoadoutStore.getState().getShield();
      const shieldCap = shieldProfile?.hp ?? 0;
      const rechargeAmount = rechargeRate * (TICK_MS / 1000);
      const currentShield = useSurvivalStore.getState().shieldHp;
      if (currentShield < shieldCap) {
        const actualRecharge = Math.min(rechargeAmount, shieldCap - currentShield);
        useSurvivalStore.getState().refillShield(actualRecharge);
      }
    }
  }
};

const applyServerRewards = (payload: Record<string, unknown> | undefined) => {
  if (!payload) return;
  // Phase 1b: syncVerifiedResult sets canonical player totals
  // (credits, XP, scrap, materials, essences, fragments) from the
  // server's profile snapshot. The rewards payload fields
  // (credits_awarded, xp_awarded, etc.) are retained for feed
  // display only — they are already accounted for in the profile
  // snapshot returned by the server.
  syncVerifiedResult(payload);

  // Phase 3b: Sync authoritative kill cycle and survival state from Chef.
  // The Chef simulates the kill cycle and survival damage server-side;
  // the client's local simulation is cosmetic only and may drift.
  // We apply the server-authoritative state here to keep them in sync.
  const killCycle = payload.killCycle as
    | {
        currentTargetId: string | null;
        currentTargetHp: number;
        currentTargetHpMax: number;
        monstersKilledCount: number;
        totalKills: number;
        lastKilledMonsterId: string | null;
      }
    | undefined;
  const survival = payload.survival as
    | { currentHp: number; shieldHp: number; isDead?: boolean }
    | undefined;

  if (killCycle) {
    useKillCycleStore.getState().syncFromServer(killCycle);
  }
  if (survival) {
    useSurvivalStore.getState().syncFromServer(survival);
  }

  // Sync consumable state from Chef
  const survivalData = payload.survival as
    | { medKitBuffer?: number; nanoSwarmTicksRemaining?: number; adrenalineActive?: boolean; }
    | undefined;
  if (survival && survivalData) {
    useSurvivalStore.getState().syncFromServer({ ...survival, ...survivalData });
  }

  // Store roaming consumable state for next claim
  if (payload.roamingConsumableState) {
    roamingConsumableState = payload.roamingConsumableState;
  }

  // Sync active buffs from Chef (server-authoritative roaming buffs)
  const serverActiveBuffs = payload.activeBuffs as
    | Array<{ consumableId: string; slot: string; remainingMs: number; remainingBuffer?: number; remainingTicks?: number; armed?: boolean; }>
    | undefined;
  if (serverActiveBuffs) {
    useActiveBuffsStore.getState().syncRoamingFromServer(serverActiveBuffs);
  }
};

export const useIdleTickerStore = create<IdleTickerState>()((set, get) => ({
  running: false,
  lastTickAt: 0,
  totalTickCount: 0,
  start: () => {
    if (intervalId) return;
    intervalId = setInterval(() => {
      void get().tickNow();
    }, TICK_MS);
    set({ running: true });
  },
  stop: () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    set({ running: false });
  },
  tickNow: async () => {
    if (ticking) return;
    ticking = true;
    try {
      // Hard stop when the hunter is dead. The resurrection flow
      // (PR 5) restarts the ticker after the player recovers.
      if (useSurvivalStore.getState().isDead) {
        return;
      }

      const activity = useActivityStore.getState().current;
      const now = Date.now();
      const sinceLast = lastTickAt === 0 ? TICK_MS : now - lastTickAt;
      const ticks = Math.max(1, Math.min(20, Math.floor(sinceLast / TICK_MS)));
      lastTickAt = now;
      set({ lastTickAt: now });

      if (activity.kind !== 'roaming_loot') {
        // PR 6 — live boss fight. The activity is a boss; the 3s
        // ticker drives the per-tick attrition. Death overlay
        // (PR 5) fires on defeat; victory ends the fight and
        // records the defeatBoss state on the boss store.
        if (activity.kind === 'boss_fight' && activity.targetType === 'boss' && activity.targetId) {
          await applyBossFightTick(activity.targetId);
        }
        return;
      }

      const areaId = activity.targetId || useIdleStore.getState().selectedRoamingAreaId || DEFAULT_AREA_ID;
      if (!areaId) return;

      // Detect area change: reset the kill cycle so the player gets
      // a fresh target from the new area's roster and the per-area
      // kill counter starts at 0.
      if (lastTickedAreaId !== null && lastTickedAreaId !== areaId) {
        useKillCycleStore.getState().resetForAreaChange();
      }
      lastTickedAreaId = areaId;

      // Phase 2d: deterministic tick RNG. The same (player, area, tickCount)
      // tuple produces the same random stream. The server uses the same tuple
      // in cc_claim_roaming_rewards via the Mulberry32 port (migration 003).
      // Seed totalTickCount from the server-authoritative lastClaimedTick on first
      // tick after page load. Without this, the client counter starts at 0 while
      // the server profile.last_claimed_tick persists across sessions, causing the
      // RPC ordering guard (tick_count <= last_claimed_tick) to reject every claim.
      if (totalTickCount === 0) {
        const serverTick = usePlayerStore.getState().lastClaimedTick;
        if (serverTick > 0) {
          totalTickCount = serverTick;
        }
      }
      totalTickCount += 1;
      const playerId = usePlayerStore.getState().id;
      const tickRng = playerId ? createTickRng(playerId, areaId, totalTickCount) : Math.random;

      // Compute estimated per-tick resource rates for the preview feed.
      // Mirrors the Chef's math: area rates ÷ 20 ticks/min × multipliers.
      const area = getRoamingArea(areaId);
      const baseCredits = Math.round((area?.idleCreditsPerMinute ?? 15) / 20);
      const baseScrap = Math.round((area?.idleScrapPerMinute ?? 3) / 20);
      const baseXp = area?.idleXpPerTick ?? 1;
      const skillBonuses = useSkillStore.getState().getBonuses();
      const offlineMult = 1 + (skillBonuses.offlineEarnings || 0);
      const scrapMult = 1 + (skillBonuses.scrapYield || 0);
      const estCredits = Math.round(baseCredits * offlineMult);
      const estScrap = Math.round(baseScrap * scrapMult);
      const estXp = Math.round(baseXp);

      const previewEvents = rollPreviewEvents(areaId, ticks, tickRng, estCredits, estScrap, estXp, usePlayerStore.getState().level);
      const survivalEvents = applySurvivalTick(areaId, ticks);
      const killCycleEvents = applyKillCycleTick(areaId, ticks);
      const allEvents = [...previewEvents, ...survivalEvents, ...killCycleEvents];
      pushPreviewEvents(allEvents);

      // If the hunter died this tick, skip reward claims and the
      // server reconciliation — the death is local-only for now
      // (server-side HP persistence is a future PR).
      if (useSurvivalStore.getState().isDead) {
        return;
      }


      // Phase 3: Chef is the authoritative engine. Try the Chef API first,
      // fall back to the Supabase RPC if the Chef is unreachable.
      //
      // The Chef generates items, awards resources, and processes survival /
      // kill cycle events. All state mutations (inventory, player resources,
      // survival HP) come from the Chef response.
      try {
        const playerId = usePlayerStore.getState().id;
        if (playerId) {
          const { submitClaim } = await import('@/lib/chef/chefClient');
          const loadout = useLoadoutStore.getState();
          const skillBonuses = useSkillStore.getState().getBonuses();

          // Sum idle economy mods from equipped weapons + relic (Phase 5c).
          const idleMods = {
            offlineEarningsMod: 0,
            scrapYieldMod: 0,
            rareDropChanceMod: 0,
          };
          for (const slot of ['primary', 'secondary', 'heavy'] as const) {
            const weapon = loadout.getWeapon(slot);
            if (weapon) {
              idleMods.offlineEarningsMod += weapon.offlineEarningsMod || 0;
              idleMods.scrapYieldMod += weapon.scrapYieldMod || 0;
              idleMods.rareDropChanceMod += weapon.rareDropChanceMod || 0;
            }
          }
          // Add relic affix contributions.
          const relic = loadout.getRelic();
          if (relic) {
            for (const affix of relic.affixes) {
              if (affix.stat === 'offlineEarningsMod') idleMods.offlineEarningsMod += affix.value;
              if (affix.stat === 'scrapYieldMod') idleMods.scrapYieldMod += affix.value;
              if (affix.stat === 'rareDropChanceMod') idleMods.rareDropChanceMod += affix.value;
            }
          }
          const equippedGear = [
            loadout.getWeapon('primary'),
            loadout.getWeapon('secondary'),
            loadout.getWeapon('heavy'),
            loadout.getShield(),
            loadout.getClassMod(),
            relic,
            loadout.getOrdnance(),
          ].filter((item): item is GearItem => Boolean(item));
          const activityMods = sumActivityModifier(equippedGear, 'roaming_loot');

          const chefResult = await submitClaim({
            playerId,
            areaId,
            ticks,
            tickCount: totalTickCount,
            playerLevel: usePlayerStore.getState().level,
            idleMods,
            skillBonuses,
            activityMods,
            equippedGear,
            effectiveDps: loadoutEffectiveDps(),
            killCycle: {
              currentTargetId: useKillCycleStore.getState().currentTargetId,
              currentTargetHp: useKillCycleStore.getState().currentTargetHp,
              currentTargetHpMax: useKillCycleStore.getState().currentTargetHpMax,
              monstersKilledCount: useKillCycleStore.getState().monstersKilledCount,
              totalKills: useKillCycleStore.getState().totalKills,
              lastKilledMonsterId: useKillCycleStore.getState().lastKilledMonsterId,
            },
            survival: {
              currentHp: useSurvivalStore.getState().currentHp,
              shieldHp: useSurvivalStore.getState().shieldHp,
              maxHp: useSurvivalStore.getState().maxHp,
            },
            loadoutConsumables: useLoadoutStore.getState().consumables,
            roamingConsumableState: roamingConsumableState,
          });

          // Apply canonical results from the Chef
          applyServerRewards(chefResult as unknown as Record<string, unknown>);
          const confirmedKills = chefResult.rewards?.killsRecorded ?? 0;
          if (confirmedKills > 0) {
            useCombatStatsStore.getState().recordKill({ areaId, count: confirmedKills });
            try {
              const { saveCombatStats } = await import('@/store/combatStatsSupabaseSync');
              await saveCombatStats(playerId);
            } catch (error) {
              void error;
            }
          }

          // Replace only preview events with canonical Chef feed events.
          // Kill cycle and survival events (enemy HP, damage, kills, death,
          // heals) are NOT wiped — they drive the diorama animations and must
          // persist across Chef responses. Clearing them would cause the enemy
          // death animation to break (enemy resurrects when the kill event vanishes).
          const feedStore = useTickFeedStore.getState();
          if (chefResult.feedEvents && chefResult.feedEvents.length > 0) {
            // Keep only kill-cycle and survival events
            const keeperTones = new Set(['kill', 'damage', 'death', 'heal']);
            const keepers = feedStore.events.filter((e) => keeperTones.has(e.tone));
            // Prepend canonical Chef events (most recent first) + keepers
            const merged = [...(chefResult.feedEvents as TickEvent[]), ...keepers];
            // Clear and repopulate in correct order
            if (feedStore.clear) {
              feedStore.clear();
            }
            feedStore.push(merged);
          }

          // Add Chef-generated items to inventory
          if (chefResult.items && chefResult.items.length > 0) {
            const inv = useInventoryStore.getState();
            if (inv.receiveServerItems) {
              inv.receiveServerItems(chefResult.items);
            } else {
              chefResult.items.forEach((item) => inv.upsertItem(item as GearItem));
            }
          }
        }
      } catch (error) {
        // Chef unavailable — fall back to Supabase RPC
        console.warn('[idleTicker] Chef unavailable, falling back to RPC:', error);
        try {
          const result = await verifiedOps.claimRoamingRewards({ ticks, areaId, tickCount: totalTickCount });
          applyServerRewards(result as Record<string, unknown>);
        } catch (rpcError) {
          console.warn('[idleTicker] roaming rewards RPC also failed:', rpcError);
        }
      }

      // Persist runtime stores to Supabase (debounced sync)
      await saveCurrentRuntimeStores();
    } finally {
      ticking = false;
    }
  },
}));

/** Mount the singleton ticker interval. Call from App.tsx once. */
export const mountIdleTicker = (): void => {
  if (intervalId) return;
  intervalId = setInterval(() => {
    void useIdleTickerStore.getState().tickNow();
  }, TICK_MS);
  useIdleTickerStore.setState({ running: true, lastTickAt: Date.now() });
};

/** Unmount the singleton ticker interval. Call on logout / unmount. */
export const unmountIdleTicker = (): void => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  useIdleTickerStore.setState({ running: false });
  lastTickAt = 0;
  lastTickedAreaId = null;
};

/** Resolve which area the ticker should be claiming for. */
export const resolveTickAreaId = (): string => {
  const activity = useActivityStore.getState().current;
  if (activity.kind === 'roaming_loot' && activity.targetId) return activity.targetId;
  return useIdleStore.getState().selectedRoamingAreaId || DEFAULT_AREA_ID;
};

/** Type guard to detect a weapon in a gear drop. */
export const isWeaponDrop = (gear: GearItem | undefined): gear is Weapon => !!gear && 'weaponType' in gear;
