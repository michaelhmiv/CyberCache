# Phase 5 Implementation Plan: Profile Redesign + Global Leaderboards

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Transform the profile screen into a rich player dashboard and add global daily-snapshot leaderboards, with stat drill-downs that expose progression history and rank.

**Scope boundaries (Phase 5 only):**
- Public profile dashboard with grouped stat cards
- Global leaderboards derived from daily progression snapshots
- Stat detail panel (sparkline history + global rank)
- Net worth redefined as total assets (credits + scrap + item values) and made public as an aggregate
- Weapon/item valuation baseline for net worth and leaderboards
- Keep credits balance, scrap balance, consumables, and full inventory details private
- No guild/friend scoped leaderboards yet (Phase 6)
- No real-time leaderboard updates (daily snapshot basis only)

**Architecture decisions:**
1. **Server-authoritative valuation.** Item `estimated_value` is computed server-side on generation/update; client never calculates net worth.
2. **Leaderboards read from `player_progression_snapshots`.** Rank players by their most recent snapshot per metric. No separate leaderboard table needed yet.
3. **Aggregate public, details private.** Net worth is public as one number; composition remains private.
4. **Daily granularity.** All leaderboard values reflect the latest daily snapshot. Historical period filters (`all_time`, `weekly`, `daily`) reuse the same snapshot table.
5. **Generic leaderboard RPC.** `cc_get_leaderboard(metric, period, limit_count)` supports future scope extensions (`guild`, `friends`) without frontend rewrites.
6. **RLS unchanged.** Snapshots remain readable only by the owner; leaderboard RPC is service-role-only and returns sanitized public data.
7. **Continue free-tier discipline.** Leaderboard queries must be index-friendly and not materialize large intermediate sets.

---

## Task 1: Weapon/item valuation

**Goal:** Give every item a computed `estimated_value` so net worth and wealth leaderboards are consistent.

**File:** `supabase/migrations/20260615100000_item_estimated_value.sql`

**Schema change:**
```sql
alter table public.player_items
  add column estimated_value bigint not null default 0;

-- Index for fast net worth aggregation
create index if not exists idx_player_items_owner_value
  on public.player_items (owner_id, estimated_value);
```

**Valuation function:**
```sql
create or replace function public.cc_compute_item_estimated_value(_item jsonb)
returns bigint
language plpgsql
immutable
security definer
set search_path = public
as $$
-- Baseline by rarity and item_level, plus small attribute quality bonus.
-- This is intentionally conservative; future iterations can weight affixes more.
$$;
```

**Update paths:**
- Migration backfills `estimated_value` for existing items.
- Item generation (Chef / drops) sets `estimated_value` at creation.
- Item upgrade/enchant paths recompute `estimated_value` after mutation.

**Tests:**
- Backfill assigns non-zero values to weapons and gear.
- Generated items carry `estimated_value`.
- Updating item attributes recomputes value.

---

## Task 2: Net worth redefinition

**Goal:** Make net worth equal total assets and expose it publicly as an aggregate.

**File:** `supabase/migrations/20260615110000_net_worth_total_assets.sql`

**Changes:**
- Update `player_public_stats` view:
  ```sql
  net_worth := coalesce(p.credits, 0)
             + coalesce(p.scrap, 0)
             + coalesce((
                 select sum(pi.estimated_value)
                 from public.player_items pi
                 where pi.owner_id = p.id
               ), 0);
  ```
- Update `cc_compute_player_snapshot` to pull `net_worth` from the view.

**Privacy guard:**
- The view still exposes `credits` and `scrap` to the owner only via RLS or separate private RPCs.
- `net_worth` is public as a single number; no breakdown is returned by leaderboard or public profile endpoints.

**Tests:**
- Snapshot `net_worth` equals credits + scrap + sum of item values.
- Public profile endpoint returns net worth but not credits/scrap.

---

## Task 3: Leaderboard RPCs

**File:** `supabase/migrations/20260615120000_leaderboard_rpc.sql`

**Function:**
```sql
create or replace function public.cc_get_leaderboard(
  _metric text,
  _period text default 'all_time',
  _limit int default 100
)
returns table (
  rank bigint,
  player_id uuid,
  username text,
  value numeric,
  previous_value numeric,
  trend numeric
)
language plpgsql
security definer
set search_path = public
as $$
-- Validate _metric against allowlist.
-- Pick latest snapshot per player within the period window.
-- Rank by value desc (or asc for deaths/low-is-better metrics if added later).
-- Return top N rows plus caller's own pinned row if outside top N.
$$;
```

**Supported metrics (Phase 5):**
- `level`
- `xp`
- `net_worth`
- `total_kills`
- `kdr` (computed from kills/deaths in snapshot)
- `highest_boss_tier`
- `total_mastery_xp`
- `highest_mastery_level`
- `legendary_items`
- `total_items`

**Period logic:**
- `all_time`: latest snapshot per player, no time filter.
- `daily`: latest snapshot per player with `snapshot_at >= now() - interval '1 day'`.
- `weekly`: latest snapshot per player with `snapshot_at >= now() - interval '7 days'`.

**Authority:**
- `grant execute on function public.cc_get_leaderboard to authenticated;`
- Keep metric allowlist server-side so clients cannot query arbitrary columns.

**Tests:**
- Returns ranked rows for each metric.
- Anon cannot call the RPC.
- Invalid metric returns an error or empty set.
- Period filters return expected subsets.

---

## Task 4: Public profile endpoint

**Goal:** Allow any authenticated player to view another player's public profile (stats only, no private wallet/inventory).

**File:** `supabase/migrations/20260615130000_public_profile_rpc.sql`

**Function:**
```sql
create or replace function public.cc_get_public_profile(_player_id uuid)
returns table (
  player_id uuid,
  username text,
  level int,
  xp bigint,
  net_worth bigint,
  total_kills bigint,
  total_deaths bigint,
  kdr numeric,
  highest_boss_tier int,
  total_mastery_xp bigint,
  highest_mastery_level int,
  legendary_items int,
  total_items int,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
-- Pull from player_public_stats view; filter out private fields.
$$;
```

**Tests:**
- Returns public fields for any player.
- Does not return credits, scrap, or inventory.
- Returns 404-ish empty row for non-existent player.

---

## Task 5: Profile screen redesign

**Goal:** Restructure ProfileScreen into a dashboard of grouped stat cards with drill-down interactions.

**File:** `src/screens/ProfileScreen.tsx`

**Layout:**
1. **Identity header**: username, level, XP bar, title/guest badge.
2. **Progression row**: level card, XP card, mastery XP card, highest mastery card.
3. **Combat row**: kills, deaths, K/D, highest boss tier.
4. **Economy row**: net worth (public), plus private cards for credits and scrap visually marked as private.
5. **Collection row**: total items, weapons, legendaries, highest item level.
6. **History section**: existing 2x2 progression sparkline grid.

**Card component:**
- New `src/components/profile/StatCard.tsx`
- Shows label, current value, mini sparkline, global rank badge (if public), and tap affordance.
- Public cards link to detail panel.
- Private cards show lock icon and no leaderboard link.

**Detail panel:**
- New `src/components/profile/StatDetailPanel.tsx`
- Bottom sheet / slide-over.
- Large sparkline for the selected metric.
- Start/current/best values and rate of change.
- Global rank + top percentile if applicable.
- "View leaderboard" button.

**Tests:**
- Render profile with all stat groups.
- Tap public stat opens detail panel.
- Private stats do not show leaderboard links.

---

## Task 6: Leaderboards screen

**Goal:** New dedicated screen for global rankings.

**Files:**
- `src/screens/LeaderboardsScreen.tsx`
- `src/components/leaderboard/LeaderboardList.tsx`
- `src/components/leaderboard/LeaderboardRow.tsx`
- `src/components/leaderboard/LeaderboardMetricPicker.tsx`

**Features:**
- Metric picker: Level, XP, Net Worth, Kills, K/D, Boss Tier, Mastery, Legendaries, Total Items.
- Period picker: All Time / Weekly / Daily.
- Ranked list with rank, username, value, trend vs prior snapshot.
- Pinned "Your rank" row at bottom if outside top 100.
- Tapping a row opens that player's public profile.

**Service:**
- `src/lib/supabase/leaderboardService.ts`
  - `getLeaderboard(metric, period, limit)` wrapper around `cc_get_leaderboard`.
  - TypeScript types for `LeaderboardEntry`, `LeaderboardMetric`, `LeaderboardPeriod`.

**Tests:**
- Render leaderboard for each metric.
- Handle empty states and loading.
- Row tap navigates to public profile.

---

## Task 7: Navigation update

**Goal:** Add leaderboards to the main navigation.

**File:** `src/App.tsx` (or current router entry)

**Changes:**
- Add bottom nav item for Leaderboards with a custom SVG icon (Borderlands-cyberpunk style).
- Keep profile accessible from bottom nav.
- Remove decorative screen titles per user preference; let data be the header.

**Tests:**
- Navigation switches between screens.
- Active tab state updates correctly.

---

## Task 8: Authority and privacy tests

**Goal:** Ensure private data stays private and new RPCs are properly gated.

**File:** `src/test/supabaseAuthority.test.ts`

**Additions:**
- `cc_get_leaderboard` callable by authenticated, blocked for anon.
- `cc_get_public_profile` callable by authenticated, blocked for anon.
- Authenticated user A cannot read user B's private snapshot rows via RLS.
- Public profile RPC does not expose credits/scrap/inventory.

**Tests:**
- Run full suite; target 100% pass rate.

---

## Task 9: Build, deploy, and verify

**Steps:**
1. Run migrations to production via `npx supabase db query --linked`.
2. Backfill `estimated_value` on existing items.
3. Run TypeScript check and full test suite.
4. Build frontend with `vite build`.
5. Deploy to Railway.
6. Verify prod:
   - Public profile RPC works.
   - Leaderboard RPC returns ranked rows for each metric.
   - Net worth snapshot reflects item values.
   - ProfileScreen renders new dashboard.
   - Leaderboards screen reachable from nav.

---

## Open decisions before implementation

1. **Weapon valuation formula specifics.** Need exact rarity multipliers and attribute weights, or start with a conservative baseline.
2. **K/D tie-breaking.** If two players have identical K/D, rank by kills? By fewer deaths?
3. **Net worth display formatting.** Compact (1.2M) or full number?
4. **Leaderboard list length.** Top 100 default, or smaller (50) for mobile?
5. **Profile shareability.** Do we want deep links to public profiles, or only in-app navigation for now?

---

## Future phases (not in scope)

- **Phase 6:** Guild and friend scoped leaderboards; richer player search.
- **Phase 7:** Marketplace-derived item valuation; trade history impact on net worth.
- **Phase 8:** Historical leaderboards by date; percentile badges; player comparison tool.
