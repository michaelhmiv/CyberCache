-- ===========================================================================
-- 0045 — Repair refund event type (hotfix for a latent production defect)
-- ===========================================================================
--
-- THE BUG: the repair lane's refund paths — written in 0025 and carried
-- verbatim through every restatement since (0026, 0030, 0038, 0044) —
-- return escrowed patch kits by calling
--   cc_add_consumable_batch(..., 'repair_refund', ...)
-- in exactly two places:
--   * cc_settle_craft_jobs — a repair job whose vehicle is already
--     whole (or gone) refunds every unstarted kit;
--   * cc_cancel_craft_job — cancelling a repair craft job refunds
--     every unapplied kit.
-- But 'repair_refund' was never added to either of the two lists that
-- gate consumable events: the validated list inside
-- cc_add_consumable_batch (which raises 'invalid consumable event
-- type') and the consumable_events_event_type_check CHECK constraint.
-- Every repair refund therefore fails its whole transaction in
-- production (the kit escrow stays burned; the cancel/settle that
-- triggered the refund rolls back with it).
--
-- THE FIX (the exact 0043 'standing_buy' / 0044 'shieldtech_refund'
-- precedent): widen BOTH lists by the single value 'repair_refund'
-- and change nothing else. The refund call sites' remaining writes
-- (profiles.consumables via cc_jsonb_add_int, craft_jobs.status, the
-- verified_action_ledger row — which carries no event-type list) need
-- no widening; cc_add_consumable_batch is the only validated writer of
-- consumable_events.
--
-- ---------------------------------------------------------------------------
-- Restated cc_add_consumable_batch (0044 body + the repair_refund
-- event type, 0045) — the 0043/0044 precedent: a consumable flow
-- that writes its own event type extends the validated list and
-- the consumable_events CHECK together. Sole change: the two lists
-- gain 'repair_refund'. The function body is otherwise the 0044
-- body verbatim (diff-proven in the PR).
-- ---------------------------------------------------------------------------

alter table public.consumable_events
  drop constraint consumable_events_event_type_check,
  add constraint consumable_events_event_type_check
    check ((event_type = any (array['vendor_buy'::text, 'crafted'::text, 'market_buy'::text, 'market_sell'::text, 'used'::text, 'expired'::text, 'admin_adjust'::text, 'reset'::text, 'standing_buy'::text, 'shieldtech_refund'::text, 'repair_refund'::text])));

CREATE OR REPLACE FUNCTION public.cc_add_consumable_batch(p_owner_id uuid, p_item_key text, p_quantity integer, p_quality_percent numeric DEFAULT 100, p_origin text DEFAULT 'vendor'::text, p_creator_id uuid DEFAULT NULL::uuid, p_source_recipe_id text DEFAULT NULL::text, p_event_type text DEFAULT 'vendor_buy'::text, p_reason text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  qty integer := greatest(1, coalesce(p_quantity, 1));
  q numeric := greatest(1, least(250, coalesce(p_quality_percent, 100)));
  batch_id uuid;
begin
  if p_owner_id is null then raise exception 'owner_id is required'; end if;
  if p_item_key is null or length(trim(p_item_key)) = 0 then raise exception 'item_key is required'; end if;
  if p_origin not in ('vendor', 'crafted', 'market', 'reward', 'admin', 'standing') then raise exception 'invalid consumable origin'; end if;
  if p_event_type not in ('vendor_buy', 'crafted', 'market_buy', 'market_sell', 'used', 'expired', 'admin_adjust', 'reset', 'standing_buy', 'shieldtech_refund', 'repair_refund') then raise exception 'invalid consumable event type'; end if;

  select b.id into batch_id
  from public.consumable_batches b
  where b.owner_user_id = p_owner_id
    and b.consumable_type = p_item_key
    and b.quality_percent = q
    and b.origin = p_origin
    and coalesce(b.creator_user_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_creator_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(b.source_recipe_id, '') = coalesce(p_source_recipe_id, '')
  for update
  limit 1;

  if batch_id is null then
    insert into public.consumable_batches(owner_user_id, consumable_type, quality_percent, quantity, origin, creator_user_id, source_recipe_id, metadata)
    values (p_owner_id, p_item_key, q, qty, p_origin, p_creator_id, p_source_recipe_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into batch_id;
  else
    update public.consumable_batches
    set quantity = quantity + qty,
        metadata = coalesce(public.consumable_batches.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where id = batch_id;
  end if;

  insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
  values (p_owner_id, batch_id, p_item_key, qty, q, p_event_type, p_reason, coalesce(p_metadata, '{}'::jsonb));

  return batch_id;
end;
$function$;
