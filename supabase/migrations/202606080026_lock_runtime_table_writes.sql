-- Runtime economy writes must go through SECURITY DEFINER RPCs, not direct client table mutation.

-- Profiles: clients may read their own row. Runtime balances/progression are RPC-owned.
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

-- Item instances: clients may read owned/listed rows. Creation, lifecycle, ownership, equip, lock, and recycle are RPC-owned.
drop policy if exists "items_insert_own" on public.item_instances;
drop policy if exists "items_update_own_unlisted" on public.item_instances;

-- Profession rows are progression state and should not be client-written.
drop policy if exists "professions_insert_own" on public.player_professions;
drop policy if exists "professions_update_own" on public.player_professions;

-- Active actions will be driven by RPCs once action timers are server authoritative.
drop policy if exists "actions_insert_own" on public.active_actions;
drop policy if exists "actions_update_own" on public.active_actions;

-- Market mutation is RPC-owned so listing create/cancel/accept can be atomic.
drop policy if exists "market_insert_verified" on public.market_listings;
drop policy if exists "market_update_verified_owner" on public.market_listings;
drop policy if exists "market_insert_own" on public.market_listings;
drop policy if exists "market_update_own" on public.market_listings;

-- Escrow and service jobs are multiplayer economy surfaces and should not be directly client-written.
drop policy if exists "escrow_insert_verified_payer" on public.escrow_records;
drop policy if exists "escrow_update_verified_party" on public.escrow_records;
drop policy if exists "escrow_insert_payer" on public.escrow_records;
drop policy if exists "escrow_update_party" on public.escrow_records;
drop policy if exists "service_jobs_insert_verified_owner" on public.service_jobs;
drop policy if exists "service_jobs_update_verified_party" on public.service_jobs;
drop policy if exists "service_jobs_insert_owner" on public.service_jobs;
drop policy if exists "service_jobs_update_party" on public.service_jobs;
