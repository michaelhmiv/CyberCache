# Player Stats, Progression & Leaderboards Proposal

**Goal:** Give players immersive "numbers go up" surfaces (profile stats, leaderboards, collection milestones) while simultaneously building the time-series data we need for backend progression analysis and balance tuning.

**Principle:** Every user-facing stat must be derived from the same server-authoritative tables that power analytics. No decorative numbers.

---

## 1. Why now

We already have:

- `profiles` — current player state (credits, scrap, xp, level, inventory counts, boss state).
- `item_instances` — every item owned with rarity, quality, kind, source, payload.
- `player_stat_counters` — cumulative counters (kills, cache draws, vendor buys, scrap generated, net worth).
- `player_masteries` — mastery XP/levels per domain.
- `combat_stats` — per-player combat aggregates (kills by area/element/weapon type, deaths, streaks).
- `verified_action_ledger` — every verified action with request/result payload JSONB.
- `active_actions` — current activity session with heartbeat.

What we **don't** have:

- Time-series snapshots for progression curves.
- A clean public-stats projection for other players' profiles.
- Leaderboard infrastructure.
- Weapons-looted-style collection stats surfaced to users.
- Activity/session history (online vs. offline time, area time).

This proposal closes those gaps in one coherent system.

---

## 2. User-facing stats taxonomy

### 2.1 Profile header / identity plate

| Stat | Source | Notes |
|---|---|---|
| Level | `profiles.player_level` | Already shown. |
| XP / XP to next | `profiles.player_xp` + `xpToNextLevel` | Already shown. |
| Account type | `profiles.account_type` | Verified / guest. |
| Title | derived from level + milestones | e.g., "Lv. 12 Gunrunner", "Cache Millionaire". |
| Joined date | `profiles.created_at` | For anniversary/legacy flair. |

### 2.2 Economy stats

| Stat | Source | Notes |
|---|---|---|
| Credits | `profiles.credits` | Current liquid. |
| Scrap | `profiles.scrap` | Current. |
| Net worth | `player_stat_counters.account.net_worth` | Credits + scrap (existing). |
| Total credits earned | new `player_progression_snapshots` or ledger rollup | Lifetime, not current. |
| Total scrap earned | new snapshot/rollup | Lifetime. |
| Cache tokens | `profiles.cache_tokens` | Current. |
| Cache fragments | `profiles.cache_token_parts` | Current. |
| Vendor purchases | `player_stat_counters.economy.vendor_buys` | Existing. |
| Market sales value | `market_listings` / `market_sales` | Aggregate credits moved. |
| Items recycled | `player_stat_counters.inventory.recycle.count` | Existing. |

### 2.3 Combat stats

| Stat | Source | Notes |
|---|---|---|
| Total kills | `combat_stats.total_kills` / `profiles` | Existing. |
| Total deaths | `combat_stats.total_deaths` | Existing. |
| K/D ratio | derived | kills / max(deaths, 1). |
| Kills by area | `combat_stats.kills_by_area` JSONB | Bar chart / top 3. |
| Kills by weapon type | `combat_stats.kills_by_weapon_type` JSONB | Favorite weapon type already computed client-side. |
| Kills by element | `combat_stats.kills_by_element` JSONB | Elemental preference. |
| Longest kill streak | `combat_stats.longest_kill_streak` | Existing. |
| Bosses defeated | `boss_state` JSONB in `profiles` | Already shown as `bossStore.defeatedBossIds.length`. |
| Highest boss tier | `combat_stats.highest_boss_tier` | Existing. |

### 2.4 Collection / gear stats

| Stat | Source | Notes |
|---|---|---|
| Total items | count `item_instances` by `owner_user_id` | Already shown. |
| Weapons owned | count `item_instances` where `kind = 'weapon'` | The user's explicit ask. |
| Shields / relics / class mods / ordnance | count by `kind` | Full breakdown. |
| Rarity distribution | count by `rarity` | Common / Uncommon / Rare / Epic / Legendary counts. |
| Legendary items | count where `rarity = 'Legendary'` | Already shown in profile. |
| Unique affixes seen | derived from `item_instances.payload.affixes` | Already shown client-side. |
| Favorite weapon type | derived from `item_instances.payload.weaponType` | Already shown. |
| Highest item level | max `item_instances.item_level` | Power ceiling. |
| Items looted (lifetime) | `player_stat_counters.inventory.cache_draws` + other sources | Needs source tracking. |
| Items salvaged | `player_stat_counters.inventory.recycle.count` | Existing. |

### 2.5 Activity / progression stats

| Stat | Source | Notes |
|---|---|---|
| Current activity | `active_actions` | Already shown. |
| Time in current activity | `active_actions.started_at` / `last_heartbeat_at` | Already derivable. |
| Total active play time | new session history or `combat_stats.active_play_seconds` | Existing `active_play_seconds`. |
| Total idle/offline time | `combat_stats.idle_play_seconds` | Existing. |
| Roaming area with most time | new `player_activity_history` | Top area. |
| Offline settlements | `player_stat_counters.actions.cc_settle_offline_roaming` | Existing. |
| Ticks claimed | `profiles.last_claimed_tick` | Progression velocity. |

### 2.6 Mastery stats

| Stat | Source | Notes |
|---|---|---|
| Mastery level per domain | `player_masteries` | Existing. |
| Total mastery XP | sum `player_masteries.mastery_xp` | Aggregate "mastery power". |
| Highest mastery | max level / XP | Top domain. |
| Mastery progress bars | `mastery_xp` vs next level threshold | Existing mastery definitions. |

---

## 3. Backend additions

### 3.1 New table: `player_progression_snapshots`

Time-series foundation for analytics and eventual historical graphs.

```sql
create table player_progression_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  -- core state
  player_level int not null,
  player_xp int not null,
  credits int not null,
  scrap int not null,
  cache_tokens int not null,
  cache_token_parts int not null,
  last_claimed_tick bigint not null,
  -- aggregates at this moment
  total_kills int not null default 0,
  total_deaths int not null default 0,
  net_worth int not null default 0,
  total_items int not null default 0,
  weapons_owned int not null default 0,
  legendary_items int not null default 0,
  highest_item_level int not null default 0,
  total_mastery_xp int not null default 0,
  highest_mastery_level int not null default 0,
  -- source / trigger
  source text not null default 'scheduled', -- scheduled | login | claim | settlement | boss | market | admin
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_pps_user_time on player_progression_snapshots(user_id, snapshot_at desc);
create index idx_pps_source on player_progression_snapshots(source);
```

**Population strategy:**

1. **Scheduled job** (every 15–60 min while player is active) via Railway cron or Supabase pg_cron.
2. **Event-triggered snapshots** on significant actions: `cc_apply_chef_rewards`, `cc_settle_offline_roaming`, boss defeat, cache draw.
3. **Login snapshot** to anchor the start of a session.

**Retention:** Roll up older snapshots to hourly/daily aggregates after 30 days to control cost.

### 3.2 New table: `player_activity_history`

Replaces the single-row `active_actions` update-in-place pattern with history.

```sql
create table player_activity_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity text not null, -- roaming_loot, boss_prep, boss_fight, workshop, standby, etc.
  target_id text,
  target_type text,
  target_label text,
  scene_key text,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds int generated always as (extract(epoch from (ended_at - started_at))) stored,
  activity_payload jsonb default '{}'::jsonb,
  public_payload jsonb default '{}'::jsonb,
  ended_reason text, -- player_action | offline_settlement | death | logout | system
  created_at timestamptz not null default now()
);

create index idx_pah_user_started on player_activity_history(user_id, started_at desc);
create index idx_pah_user_activity on player_activity_history(user_id, activity);
```

Migration path:

- On `cc_set_active_action`, insert new row and close previous open row.
- On `cc_clear_active_action`, close open row.
- On offline settlement, close roaming row with `ended_reason = 'offline_settlement'` and start a new standby/roaming row.

### 3.3 New view: `player_public_stats`

A safe, denormalized projection for public profiles and leaderboards.

```sql
create view player_public_stats as
select
  p.id as user_id,
  p.username,
  p.display_name,
  p.player_level,
  p.player_xp,
  p.credits,
  p.scrap,
  p.cache_tokens,
  p.cache_token_parts,
  coalesce(c.total_kills, 0) as total_kills,
  coalesce(c.total_deaths, 0) as total_deaths,
  coalesce(c.highest_boss_tier, 0) as highest_boss_tier,
  coalesce(c.longest_kill_streak, 0) as longest_kill_streak,
  coalesce(c.active_play_seconds, 0) as active_play_seconds,
  coalesce(c.idle_play_seconds, 0) as idle_play_seconds,
  coalesce(psc.stat_value, 0) as net_worth,
  (select count(*) from item_instances ii where ii.owner_user_id = p.id) as total_items,
  (select count(*) from item_instances ii where ii.owner_user_id = p.id and ii.kind = 'weapon') as weapons_owned,
  (select count(*) from item_instances ii where ii.owner_user_id = p.id and ii.rarity = 'Legendary') as legendary_items,
  (select coalesce(max(item_level), 0) from item_instances ii where ii.owner_user_id = p.id) as highest_item_level,
  (select coalesce(sum(mastery_xp), 0) from player_masteries pm where pm.user_id = p.id) as total_mastery_xp,
  (select coalesce(max(mastery_level), 0) from player_masteries pm where pm.user_id = p.id) as highest_mastery_level,
  p.updated_at as last_active_at
from profiles p
left join combat_stats c on c.user_id = p.id
left join player_stat_counters psc on psc.user_id = p.id and psc.stat_key = 'account.net_worth';
```

Rationale:

- One row per player.
- No sensitive data (email, inventory internals, runtime snapshots).
- Fast enough for leaderboards if indexed.

### 3.4 New RPCs

| RPC | Purpose | Notes |
|---|---|---|
| `cc_my_stats_summary()` | Returns full stat summary for the current user's profile page. | Security definer, reads all user-owned tables. |
| `cc_public_stats(user_id)` | Returns a single player's public projection. | Used for inspecting other players. |
| `cc_leaderboard(metric, limit, offset)` | Returns top N players by a metric. | metric enum: `level`, `net_worth`, `total_kills`, `weapons_owned`, `legendary_items`, `highest_boss_tier`, `total_mastery_xp`. |
| `cc_record_snapshot(source)` | Triggerable snapshot insert. | Called by Chef after major actions. |
| `cc_progression_curve(hours)` | Returns last N hours of snapshots for graphing. | Powers future XP/net-worth-over-time charts. |

**Security:**

- Public stats/leaderboards use the `player_public_stats` view.
- My stats use direct reads on owned rows.
- No authenticated user can call stat-counter write RPCs directly (already revoked per existing tests).

### 3.5 Ledger enrichment

Add context to `verified_action_ledger.result_payload` for `cc_apply_chef_rewards`:

```jsonc
{
  "area_id": "dustwaste_frontier",
  "weapon_id": "...",
  "activity_type": "roaming_loot",
  "ticks": 1,
  "is_offline": false
}
```

This lets analytics answer: "How much XP/credits does Dustwaste Frontier generate per hour at level 12?"

---

## 4. Frontend surfaces

### 4.1 Expanded `ProfileScreen`

Add new cards to the existing profile:

- **Stats Grid** — compact 2x4 grid: kills, deaths, K/D, bosses defeated, weapons owned, legendary items, net worth, total mastery XP.
- **Collection Patch** — expand existing patch: rarity breakdown, shields/relics/class mods/ordnance counts, highest item level, items looted.
- **Combat Breakdown** — top areas, weapon types, elements (read from `combat_stats` JSONB).
- **Mastery Strip** — horizontal list of mastered domains with level badges.
- **Activity Log** — recent `player_activity_history` rows (last 10), showing where the player spent time.

### 4.2 Public profile lookup

New route/screen: `PlayerProfileScreen(userId)`.

- Reads `cc_public_stats(user_id)` only.
- Shows a read-only version of the profile with public-safe stats.
- Does **not** show inventory, loadout, email, or runtime state.

### 4.3 Leaderboards

New screen: `LeaderboardsScreen`.

- Identity-first: every row shows the player's username; no anonymous entries.
- Category tabs: Level, Net Worth, Kills, Weapons Owned, Legendary Items, Boss Tier, Mastery.
- **Ranking snapshot:** the current user's rank in each category is shown at the top as a quick "where do I stand" overview, so players get a broad sense of their position without scrolling through each full list.
- Top 100 paginated per category.
- Highlight current user's row.
- Tap a row to open that player's public profile.
- Optional: global rank badge on the user's profile card.

### 4.4 Milestones / badges (future)

Once stats exist, we can add lightweight achievements:

- "First Blood" — 1 kill.
- "Arsenal" — 10 weapons.
- "Cache Rich" — 100,000 net worth.
- "Boss Slayer" — defeat first boss.

Stored in a new `player_milestones` table or derived from thresholds.

---

## 5. Implementation phases

### Phase 1: Foundation — public stats view + RPCs

- Create `player_public_stats` view.
- Create `cc_my_stats_summary()` and `cc_public_stats(user_id)` RPCs.
- Expand `ProfileScreen` to show new stats grid and collection breakdown.
- Add tests for RPC security and view shape.
- **Deliverable:** Richer profile page backed by authoritative data.

### Phase 2: Username enforcement gate

- Add unique username constraint, reserved-name table, and username RPCs.
- Auto-assign `guest_xxxxxxxx` handles to anonymous accounts.
- Add rename support with a 7-day cooldown.
- Add username setup modal for existing registered users without a handle.
- Update `FeatureGate` to require username for leaderboards/social features.
- **Deliverable:** Every visible identity has a unique handle; leaderboards are unblocked.

### Phase 3: Time-series snapshots

- Create `player_progression_snapshots` table.
- Add `cc_record_snapshot(source)` RPC.
- Add triggers/ Chef calls to record snapshots on claim, settlement, boss defeat, login.
- Add scheduled job for active players.
- Add `cc_progression_curve(hours)` RPC.
- **Deliverable:** Backend progression dataset exists; analytics-ready.

### Phase 4: Activity history

- Create `player_activity_history` table.
- Modify activity lifecycle RPCs to close/open rows.
- Backfill from current `active_actions` row.
- Show activity log on profile.
- **Deliverable:** Session/area-time analytics + user activity timeline.

### Phase 5: Leaderboards

- Create `cc_leaderboard(metric, limit, offset)` RPC.
- Add `LeaderboardsScreen` with identity-first rows and a ranking snapshot for the current user.
- Add navigation entry.
- Add public profile deep-linking from leaderboard rows.
- **Deliverable:** Social leaderboard surface.

### Phase 6: Ledger enrichment + advanced analytics

- Add area/weapon/activity context to `cc_apply_chef_rewards` payload.
- Build per-area reward efficiency view for internal balance analysis.
- Add milestone/badge table (optional).
- **Deliverable:** Internal balance tooling + optional achievements.

---

## 6. Open questions

1. **Snapshot frequency vs. cost.** Every 15 min for active players is ~100 rows/player/week. Is that acceptable, or do we want event-only snapshots initially?
2. **Public profile visibility.** Should all stats be public by default, or do we need a privacy flag per player?
3. **Leaderboard refresh cadence.** Real-time query or materialized cache refreshed every N minutes?
4. **Username/display_name requirement.** Resolved: enforce usernames before leaderboards ship; guests get auto-generated handles.
5. **Retention policy.** How long keep raw snapshots? Suggest: 30 days raw, then daily rollup forever.
6. **Rename cooldown.** 7 days chosen as default; adjust if desired.

---

## 7. Files that would change

- `supabase/migrations/` — new migration(s) for tables, views, RPCs.
- `src/server/chef.ts` — call snapshot recording after reward application.
- `src/server/routes/claim.ts` — call snapshot recording after settlement.
- `src/lib/supabase/` — `statsService.ts`, `usernameService.ts`.
- `src/lib/validation/username.ts` — client validation rules.
- `src/auth/accountState.ts` — username gating.
- `src/screens/ProfileScreen.tsx` — username display + rename.
- `src/components/profile/UsernameSetupModal.tsx` — new modal.
- `src/screens/LeaderboardsScreen.tsx` — new screen.
- `src/screens/PublicProfileScreen.tsx` — new screen.
- `src/App.tsx` — route registration + forced username prompt.
- `src/types/player.ts` — possibly new stat summary types.
- `src/test/` — new tests for RPC authority, validation, and feature gating.

---

## 8. Immediate next step recommendation

Phase 1 is complete. Proceed with **Phase 2: Username enforcement gate** to unblock leaderboards and public profiles.

Want me to proceed with the Phase 2 implementation plan?
