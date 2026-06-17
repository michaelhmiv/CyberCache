export type ActivityKind =
  | 'none'
  | 'idle_standby'
  | 'roaming_loot'
  | 'boss_fight'
  | 'crafting'
  | 'salvaging'
  | 'workshop_service'
  | 'market_listing';

export type ActivityTargetType =
  | 'none'
  | 'roaming_area'
  | 'boss'
  | 'item'
  | 'workshop_job'
  | 'market_listing';

export type BossPhase = 'prep' | 'fight';

export const DEFAULT_BOSS_PHASE: BossPhase = 'prep';

export function isBossPhase(value: unknown): value is BossPhase {
  return value === 'prep' || value === 'fight';
}

export interface ActiveActivity {
  userId?: string;
  kind: ActivityKind;
  bossPhase: BossPhase;
  startedAt: string | null;
  completesAt: string | null;
  targetType: ActivityTargetType | string | null;
  targetId: string | null;
  targetLabel: string | null;
  sceneKey: string | null;
  notes: string | null;
  activityPayload: Record<string, unknown>;
  publicPayload: Record<string, unknown>;
  lastHeartbeatAt: string | null;
  publicVisible: boolean;
  schemaVersion: number;
  updatedAt: string | null;
}

export interface StartActivityInput {
  kind: ActivityKind;
  bossPhase?: BossPhase;
  targetType?: ActivityTargetType | string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  sceneKey?: string | null;
  expectedFinishAt?: string | null;
  notes?: string | null;
  activityPayload?: Record<string, unknown>;
  publicPayload?: Record<string, unknown>;
  publicVisible?: boolean;
}

export const IDLE_ACTIVITY: ActiveActivity = {
  kind: 'idle_standby',
  bossPhase: DEFAULT_BOSS_PHASE,
  startedAt: null,
  completesAt: null,
  targetType: null,
  targetId: null,
  targetLabel: null,
  sceneKey: null,
  notes: null,
  activityPayload: {},
  publicPayload: {},
  lastHeartbeatAt: null,
  publicVisible: true,
  schemaVersion: 1,
  updatedAt: null,
};

export const PRODUCTIVE_ACTIVITY_LABELS: Record<ActivityKind, string> = {
  none: 'None',
  idle_standby: 'Idle standby',
  roaming_loot: 'Roaming loot',
  boss_fight: 'Boss fight',
  crafting: 'Crafting',
  salvaging: 'Salvaging',
  workshop_service: 'Workshop service',
  market_listing: 'Market listing',
};

export function isProductiveActivity(kind: ActivityKind): boolean {
  return kind !== 'none' && kind !== 'idle_standby';
}
