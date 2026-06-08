create or replace function public.cc_jsonb_int(source jsonb, key text)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(source ->> key, '')::integer, 0);
$$;

create or replace function public.cc_jsonb_add_int(source jsonb, key text, amount integer)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_set(
    coalesce(source, '{}'::jsonb),
    array[key],
    to_jsonb(greatest(0, public.cc_jsonb_int(coalesce(source, '{}'::jsonb), key) + amount)),
    true
  );
$$;

create or replace function public.cc_vendor_price(item_key text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case item_key
    when 'MedPatch' then 150
    when 'ShieldCell' then 200
    when 'AmmoCrate' then 250
    when 'GrenadeKit' then 300
    when 'BossScanner' then 500
    when 'DeathFeeInsurance' then 750
    else null
  end;
$$;

create or replace function public.cc_salvage_scrap(rarity text, item_level integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select greatest(1, round((10 + greatest(1, coalesce(item_level, 1)) * 5) * case rarity
    when 'Common' then 1.0
    when 'Uncommon' then 1.5
    when 'Rare' then 2.5
    when 'Epic' then 4.0
    when 'Legendary' then 8.0
    else 1.0
  end)::integer);
$$;

revoke execute on function public.cc_jsonb_int(jsonb, text) from public, anon;
revoke execute on function public.cc_jsonb_add_int(jsonb, text, integer) from public, anon;
revoke execute on function public.cc_vendor_price(text) from public, anon;
revoke execute on function public.cc_salvage_scrap(text, integer) from public, anon;
