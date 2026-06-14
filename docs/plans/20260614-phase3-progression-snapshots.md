# Phase 3 Implementation Plan: Player Progression Snapshots

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Capture player-state snapshots at meaningful moments so we can measure rate of progression, build activity history, and feed future leaderboards/analytics without relying on the current "latest" view only.

**Scope boundaries (Phase 3 only):**
- Snapshot schema + write path
- Event triggers (Chef claim, settlement, boss defeat, daily heartbeat)
- One read path: player's own 30-day history
- Minimal sparkline UI on Profile screen
- No public leaderboards yet (Phase 5)
- No complex rollups/aggregations yet (Phase 6)

**Architecture decisions:**
1. **Event-driven snapshots, not tick-based.** A 15-min tick would drown the DB. We snapshot when something meaningful happens.
2. **Daily heartbeat for idle players.** If a player hasn't produced an event snapshot in 24h, write one so we can draw continuous progression lines.
3. **Server-only write path.** The client never records snapshots; Chef, triggers, and a cron job do.
4. **Snapshot row is immutable.** Never UPDATE; retention deletes old rows.
5. **Versioned schema.** `snapshot_version` column lets us evolve metrics without breaking old rows.
6. **RLS isolation.** Players see only their own snapshot rows.
7. **30-day default retention for detailed rows.** Keeps table size bounded while we learn query patterns. (Configurable later.)

---

## Task 1: Schema migration

**File:** `supabase/migrations/20260614210000_player_progression_snapshots.sql`

**Schema:**
```sql
create table if not exists public.player_progression_snapshots (
  id bigint generated always as identity primary key,
  player_id uuid not null references auth.users(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  source text not null, -- 'chef_claim' | 'settlement' | 'boss_defeat' | 'daily_heartbeat' | 'manual'
  snapshot_version int not null default 1,
  level int,
  xp bigint,
  credits bigint,
  scrap bigint,
  total_kills bigint,
  total_deaths bigint,
  net_worth bigint,
  total_items int,
  weapons_owned int,
  legendary_items int,
  highest_item_level int,
  total_mastery_xp bigint,
  highest_mastery_level int,
  boss_defeats int,
  active_action text,
  metadata jsonb default '{}'::jsonb
);

create index if not exists idx_player_progression_snapshots_player_time
  on public.player_progression_snapshots (player_id, snapshot_at desc);

create index if not exists idx_player_progression_snapshots_source_time
  on public.player_progression_snapshots (source, snapshot_at desc);

-- Retention helper: keep 30 days of detailed snapshots
-- Phase 6 can convert older rows into weekly/monthly rollups before deletion.
```

**RLS:**
```sql
alter table public.player_progression_snapshots enable row level security;

create policy "Players read own snapshots"
  on public.player_progression_snapshots
  for select
  to authenticated
  using (player_id = auth.uid());

create policy "Service role inserts snapshots"
  on public.player_progression_snapshots
  for insert
  to service_role
  with check (true);
```

**Snapshot computation function:**
```sql
create or replace function public.cc_compute_player_snapshot(_player_id uuid)
returns public.player_progression_snapshots
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stats public.player_public_stats%rowtype;
  v_snapshot public.player_progression_snapshots;
  v_level int;
  v_xp bigint;
  v_credits bigint;
  v_scrap bigint;
  v_action text;
begin
  -- Pull from authoritative stats view
  select * into v_stats
  from public.player_public_stats
  where player_id = _player_id;

  -- Pull runtime state
  select level, xp, credits, scrap into v_level, v_xp, v_credits, v_scrap
  from public.player_runtime_snapshots
  where player_id = _player_id
  order by snapshot_at desc
  limit 1;

  -- Pull active action label
  select coalesce(payload->>'activity_label', kind::text)
  into v_action
  from public.active_actions
  where player_id = _player_id
  order by updated_at desc
  limit 1;

  v_snapshot.player_id := _player_id;
  v_snapshot.snapshot_at := now();
  v_snapshot.level := v_level;
  v_snapshot.xp := v_xp;
  v_snapshot.credits := v_credits;
  v_snapshot.scrap := v_scrap;
  v_snapshot.total_kills := v_stats.total_kills;
  v_snapshot.total_deaths := v_stats.total_deaths;
  v_snapshot.net_worth := v_stats.net_worth;
  v_snapshot.total_items := v_stats.total_items;
  v_snapshot.weapons_owned := v_stats.weapons_owned;
  v_snapshot.legendary_items := v_stats.legendary_items;
  v_snapshot.highest_item_level := v_stats.highest_item_level;
  v_snapshot.total_mastery_xp := v_stats.total_mastery_xp;
  v_snapshot.highest_mastery_level := v_stats.highest_mastery_level;
  v_snapshot.boss_defeats := (select count(*) from public.boss_defeats where player_id = _player_id);
  v_snapshot.active_action := v_action;

  return v_snapshot;
end;
$$;
```

**Recording function:**
```sql
create or replace function public.cc_record_player_snapshot(
  _player_id uuid,
  _source text,
  _metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot public.player_progression_snapshots%rowtype;
  v_new_id bigint;
  v_last_at timestamptz;
  v_min_interval interval := interval '5 minutes';
begin
  -- Throttle identical sources to avoid bursts (e.g. rapid Chef claims)
  select snapshot_at into v_last_at
  from public.player_progression_snapshots
  where player_id = _player_id and source = _source
  order by snapshot_at desc
  limit 1;

  if v_last_at is not null and now() - v_last_at < v_min_interval then
    return null;
  end if;

  v_snapshot := public.cc_compute_player_snapshot(_player_id);
  v_snapshot.source := _source;
  v_snapshot.metadata := _metadata;

  insert into public.player_progression_snapshots (
    player_id, snapshot_at, source, snapshot_version,
    level, xp, credits, scrap, total_kills, total_deaths, net_worth,
    total_items, weapons_owned, legendary_items, highest_item_level,
    total_mastery_xp, highest_mastery_level, boss_defeats, active_action, metadata
  ) values (
    v_snapshot.player_id, v_snapshot.snapshot_at, v_snapshot.source, v_snapshot.snapshot_version,
    v_snapshot.level, v_snapshot.xp, v_snapshot.credits, v_snapshot.scrap,
    v_snapshot.total_kills, v_snapshot.total_deaths, v_snapshot.net_worth,
    v_snapshot.total_items, v_snapshot.weapons_owned, v_snapshot.legendary_items,
    v_snapshot.highest_item_level, v_snapshot.total_mastery_xp, v_snapshot.highest_mastery_level,
    v_snapshot.boss_defeats, v_snapshot.active_action, v_snapshot.metadata
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;
```

**Authority:**
```sql
revoke all on function public.cc_compute_player_snapshot(uuid) from anon, authenticated;
grant execute on function public.cc_record_player_snapshot(uuid, text, jsonb) to service_role;
revoke all on function public.cc_record_player_snapshot(uuid, text, jsonb) from anon, authenticated;
```

**Review criteria for migration:**
- Throttle prevents snapshot spam.
- Uses existing `player_public_stats` view as authoritative source.
- Does not expose write RPC to authenticated users.
- Includes RLS for reads.

---

## Task 2: Event trigger wiring

**Files to inspect/edit:**
- `supabase/migrations/20260614210000_player_progression_snapshots.sql` (add triggers)
- Existing Chef RPC / verified action ledger logic

**Triggers to add:**

1. **After Chef reward claim**
   - Find where `cc_apply_chef_rewards` is called or where reward records are inserted.
   - After a successful Chef batch, call:
     ```sql
     perform public.cc_record_player_snapshot(_player_id, 'chef_claim', jsonb_build_object('batch_id', _batch_id));
     ```

2. **After activity settlement**
   - Find settlement completion point (likely in `cc_settle_activity` or equivalent).
   - Record snapshot with source `'settlement'`.

3. **After boss defeat**
   - Add trigger on `public.boss_defeats` insert:
     ```sql
     create or replace function public.trg_record_snapshot_on_boss_defeat()
     returns trigger
     language plpgsql
     security definer
     as $$
     begin
       perform public.cc_record_player_snapshot(new.player_id, 'boss_defeat');
       return new;
     end;
     $$;

     create trigger record_snapshot_on_boss_defeat
     after insert on public.boss_defeats
     for each row
     execute function public.trg_record_snapshot_on_boss_defeat();
     ```

4. **Daily heartbeat**
   - Create a cron job or edge function that runs once per day.
   - For every active player (last_seen within 7 days) without a snapshot in the last 24h, record one.
   - If using pg_cron:
     ```sql
     select cron.schedule('daily-player-snapshots', '0 6 * * *', $$
       select public.cc_record_player_snapshot(player_id, 'daily_heartbeat')
       from public.profiles
       where last_seen_at > now() - interval '7 days'
         and not exists (
           select 1 from public.player_progression_snapshots
           where player_id = profiles.id
             and source = 'daily_heartbeat'
             and snapshot_at > now() - interval '24 hours'
         );
     $$);
     ```
   - If pg_cron is not enabled in Supabase project, use an Edge Function + cron job outside.

**Review criteria:**
- Triggers run with `security definer`.
- No infinite loops (snapshot insert does not fire more snapshots).
- Heartbeat is rate-limited to one per player per 24h.

---

## Task 3: Client snapshot service

**File:** `src/lib/supabase/snapshotService.ts`

```typescript
import { supabase } from './client';

export interface ProgressionSnapshot {
  id: number;
  snapshot_at: string;
  source: string;
  level: number | null;
  xp: number | null;
  credits: number | null;
  scrap: number | null;
  total_kills: number | null;
  total_deaths: number | null;
  net_worth: number | null;
  total_items: number | null;
  weapons_owned: number | null;
  legendary_items: number | null;
  highest_item_level: number | null;
  total_mastery_xp: number | null;
  highest_mastery_level: number | null;
  boss_defeats: number | null;
  active_action: string | null;
  metadata: Record<string, unknown>;
}

export async function getMySnapshotHistory(
  metric: keyof ProgressionSnapshot,
  days = 30,
): Promise<ProgressionSnapshot[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await supabase
    .from('player_progression_snapshots')
    .select('*')
    .gte('snapshot_at', since.toISOString())
    .order('snapshot_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ProgressionSnapshot[];
}

export function buildSparkline(
  rows: ProgressionSnapshot[],
  metric: keyof ProgressionSnapshot,
): number[] {
  return rows
    .map((r) => r[metric])
    .filter((v): v is number => typeof v === 'number');
}
```

Export from `src/lib/supabase/index.ts`.

**Tests:** `src/test/snapshotService.test.ts` (buildSparkline logic, no live DB calls).

---

## Task 4: Sparkline UI on ProfileScreen

**File:** `src/screens/ProfileScreen.tsx`

Add a new card: **Progression History**
- Pull 30-day snapshots with `getMySnapshotHistory('net_worth')` on mount.
- Render a simple SVG sparkline for one metric (net worth or level).
- Add metric picker buttons: Level / Net Worth / Kills / Mastery XP.
- Show "No snapshots yet" if empty.

**Component:** `src/components/profile/Sparkline.tsx`
- Props: `data: number[]`, `color: string`, `width`, `height`.
- Simple SVG polyline with min/max normalization.
- Optional dots at data points.

**Design note:** Keep it compact. The user wants data, not clutter.

---

## Task 5: Authority tests

**File:** `src/test/supabaseAuthority.test.ts`

Add assertions:
- `cc_record_player_snapshot(uuid, text, jsonb)` is **not** granted to authenticated.
- `cc_compute_player_snapshot(uuid)` is **not** granted to authenticated.
- `player_progression_snapshots` table has `select` granted to authenticated.
- `player_progression_snapshots` has no `insert/update/delete` grants to authenticated.

---

## Task 6: Deploy and verify

1. Run `npx tsc --noEmit` and all Vitest tests.
2. Apply migration via `supabase db query --linked --file` (same approach as Phase 2 due to history conflicts).
3. Repair migration history.
4. Trigger a Chef claim / boss defeat / heartbeat and verify rows appear.
5. Build and push frontend.
6. Confirm Profile screen shows sparkline with real data.

---

## Open questions to resolve before implementation

1. **Heartbeat mechanism:** Is `pg_cron` enabled on this Supabase project, or should we use a Railway cron / Edge Function?
2. **Retention:** Keep 30 days of detailed snapshots as default, or longer/shorter?
3. **Metrics:** Are there any other stats we should snapshot now (e.g., skill points spent, specific mastery breakdowns)?
4. **Sampling:** Should we keep *all* event snapshots or downsample rapid events (e.g., keep max 1 per 5 minutes per source — already in the draft)?

Resolve these and then implement.