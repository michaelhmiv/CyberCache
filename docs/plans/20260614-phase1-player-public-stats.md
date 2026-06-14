# Phase 1 Implementation Plan: Player Public Stats + Expanded Profile

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Create a server-authoritative public stats projection and expand the profile screen so players see weapons-owned, kill/death/KD, net worth, rarity breakdown, mastery totals, and top combat areas/weapon types.

**Architecture:**
- Add a `player_public_stats` PostgreSQL view that joins `profiles`, `combat_stats`, `player_stat_counters`, `item_instances`, and `player_masteries` into one safe row per player.
- Add two read-only RPCs: `cc_my_stats_summary()` (full owned summary) and `cc_public_stats(user_id)` (public-safe projection).
- Add a thin TypeScript `statsService.ts` wrapper matching the existing `masteryService.ts` pattern.
- Extend `ProfileScreen.tsx` to fetch and display the new stats.
- Verify with migration tests and a smoke test.

**Tech Stack:** Supabase Postgres, TypeScript React, existing Zustand stores, Vitest.

---

## Task 0: Verify current schema before writing migration

**Objective:** Confirm the exact column names and table shapes in prod so the view and RPCs are correct.

**Files:** None (read-only exploration).

**Steps:**
1. Run the schema inspection script to verify `profiles`, `combat_stats`, `item_instances`, `player_stat_counters`, `player_masteries` columns.
2. Confirm `profiles.username` and `profiles.display_name` exist and may be null.
3. Confirm `item_instances` columns: `owner_user_id`, `kind`, `rarity`, `item_level`.
4. Confirm `combat_stats.kills_by_area`, `kills_by_weapon_type`, `kills_by_element` are `jsonb`.

**Verification:**

```bash
python3 - <<'PY'
import os, json, urllib.request
SUPABASE_URL = os.environ['VITE_SUPABASE_URL']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
url = f"{SUPABASE_URL}/rest/v1/?"
req = urllib.request.Request(url, method='GET')
req.add_header('apikey', SERVICE_KEY)
req.add_header('Authorization', f'Bearer {SERVICE_KEY}')
req.add_header('Accept', 'application/json')
with urllib.request.urlopen(req, timeout=30) as resp:
    data = json.loads(resp.read().decode())
for t in ['profiles', 'combat_stats', 'item_instances', 'player_stat_counters', 'player_masteries']:
    print(t, sorted(data['definitions'][t]['properties'].keys()))
PY
```

Expected: lists include the columns used in Task 1.

---

## Task 1: Create migration for `player_public_stats` view

**Objective:** Add the safe, denormalized public stats view.

**Files:**
- Create: `supabase/migrations/20260614170000_player_public_stats_view.sql`

**Step 1: Write migration**

```sql
-- Migration 20260614170000: Public-safe player stats projection
--
-- One row per player intended for profile pages and future leaderboards.
-- No email, no inventory internals, no runtime snapshots.

create or replace view public.player_public_stats as
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
  case when coalesce(c.total_deaths, 0) = 0
    then coalesce(c.total_kills, 0)::numeric
    else (coalesce(c.total_kills, 0)::numeric / c.total_deaths::numeric)
  end as kill_death_ratio,
  coalesce(c.highest_boss_tier, 0) as highest_boss_tier,
  coalesce(c.longest_kill_streak, 0) as longest_kill_streak,
  coalesce(c.active_play_seconds, 0) as active_play_seconds,
  coalesce(c.idle_play_seconds, 0) as idle_play_seconds,
  coalesce(c.kills_by_area, '{}'::jsonb) as kills_by_area,
  coalesce(c.kills_by_weapon_type, '{}'::jsonb) as kills_by_weapon_type,
  coalesce(c.kills_by_element, '{}'::jsonb) as kills_by_element,
  coalesce(psc.stat_value, 0) as net_worth,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id) as total_items,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind = 'weapon') as weapons_owned,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.rarity = 'Legendary') as legendary_items,
  (select coalesce(max(ii.item_level), 0) from public.item_instances ii where ii.owner_user_id = p.id) as highest_item_level,
  (select coalesce(sum(pm.mastery_xp), 0) from public.player_masteries pm where pm.user_id = p.id) as total_mastery_xp,
  (select coalesce(max(pm.mastery_level), 0) from public.player_masteries pm where pm.user_id = p.id) as highest_mastery_level,
  p.updated_at as last_active_at,
  p.created_at as joined_at
from public.profiles p
left join public.combat_stats c on c.user_id = p.id
left join public.player_stat_counters psc on psc.user_id = p.id and psc.stat_key = 'account.net_worth';

-- Expose to authenticated users for profile/leaderboard reads.
grant select on public.player_public_stats to authenticated, anon, public;
```

**Step 2: Validate syntax locally**

```bash
cd /data/cybercache
# If supabase CLI is available and linked:
# supabase db reset --linked
# Otherwise, apply manually to a test project or rely on CI.
```

**Step 3: Apply to production**

Use the existing management-API migration path:

```bash
cd /data/cybercache
GOMAXPROCS=1 SUPABASE_ACCESS_TOKEN=<Railway token> /usr/lib/node_modules/supabase/node_modules/@supabase/cli-linux-x64/bin/supabase-go db push --linked
```

**Step 4: Commit**

```bash
git add supabase/migrations/20260614170000_player_public_stats_view.sql
git commit -m "feat(stats): add player_public_stats view for profile/leaderboard projection"
```

---

## Task 2: Create `cc_my_stats_summary()` RPC

**Objective:** Return the full stats summary for the currently authenticated user.

**Files:**
- Modify: `supabase/migrations/20260614170000_player_public_stats_view.sql` (append) or create a new migration `20260614171000_player_stats_summary_rpc.sql`.

**Step 1: Add RPC to migration**

```sql
-- Returns the full row from player_public_stats for the calling user.
create or replace function public.cc_my_stats_summary()
returns public.player_public_stats
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.player_public_stats
  where user_id = auth.uid()
  limit 1;
$$;

revoke execute on function public.cc_my_stats_summary() from public, anon;
grant execute on function public.cc_my_stats_summary() to authenticated;
```

**Step 2: Verify grant pattern**

Run:

```bash
grep -n "cc_my_stats_summary" supabase/migrations/20260614170000_player_public_stats_view.sql
```

Expected: lines for `create or replace function`, `revoke`, and `grant`.

**Step 3: Commit**

```bash
git add supabase/migrations/20260614170000_player_public_stats_view.sql
git commit -m "feat(stats): add cc_my_stats_summary RPC for authenticated users"
```

---

## Task 3: Create `cc_public_stats(user_id uuid)` RPC

**Objective:** Return a public-safe stats row for any user ID.

**Files:**
- Modify: same migration file.

**Step 1: Add RPC**

```sql
create or replace function public.cc_public_stats(_user_id uuid)
returns public.player_public_stats
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.player_public_stats
  where user_id = _user_id
  limit 1;
$$;

revoke execute on function public.cc_public_stats(uuid) from public, anon;
grant execute on function public.cc_public_stats(uuid) to authenticated;
```

**Step 2: Test the RPC shape in production**

```bash
python3 - <<'PY'
import os, json, urllib.request
SUPABASE_URL = os.environ['VITE_SUPABASE_URL']
ANON_KEY = os.environ['VITE_SUPABASE_ANON_KEY']
# Sign in as test user or use service role for a quick structural check
SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
url = f"{SUPABASE_URL}/rest/v1/rpc/cc_public_stats"
req = urllib.request.Request(url, data=json.dumps({'user_id': '3cbc2896-63ec-4680-9036-14a462dc4539'}).encode(), method='POST')
req.add_header('apikey', SERVICE_KEY)
req.add_header('Authorization', f'Bearer {SERVICE_KEY}')
req.add_header('Content-Type', 'application/json')
req.add_header('Accept', 'application/json')
with urllib.request.urlopen(req, timeout=30) as resp:
    print(json.dumps(resp.read().decode()[:500], indent=2))
PY
```

Expected: returns a JSON object matching the view columns.

**Step 3: Commit**

```bash
git add supabase/migrations/20260614170000_player_public_stats_view.sql
git commit -m "feat(stats): add cc_public_stats RPC for public profile lookups"
```

---

## Task 4: Add TypeScript `statsService.ts`

**Objective:** Client-side wrapper for the new RPCs, matching the `masteryService.ts` pattern.

**Files:**
- Create: `src/lib/supabase/statsService.ts`
- Modify: `src/lib/supabase/index.ts` to re-export.

**Step 1: Create service**

```typescript
import { supabase } from './client';

export interface PlayerPublicStats {
  user_id: string;
  username: string | null;
  display_name: string | null;
  player_level: number;
  player_xp: number;
  credits: number;
  scrap: number;
  cache_tokens: number;
  cache_token_parts: number;
  total_kills: number;
  total_deaths: number;
  kill_death_ratio: number;
  highest_boss_tier: number;
  longest_kill_streak: number;
  active_play_seconds: number;
  idle_play_seconds: number;
  kills_by_area: Record<string, number>;
  kills_by_weapon_type: Record<string, number>;
  kills_by_element: Record<string, number>;
  net_worth: number;
  total_items: number;
  weapons_owned: number;
  legendary_items: number;
  highest_item_level: number;
  total_mastery_xp: number;
  highest_mastery_level: number;
  last_active_at: string;
  joined_at: string;
}

export async function getMyStatsSummary(): Promise<PlayerPublicStats | null> {
  const { data, error } = await supabase.rpc('cc_my_stats_summary');
  if (error) {
    console.error('getMyStatsSummary error:', error);
    return null;
  }
  return (data as PlayerPublicStats | null) ?? null;
}

export async function getPublicStats(userId: string): Promise<PlayerPublicStats | null> {
  const { data, error } = await supabase.rpc('cc_public_stats', { user_id: userId });
  if (error) {
    console.error('getPublicStats error:', error);
    return null;
  }
  return (data as PlayerPublicStats | null) ?? null;
}
```

**Step 2: Re-export from index**

Modify `src/lib/supabase/index.ts`:

```typescript
export * from './authService';
export * from './client';
export * from './config';
export * from './profileService';
export * from './statsService';
```

**Step 3: Run TypeScript check**

```bash
cd /data/cybercache
npx tsc --noEmit
```

Expected: no new errors.

**Step 4: Commit**

```bash
git add src/lib/supabase/statsService.ts src/lib/supabase/index.ts
git commit -m "feat(stats): add statsService with public and my stats RPC wrappers"
```

---

## Task 5: Add helper for top-N JSONB breakdowns

**Objective:** Convert `kills_by_area`, `kills_by_weapon_type`, `kills_by_element` into display-ready sorted arrays.

**Files:**
- Create: `src/lib/stats/statsHelpers.ts`

**Step 1: Create helper**

```typescript
export interface NamedCount {
  name: string;
  count: number;
}

export function topBreakdown(
  entries: Record<string, number> | null | undefined,
  limit = 3
): NamedCount[] {
  if (!entries) return [];
  return Object.entries(entries)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .filter((e) => e.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
```

**Step 2: Add unit test**

Create `src/test/statsHelpers.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { formatDuration, topBreakdown } from '../lib/stats/statsHelpers';

describe('statsHelpers', () => {
  it('returns top entries sorted by count', () => {
    expect(topBreakdown({ a: 5, b: 10, c: 2 }, 2)).toEqual([
      { name: 'b', count: 10 },
      { name: 'a', count: 5 },
    ]);
  });

  it('filters zero counts', () => {
    expect(topBreakdown({ a: 0, b: 3 })).toEqual([{ name: 'b', count: 3 }]);
  });

  it('handles null/undefined', () => {
    expect(topBreakdown(null)).toEqual([]);
    expect(topBreakdown(undefined)).toEqual([]);
  });

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(90)).toBe('1m');
    expect(formatDuration(3665)).toBe('1h 1m');
  });
});
```

**Step 3: Run tests**

```bash
npx vitest run src/test/statsHelpers.test.ts
```

Expected: 4 passed.

**Step 4: Commit**

```bash
git add src/lib/stats/statsHelpers.ts src/test/statsHelpers.test.ts
git commit -m "feat(stats): add stats display helpers and tests"
```

---

## Task 6: Expand `ProfileScreen.tsx`

**Objective:** Fetch and display the new stats on the profile page.

**Files:**
- Modify: `src/screens/ProfileScreen.tsx`

**Step 1: Add imports**

```typescript
import { useEffect, useState } from 'react';
import { Activity, Award, Box, Clock, HelpCircle, LogOut, Settings, ShieldCheck, Skull, Sword, Target, TrendingUp, User, Zap } from 'lucide-react';
import { getMyStatsSummary, type PlayerPublicStats } from '@/lib/supabase/statsService';
import { formatDuration, topBreakdown } from '@/lib/stats/statsHelpers';
```

**Step 2: Add state and fetch hook inside component**

After existing hooks:

```typescript
const [stats, setStats] = useState<PlayerPublicStats | null>(null);
const [statsLoading, setStatsLoading] = useState(true);

useEffect(() => {
  let cancelled = false;
  setStatsLoading(true);
  getMyStatsSummary().then((data) => {
    if (cancelled) return;
    setStats(data);
    setStatsLoading(false);
  });
  return () => { cancelled = true; };
}, []);
```

**Step 3: Add display cards**

Replace the existing grid cards (Credits/Scrap/Bosses/Items) with an expanded grid. Keep the existing grid but add more cards:

```typescript
<MobileCard className="space-y-1" rarityColor="#5AA7FF">
  <div className="flex items-center gap-2"><Sword size={16} className="text-blue" /><div className="text-xs font-bold text-text-primary">Weapons</div></div>
  <div className="text-lg font-black text-text-primary">{stats?.weapons_owned ?? weapons.length}</div>
</MobileCard>
```

Add a new **Stats Grid** card after the existing 2x2 grid:

```typescript
<MobileCard className="space-y-3" rarityColor="#FF9000">
  <div className="flex items-center gap-2">
    <TrendingUp size={16} className="text-amber" />
    <div className="text-xs font-black uppercase tracking-wide text-text-primary">Field Stats</div>
  </div>
  <div className="grid grid-cols-2 gap-2 text-xs">
    <div className="space-y-1">
      <div className="text-text-muted">Kills</div>
      <div className="font-black text-text-primary">{(stats?.total_kills ?? 0).toLocaleString()}</div>
    </div>
    <div className="space-y-1">
      <div className="text-text-muted">Deaths</div>
      <div className="font-black text-text-primary">{(stats?.total_deaths ?? 0).toLocaleString()}</div>
    </div>
    <div className="space-y-1">
      <div className="text-text-muted">K/D</div>
      <div className="font-black text-text-primary">{(stats?.kill_death_ratio ?? 0).toFixed(2)}</div>
    </div>
    <div className="space-y-1">
      <div className="text-text-muted">Best Streak</div>
      <div className="font-black text-text-primary">{(stats?.longest_kill_streak ?? 0).toLocaleString()}</div>
    </div>
  </div>
</MobileCard>
```

Expand the **Collection Patch** card to include rarity breakdown and weapons-owned:

```typescript
<MobileCard className="space-y-2" rarityColor="#FFEA3A">
  <div className="text-xs font-black uppercase tracking-wide text-text-muted">Collection Patch</div>
  <div className="space-y-1 text-xs text-text-secondary">
    <div className="flex justify-between"><span>Total Items</span><span className="text-text-primary">{stats?.total_items ?? totalItems}</span></div>
    <div className="flex justify-between"><span>Weapons</span><span className="text-text-primary">{stats?.weapons_owned ?? weapons.length}</span></div>
    <div className="flex justify-between"><span>Legendary Items</span><span className="font-bold text-amber">{stats?.legendary_items ?? weapons.filter((w) => w.rarity === 'Legendary').length}</span></div>
    <div className="flex justify-between"><span>Highest Item Level</span><span className="text-text-primary">{stats?.highest_item_level ?? '—'}</span></div>
    <div className="flex justify-between"><span>Unique Affixes</span><span className="text-text-primary">{new Set(weapons.flatMap((w) => w.affixes.map((a) => a.id))).size}</span></div>
    <div className="flex justify-between"><span>Favorite Type</span><span className="font-bold text-amber">{favoriteType ? favoriteType[0] : 'None'}</span></div>
  </div>
</MobileCard>
```

Add a **Combat Breakdown** card:

```typescript
const topAreas = topBreakdown(stats?.kills_by_area, 3);
const topWeaponTypes = topBreakdown(stats?.kills_by_weapon_type, 3);

<MobileCard className="space-y-3" rarityColor="#FF4B5C">
  <div className="flex items-center gap-2">
    <Target size={16} className="text-red" />
    <div className="text-xs font-black uppercase tracking-wide text-text-primary">Combat Breakdown</div>
  </div>
  <div className="space-y-2 text-xs">
    <div>
      <div className="mb-1 text-text-muted">Top Areas</div>
      {topAreas.length === 0 ? (
        <div className="text-text-muted">No data yet.</div>
      ) : (
        <ul className="space-y-1">
          {topAreas.map((a) => (
            <li key={a.name} className="flex justify-between">
              <span className="text-text-secondary">{a.name}</span>
              <span className="font-bold text-text-primary">{a.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
    <div>
      <div className="mb-1 text-text-muted">Top Weapon Types</div>
      {topWeaponTypes.length === 0 ? (
        <div className="text-text-muted">No data yet.</div>
      ) : (
        <ul className="space-y-1">
          {topWeaponTypes.map((t) => (
            <li key={t.name} className="flex justify-between">
              <span className="text-text-secondary">{t.name}</span>
              <span className="font-bold text-text-primary">{t.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  </div>
</MobileCard>
```

Add a **Mastery Patch** card:

```typescript
<MobileCard className="space-y-2" rarityColor="#7CFC00">
  <div className="flex items-center gap-2">
    <Award size={16} className="text-green" />
    <div className="text-xs font-black uppercase tracking-wide text-text-primary">Mastery</div>
  </div>
  <div className="space-y-1 text-xs text-text-secondary">
    <div className="flex justify-between"><span>Total Mastery XP</span><span className="font-bold text-text-primary">{(stats?.total_mastery_xp ?? 0).toLocaleString()}</span></div>
    <div className="flex justify-between"><span>Highest Mastery Level</span><span className="font-bold text-text-primary">{stats?.highest_mastery_level ?? 0}</span></div>
  </div>
</MobileCard>
```

**Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/screens/ProfileScreen.tsx
git commit -m "feat(stats): expand profile screen with field stats, collection, combat breakdown, and mastery"
```

---

## Task 7: Add migration tests

**Objective:** Ensure the view and RPCs are created and have the correct grants.

**Files:**
- Modify: `src/test/supabaseAuthority.test.ts`

**Step 1: Add tests**

Add inside `describe('Supabase authority grants', () => { ... })`:

```typescript
it('player_public_stats view is readable by authenticated users', () => {
  const grants = orderedMigrations
    .flatMap((m) => Array.from(m.sql.matchAll(/grant\s+select\s+on\s+public\.player_public_stats\s+to\s+([^;]+)/gi)))
    .map((m) => m[1]);
  expect(grants[grants.length - 1]).toMatch(/authenticated/);
});

it('cc_my_stats_summary is granted to authenticated', () => {
  const last = lastAuthenticatedGrantAction('public.cc_my_stats_summary()');
  expect(last).toMatch(/:grant$/);
});

it('cc_public_stats is granted to authenticated', () => {
  const last = lastAuthenticatedGrantAction('public.cc_public_stats(uuid)');
  expect(last).toMatch(/:grant$/);
});
```

**Step 2: Run tests**

```bash
npx vitest run src/test/supabaseAuthority.test.ts
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add src/test/supabaseAuthority.test.ts
git commit -m "test(stats): verify public stats view and RPC grants"
```

---

## Task 8: Add profile stats smoke test

**Objective:** Verify `ProfileScreen` renders the new stats elements.

**Files:**
- Create: `src/test/profileStatsSurface.test.tsx`

**Step 1: Write test**

```typescript
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileScreen } from '../screens/ProfileScreen';

// Minimal stub: the existing tests likely already stub stores.
// If not, this test may need store mocks matching project conventions.

describe('ProfileScreen stats surface', () => {
  it('renders field stats section', () => {
    render(<ProfileScreen />);
    expect(screen.getByText(/Field Stats/i)).toBeDefined();
  });

  it('renders collection patch', () => {
    render(<ProfileScreen />);
    expect(screen.getByText(/Collection Patch/i)).toBeDefined();
  });

  it('renders combat breakdown', () => {
    render(<ProfileScreen />);
    expect(screen.getByText(/Combat Breakdown/i)).toBeDefined();
  });

  it('renders mastery patch', () => {
    render(<ProfileScreen />);
    expect(screen.getByText(/Mastery/i)).toBeDefined();
  });
});
```

**Step 2: Run tests**

```bash
npx vitest run src/test/profileStatsSurface.test.tsx
```

Note: if the existing store stubs are complex, this test may need to follow the pattern used in `DeathOverlay.test.tsx` or other component tests. Adjust mocks accordingly.

**Step 3: Commit**

```bash
git add src/test/profileStatsSurface.test.tsx
git commit -m "test(stats): add profile stats surface smoke tests"
```

---

## Task 9: Deploy and verify in production

**Objective:** Push migration and confirm the new surfaces work against prod data.

**Step 1: Push migration**

```bash
cd /data/cybercache
GOMAXPROCS=1 SUPABASE_ACCESS_TOKEN=<Railway token> /usr/lib/node_modules/supabase/node_modules/@supabase/cli-linux-x64/bin/supabase-go db push --linked
```

**Step 2: Verify RPC returns expected shape**

```bash
python3 - <<'PY'
import os, json, urllib.request
SUPABASE_URL = os.environ['VITE_SUPABASE_URL']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
user_id = '3cbc2896-63ec-4680-9036-14a462dc4539'
for rpc in ['cc_my_stats_summary', 'cc_public_stats']:
    url = f"{SUPABASE_URL}/rest/v1/rpc/{rpc}"
    body = {} if rpc == 'cc_my_stats_summary' else {'user_id': user_id}
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST')
    req.add_header('apikey', SERVICE_KEY)
    req.add_header('Authorization', f'Bearer {SERVICE_KEY}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Accept', 'application/json')
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    print(rpc, 'keys:', sorted(data.keys()))
PY
```

Expected: keys include `weapons_owned`, `total_kills`, `net_worth`, `total_mastery_xp`, etc.

**Step 3: Build and deploy frontend**

```bash
npm run build
# Deploy via Railway (existing pipeline)
```

**Step 4: Manual browser check**

Open the deployed app, navigate to Profile, and confirm:
- Field Stats card shows kills/deaths/KD/streak.
- Collection Patch shows weapons owned, legendary items, highest item level.
- Combat Breakdown shows top areas and weapon types.
- Mastery Patch shows total mastery XP and highest level.

**Step 5: Commit any final fixes**

---

## Task 10: Final verification checklist

- [ ] `npx tsc --noEmit` passes.
- [ ] `npx vitest run` passes (or all new tests pass).
- [ ] Migration pushed to production successfully.
- [ ] `cc_my_stats_summary()` returns correct data for an active player.
- [ ] `cc_public_stats(user_id)` returns correct data for a public user.
- [ ] Profile screen renders new stats without layout breakage.
- [ ] No authenticated grant on stat write RPCs was accidentally added.

---

## Out of scope for Phase 1

- `player_progression_snapshots` table (Phase 3).
- `player_activity_history` table (Phase 3).
- `cc_leaderboard()` RPC and `LeaderboardsScreen` (Phase 4).
- Username enforcement gate (Phase 2).
- Ledger enrichment (Phase 5).

These are documented in `docs/proposals/player-stats-progression-leaderboards.md` and will be planned separately after Phase 1 is merged.
