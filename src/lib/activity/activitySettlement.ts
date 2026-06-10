import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { useActivityStore, useIdleStore, usePlayerStore, useSkillStore, useLoadoutStore } from '@/store';
import type { ActiveActivity } from '@/types/activity';
import type { GearItem } from '@/types/items';
import { getRoamingArea } from '@/constants/roamingAreas';

const TICK_MS = 3000;
const SETTLEMENT_LOCK_KEY = 'cybercache:active-action-settlement-lock';
const LOCK_TTL_MS = 15000;

let settling = false;

export type ActivitySettlementResult = {
  kind: ActiveActivity['kind'];
  areaId?: string | null;
  ticks: number;
  xp: number;
  credits: number;
  scrap: number;
  cacheFragments: number;
  gearDrops: GearItem[];
  materialFinds: number;
  settledThrough: number;
};

const nowMs = () => Date.now();

const parseTime = (value?: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readLock = (): number => {
  if (typeof window === 'undefined') return 0;
  const parsed = Number(window.localStorage.getItem(SETTLEMENT_LOCK_KEY) ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const acquireLock = (): boolean => {
  if (typeof window === 'undefined') return true;
  const now = nowMs();
  const lockedUntil = readLock();
  if (lockedUntil > now) return false;
  window.localStorage.setItem(SETTLEMENT_LOCK_KEY, String(now + LOCK_TTL_MS));
  return true;
};

const releaseLock = (): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SETTLEMENT_LOCK_KEY);
};

/**
 * Settle accumulated offline roaming rewards by delegating to the Chef
 * server — the SINGLE authoritative source for all gameplay outcomes.
 *
 * Phase 3: All client-side item generation and resource awarding has been
 * removed. The function calculates elapsed ticks and sends a claim to the
 * Chef, which processes all probabilities, generates items, awards
 * resources, and returns the canonical result.
 */
export async function settleActiveActivityRewards(options: { userId?: string | null; saveSnapshot?: boolean } = {}): Promise<ActivitySettlementResult | null> {
  if (settling) return null;
  if (!acquireLock()) return null;
  settling = true;

  try {
    const activityStore = useActivityStore.getState();
    const current = activityStore.hydrated ? activityStore.current : await activityStore.hydrate();
    if (current.kind !== 'roaming_loot') return null;

    const player = usePlayerStore.getState();
    const areaId = current.targetId || useIdleStore.getState().selectedRoamingAreaId;
    const area = getRoamingArea(areaId);
    const actionStart = parseTime(current.startedAt) ?? nowMs();
    const lastClaim = Number.isFinite(player.lastClaimTime) ? player.lastClaimTime : actionStart;
    const from = Math.max(actionStart, lastClaim);
    const capMs = Math.max(0.25, player.offlineCapHours || 2) * 60 * 60 * 1000;
    const elapsedMs = Math.min(Math.max(0, nowMs() - from), capMs);
    const ticks = Math.floor(elapsedMs / TICK_MS);
    if (ticks <= 0) return null;

    // Delegate ALL reward processing to the Chef — no client-side generation.
    const skillBonuses = useSkillStore.getState().getBonuses();
    const loadout = useLoadoutStore.getState();

    // Sum idle economy mods (same as the ticker does)
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
    const relic = loadout.getRelic();
    if (relic) {
      for (const affix of relic.affixes) {
        if (affix.stat === 'offlineEarningsMod') idleMods.offlineEarningsMod += affix.value;
        if (affix.stat === 'scrapYieldMod') idleMods.scrapYieldMod += affix.value;
        if (affix.stat === 'rareDropChanceMod') idleMods.rareDropChanceMod += affix.value;
      }
    }

    let chefResult: {
      rewards?: { creditsAwarded?: number; scrapAwarded?: number; xpAwarded?: number; cacheFragmentsAwarded?: number; materials?: Record<string, number>; essences?: Record<string, number> };
      items?: GearItem[];
      feedEvents?: Array<{ at: number; tone: string; label: string; detail: string; areaId: string; value?: number }>;
    } | null = null;

    try {
      const { submitClaim } = await import('@/lib/chef/chefClient');
      chefResult = await submitClaim({
        playerId: player.id,
        areaId: area.id,
        ticks,
        tickCount: 0, // offline settlement — not part of the live tick counter
        playerLevel: player.level,
        idleMods,
        skillBonuses,
      });
    } catch (error) {
      console.warn('[activitySettlement] Chef claim failed, trying RPC fallback:', error instanceof Error ? error.message : error);
      try {
        const { verifiedOps } = await import('@/lib/supabase/verifiedOps');
        const rpcResult = await verifiedOps.claimRoamingRewards({ ticks, areaId: area.id, tickCount: 0 });
        chefResult = rpcResult as unknown as typeof chefResult;
      } catch (rpcError) {
        console.warn('[activitySettlement] RPC fallback also failed:', rpcError instanceof Error ? rpcError.message : rpcError);
      }
    }

    if (!chefResult) return null;

    const rewards = chefResult.rewards ?? {};
    const xp = rewards.xpAwarded ?? 0;
    const credits = rewards.creditsAwarded ?? 0;
    const scrap = rewards.scrapAwarded ?? 0;
    const cacheFragments = rewards.cacheFragmentsAwarded ?? 0;
    const gearDrops = chefResult.items ?? [];

    // Apply resources via the player store (which tracks pending deltas)
    const playerStore = usePlayerStore.getState();
    if (credits) playerStore.addCredits(credits);
    if (scrap) playerStore.addScrap(scrap);
    if (xp) playerStore.addXP(xp);
    if (cacheFragments) playerStore.addCacheKeyFragments(cacheFragments);

    // Apply materials/essences from Chef response
    const materials = rewards.materials ?? {};
    for (const [type, count] of Object.entries(materials)) {
      if (count > 0) playerStore.addMaterial(type, count);
    }
    const essences = rewards.essences ?? {};
    for (const [type, count] of Object.entries(essences)) {
      if (count > 0) playerStore.addEssence(type, count);
    }

    // Add Chef-generated items to inventory
    if (gearDrops.length > 0) {
      const inv = await import('@/store/slices/inventorySlice').then((m) => m.useInventoryStore.getState());
      if (inv.receiveServerItems) {
        inv.receiveServerItems(gearDrops);
      } else {
        gearDrops.forEach((item) => inv.upsertItem(item));
      }
    }

    const settledThrough = from + ticks * TICK_MS;
    playerStore.setPlayer({ lastClaimTime: settledThrough });
    useIdleStore.setState((state) => ({
      isFarming: true,
      farmTickCount: state.farmTickCount + ticks,
      selectedRoamingAreaId: area.id,
    }));

    const materialFinds = Object.values(materials).reduce((s, c) => s + c, 0) + Object.values(essences).reduce((s, c) => s + c, 0);

    const result: ActivitySettlementResult = {
      kind: current.kind,
      areaId: area.id,
      ticks,
      xp,
      credits,
      scrap,
      cacheFragments,
      gearDrops,
      materialFinds,
      settledThrough,
    };

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cybercache:activity-settled', { detail: result }));
    }
    if (options.saveSnapshot !== false) await saveCurrentRuntimeStores(options.userId ?? undefined);
    return result;
  } finally {
    settling = false;
    releaseLock();
  }
}

export function markActiveActionRewardTick(): void {
  const activity = useActivityStore.getState().current;
  if (activity.kind !== 'roaming_loot') return;
  usePlayerStore.getState().setPlayer({ lastClaimTime: nowMs() });
}
