/**
 * InMemoryJobStore — test mirror of PgJobStore (Route B, slice B5).
 *
 * Mirrors the observable semantics of the SQL jobs:
 *  - heartbeats follow cc_record_daily_heartbeats + the
 *    cc_record_player_snapshot throttle (same source, 5-minute floor,
 *    20-hour heartbeat guard, 7-day activity window);
 *  - prune follows cc_prune_progression_snapshots (throttled sources
 *    only, 30-day horizon, milestone sources kept);
 *  - NPC seeding replaces the NPC account's active stock, like the SQL
 *    path (cancel-then-insert in one transaction);
 *  - snapshot *contents* are not mirrored (the SQL compute function owns
 *    them and is verified against real Postgres); only row presence,
 *    source, and timing are tracked here.
 */
import { randomUUID } from 'node:crypto';
import type { JobStore, NotificationEventInput, NpcSeedItem } from './store';

export interface JobProfileData {
  id: string;
  updated_at: string;
}

export interface JobSnapshotData {
  player_id: string;
  source: string;
  snapshot_at: string;
}

export interface JobItemData {
  id: string;
  owner_user_id: string;
  kind: string;
  item_level: number;
  rarity: string;
  payload: Record<string, unknown>;
}

export interface JobListingData {
  id: string;
  seller_user_id: string;
  item_instance_id: string;
  price_credits: number;
  status: string;
}

export interface JobPushDeviceData {
  user_id: string;
  token: string;
  enabled: boolean;
}

export interface JobSeed {
  profiles: JobProfileData[];
  snapshots: JobSnapshotData[];
  items: JobItemData[];
  listings: JobListingData[];
  pushDevices: JobPushDeviceData[];
  notificationEvents: NotificationEventInput[];
}

export function emptyJobSeed(): JobSeed {
  return {
    profiles: [],
    snapshots: [],
    items: [],
    listings: [],
    pushDevices: [],
    notificationEvents: [],
  };
}

const THROTTLED_SOURCES = new Set(['daily_heartbeat', 'chef_claim', 'settlement']);
const DAY_MS = 24 * 60 * 60 * 1000;

export class InMemoryJobStore implements JobStore {
  readonly seed: JobSeed;
  private readonly now: () => number;
  private readonly nextId: () => string;

  constructor(
    seed: JobSeed = emptyJobSeed(),
    opts: { now?: () => number; nextId?: () => string } = {},
  ) {
    this.seed = seed;
    this.now = opts.now ?? (() => Date.now());
    this.nextId = opts.nextId ?? (() => randomUUID());
  }

  async recordDailyHeartbeats(): Promise<{ recorded: number }> {
    const now = this.now();
    let recorded = 0;
    for (const profile of this.seed.profiles) {
      if (Date.parse(profile.updated_at) <= now - 7 * DAY_MS) continue;
      const hasRecentHeartbeat = this.seed.snapshots.some(
        (s) => s.player_id === profile.id
          && s.source === 'daily_heartbeat'
          && Date.parse(s.snapshot_at) > now - 20 * 60 * 60 * 1000,
      );
      if (hasRecentHeartbeat) continue;
      // cc_record_player_snapshot throttles the same source per player.
      const lastSameSource = Math.max(
        ...this.seed.snapshots
          .filter((s) => s.player_id === profile.id && s.source === 'daily_heartbeat')
          .map((s) => Date.parse(s.snapshot_at)),
        Number.NEGATIVE_INFINITY,
      );
      if (now - lastSameSource < 5 * 60 * 1000) continue;
      this.seed.snapshots.push({
        player_id: profile.id,
        source: 'daily_heartbeat',
        snapshot_at: new Date(now).toISOString(),
      });
      recorded += 1;
    }
    return { recorded };
  }

  async pruneProgressionSnapshots(): Promise<{ pruned: number }> {
    const cutoff = this.now() - 30 * DAY_MS;
    const before = this.seed.snapshots.length;
    this.seed.snapshots = this.seed.snapshots.filter(
      (s) => !(THROTTLED_SOURCES.has(s.source) && Date.parse(s.snapshot_at) < cutoff),
    );
    return { pruned: before - this.seed.snapshots.length };
  }

  async seedNpcMarket(npcUserId: string, items: NpcSeedItem[]): Promise<{ seeded: number }> {
    for (const listing of this.seed.listings) {
      if (listing.seller_user_id === npcUserId && listing.status === 'active') {
        listing.status = 'cancelled';
      }
    }
    for (const item of items) {
      this.seed.items.push({
        id: item.id,
        owner_user_id: npcUserId,
        kind: item.kind,
        item_level: item.item_level,
        rarity: item.rarity,
        payload: item.payload,
      });
      this.seed.listings.push({
        id: this.nextId(),
        seller_user_id: npcUserId,
        item_instance_id: item.id,
        price_credits: item.price_credits,
        status: 'active',
      });
    }
    return { seeded: items.length };
  }

  async listActivePushTokens(playerId: string): Promise<string[]> {
    return this.seed.pushDevices
      .filter((d) => d.user_id === playerId && d.enabled)
      .map((d) => d.token)
      .filter(Boolean);
  }

  async recordNotificationEvent(event: NotificationEventInput): Promise<void> {
    this.seed.notificationEvents.push({ ...event });
  }
}
