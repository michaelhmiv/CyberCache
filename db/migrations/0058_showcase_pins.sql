-- 0058_showcase_pins.sql
--
-- Hand-pinned Trophy Shelf (owner decision, 2026-11-03): the shelf
-- stops being purely the server's auto-rank. A player may pin up to
-- three favorite weapons; pinned weapons lead the shelf in pin
-- order and the auto-rank (rarity → level → newest, 0034) fills the
-- remaining slots. The shelf stays three items — pins reorder who
-- headlines, they do not grow the shelf.
--
-- Storage is one row per pin. pin_order is the player's chosen
-- sequence (0-based, dense — the write path rewrites the whole list
-- on every change, so the stored order is always exactly the list
-- the player last saved). The item reference cascades on delete:
-- an item that leaves existence takes its pin with it. A pin whose
-- item was sold or listed stays stored but resolves to nothing at
-- read time (the fold resolves pins against the player's CURRENT
-- items, the same records the auto-rank reads), so a stale pin can
-- never render another player's item or a ghost.
--
-- Validation lives in the Chef write path (cc-style {ok, error}
-- data contract, POST /api/profile/showcase-pins): every pinned id
-- must be an item the caller owns, of kind 'weapon', carrying a
-- usable weapon payload (the 0034 showable rule — the sparse
-- bootstrap starter can never headline the shelf, pinned or not).
-- The table itself stays dumb: ownership is enforced where the
-- authenticated identity exists, never trusted from the client.
--
-- MUST be applied live on Railway BEFORE the merge deploys: the
-- read fold (GET /api/profile/stats and the public-profile
-- projection) selects this table, and the pin write inserts into
-- it — the Chef 500s both paths until this lands (the 0051 rule).

create table if not exists public.profile_showcase_pins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.item_instances(id) on delete cascade,
  pin_order integer not null check (pin_order >= 0),
  created_at timestamptz not null default now(),
  primary key (user_id, item_id),
  unique (user_id, pin_order)
);
