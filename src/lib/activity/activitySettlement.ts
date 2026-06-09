import { buildAreaWeaponDropOptions, getRoamingArea, rollAreaDropKind, rollAreaMaterialFind } from '@/constants/roamingAreas';
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { useActivityStore, useIdleStore, useInventoryStore, usePlayerStore, useSkillStore } from '@/store';
import type { ActiveActivity } from '@/types/activity';
import type { GearItem } from '@/types/items';

const TICK_MS = 3000;
const DROP_CHANCE_PER_TICK = 0.22;
const CACHE_FRAGMENT_CHANCE_PER_TICK = 0.03;
const MATERIAL_FIND_CHANCE_PER_TICK = 0.08;
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

function generateAreaDrop(areaId: string): GearItem {
  const area = getRoamingArea(areaId);
  const inventory = useInventoryStore.getState();
  const level = usePlayerStore.getState().level;
  const kind = rollAreaDropKind(area);

  if (kind === 'weapon') return inventory.generateAndAdd(buildAreaWeaponDropOptions(area, level));
  if (kind === 'shield') return inventory.generateAndAddShield(level);
  if (kind === 'classMod') return inventory.generateAndAddClassMod(level);
  if (kind === 'relic') return inventory.generateAndAddRelic(level);
  return inventory.generateAndAddOrdnance(level);
}

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

    const skillBonuses = useSkillStore.getState().getBonuses();
    const creditsPerTick = Math.round((area.idleCreditsPerMinute / 20) * (1 + (skillBonuses.offlineEarnings || 0)));
    const scrapPerTick = Math.round((area.idleScrapPerMinute / 20) * (1 + (skillBonuses.scrapYield || 0)));
    const gearDrops: GearItem[] = [];
    let cacheFragments = 0;
    let materialFinds = 0;

    for (let i = 0; i < ticks; i += 1) {
      const drop = Math.random() < DROP_CHANCE_PER_TICK;
      const cache = Math.random() < CACHE_FRAGMENT_CHANCE_PER_TICK;
      const material = Math.random() < MATERIAL_FIND_CHANCE_PER_TICK;

      if (cache) cacheFragments += 1;
      if (drop) gearDrops.push(generateAreaDrop(area.id));
      if (!drop && !cache && material) {
        const find = rollAreaMaterialFind(area);
        if (find?.kind === 'material') {
          usePlayerStore.getState().addMaterial(find.type, 1);
          materialFinds += 1;
        }
        if (find?.kind === 'essence') {
          usePlayerStore.getState().addEssence(find.type, 1);
          materialFinds += 1;
        }
      }
    }

    const credits = creditsPerTick * ticks;
    const scrap = scrapPerTick * ticks;
    const xp = ticks;
    const settledThrough = from + ticks * TICK_MS;
    const playerStore = usePlayerStore.getState();
    playerStore.addCredits(credits);
    playerStore.addScrap(scrap);
    playerStore.addXP(xp);
    if (cacheFragments > 0) playerStore.addCacheKeyFragments(cacheFragments);
    playerStore.setPlayer({ lastClaimTime: settledThrough });
    useIdleStore.setState((state) => ({
      isFarming: true,
      farmTickCount: state.farmTickCount + ticks,
      selectedRoamingAreaId: area.id,
    }));

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
