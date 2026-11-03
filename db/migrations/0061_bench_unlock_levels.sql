-- 0061: Bench unlock level requirements removed (gate-removal step 4).
-- Numbering note: 0059 was gate-removal step 3 (Research course
-- levels, PR #329); 0060 is the quick-buy fill function. This
-- migration restates the bench unlock function.
--
-- Owner law (Michael, 2026-11-02): progression is gated by scarcity
-- and difficulty, not level numbers. The level-gate audit (G3) found
-- the two Workshop bench upgrades carrying hunter-level requirements
-- -- Forge at L15, Lab at L30 -- on top of the prices that already
-- stand in front of them: Forge 5,000cr, Lab 25,000cr + 10 VoidDust,
-- charged atomically at unlock. On the tuned XP curve L15 is ~58k XP
-- and L30 ~380k XP (days-to-weeks of play), so the level numbers did
-- the real work and the prices were decoration. The level numbers
-- are deleted; the prices and the material charge stand exactly as
-- they were, and price + materials are now the whole gate. No cost
-- was raised and no material was added in this step -- the pacing
-- consequence (benches reachable as early as a player can pay) is
-- the owner's accepted trade, flagged in the slice report.
--
-- This migration restates ONLY cc_unlock_bench() from 0024: the
-- level assignment (v_level) and the 'Bench % requires level %'
-- refusal are removed; the nonce/idempotency replay, the advisory
-- lock, the 'All benches already unlocked' refusal, the credits
-- refusal, the VoidDust refusal, and the atomic charge are
-- byte-identical. The TS bench catalog (src/content/crafting.ts),
-- the in-memory twin (src/server/writes/craftEngine.ts), and the
-- bench UI copy move in the same slice; parity is pinned by
-- src/test/gateRemovalStep4.test.ts.
--
-- Research's Fabrication bench gates (Production Systems requires
-- bench 2, Master Fabricator bench 3) are untouched: they read
-- bench OWNERSHIP, never the hunter's level, and they survive.

-- Bench unlock (§2.2): the next bench, charged atomically into the
-- credit sink. Prices are MECHANICS.md §8 verbatim except Bench 1,
-- which ships free (it is the starting bench; no unlock op exists).
create or replace function public.cc_unlock_bench(p_player_id uuid, nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  v_next integer;
  v_cost bigint;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  v_next := coalesce(p.workshop_benches, 1) + 1;
  if v_next > 3 then raise exception 'All benches already unlocked'; end if;
  if v_next = 2 then
    v_cost := 5000;
  else
    v_cost := 25000;
  end if;
  if p.credits < v_cost then raise exception 'Insufficient credits'; end if;
  if v_next = 3 and coalesce((p.materials ->> 'VoidDust')::integer, 0) < 10 then
    raise exception 'Insufficient material %', 'VoidDust';
  end if;

  update public.profiles
     set credits = credits - v_cost,
         materials = case when v_next = 3
           then public.cc_jsonb_add_int(materials, 'VoidDust', -10)
           else materials end,
         workshop_benches = v_next,
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_unlock_bench',
    'profile', public.cc_profile_snapshot(p),
    'benches', v_next
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_unlock_bench', nonce, result);
  return result;
end;
$$;
