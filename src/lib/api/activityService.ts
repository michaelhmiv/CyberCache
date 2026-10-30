/**
 * Activity service (Route B, slice B4) — transport swap onto the Chef
 * activity routes. Same signatures, same row→state mapping, same
 * `{ activity }` envelope unwrapping (the ported cc_* functions return
 * the identical jsonb). Identity comes from the Chef JWT.
 *
 * One wire difference vs. the RPC args: the Chef route reads the kind
 * as `activity_kind` (the RPC called it `action_kind`).
 */
import type { ActiveActivity, ActivityKind, StartActivityInput } from '@/types/activity';
import { IDLE_ACTIVITY } from '@/types/activity';
import { apiRequest } from './http';

const requestId = (prefix: string): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
};

type ActiveActionRow = {
  user_id?: string;
  active_action?: ActivityKind | string;
  started_at?: string | null;
  completes_at?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  target_label?: string | null;
  scene_key?: string | null;
  notes?: string | null;
  activity_payload?: Record<string, unknown> | null;
  public_payload?: Record<string, unknown> | null;
  last_heartbeat_at?: string | null;
  public_visible?: boolean | null;
  schema_version?: number | null;
  updated_at?: string | null;
};

type ActivityRpcResult = {
  activity?: ActiveActionRow;
};

const objectValue = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

export function activityRowToState(row?: ActiveActionRow | null): ActiveActivity {
  if (!row) return IDLE_ACTIVITY;

  return {
    userId: row.user_id,
    kind: (row.active_action as ActivityKind | undefined) ?? 'idle_standby',
    startedAt: row.started_at ?? null,
    completesAt: row.completes_at ?? null,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    targetLabel: row.target_label ?? null,
    sceneKey: row.scene_key ?? null,
    notes: row.notes ?? null,
    activityPayload: objectValue(row.activity_payload),
    publicPayload: objectValue(row.public_payload),
    lastHeartbeatAt: row.last_heartbeat_at ?? null,
    publicVisible: row.public_visible ?? true,
    schemaVersion: row.schema_version ?? 1,
    updatedAt: row.updated_at ?? null,
  };
}

export async function getMyActiveActivity(): Promise<ActiveActivity> {
  const data = await apiRequest<ActiveActionRow | null>('/activity/me');
  return activityRowToState(data ?? null);
}

export async function startActiveActivity(input: StartActivityInput): Promise<ActiveActivity> {
  const data = await apiRequest<ActivityRpcResult>('/activity/set', {
    method: 'POST',
    body: {
      nonce: requestId('activity'),
      activity_kind: input.kind,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      target_label: input.targetLabel ?? null,
      scene_key: input.sceneKey ?? null,
      expected_finish_at: input.expectedFinishAt ?? null,
      notes: input.notes ?? null,
      activity_payload: input.activityPayload ?? {},
      public_payload: input.publicPayload ?? {},
      public_visible: input.publicVisible ?? true,
    },
  });
  return activityRowToState(data?.activity ?? null);
}

export async function clearActiveActivity(): Promise<ActiveActivity> {
  const data = await apiRequest<ActivityRpcResult>('/activity/clear', {
    method: 'POST',
    body: { nonce: requestId('activity-clear') },
  });
  return activityRowToState(data?.activity ?? null);
}

export async function heartbeatActiveActivity(): Promise<ActiveActivity> {
  const data = await apiRequest<ActivityRpcResult>('/activity/heartbeat', { method: 'POST' });
  return activityRowToState(data?.activity ?? null);
}
