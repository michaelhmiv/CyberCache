create or replace function public.cc_draw_odds(table_name text)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  total integer;
  pick integer;
  running integer := 0;
  candidate record;
begin
  select sum(weight)::integer into total
  from public.odds_outcomes
  where table_id = table_name;

  if total is null or total <= 0 then
    raise exception 'No outcomes configured for %', table_name;
  end if;

  pick := floor(random() * total)::integer + 1;

  for candidate in
    select outcome, weight, payload
    from public.odds_outcomes
    where table_id = table_name
    order by outcome
  loop
    running := running + candidate.weight;
    if pick <= running then
      return jsonb_build_object('table_id', table_name, 'outcome', candidate.outcome, 'roll', pick, 'total_weight', total, 'payload', candidate.payload);
    end if;
  end loop;

  raise exception 'Outcome resolution failed for %', table_name;
end;
$$;

revoke execute on function public.cc_draw_odds(text) from public, anon;
