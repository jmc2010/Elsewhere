-- Restore the per-user quota override, which 0052 dropped.
--
-- 0019 taught google_quota_reserve to read profiles.daily_google_call_limit,
-- so a dev account could be raised to 2000/day without raising it for
-- everyone. 0052 rewrote the function to take a per-SKU breakdown -- and was
-- written against the 0012 body, which predates that override. The override
-- was silently lost.
--
-- Consequence, measured: an account with a 2000/day override and 120 calls
-- used was evaluated against the 60/day default, so every reservation granted
-- ZERO. The edge function made no Google call, google_quota_reserve inserted
-- no row because it only logs a non-zero grant, and the place detail screen
-- rendered "From Google / Powered by Google" over nothing at all.
--
-- It presented as a caching triumph -- zero calls! -- which is why it took
-- three rounds of testing to find. A quota bug that fails CLOSED is safe for
-- the bill and invisible to everything else.
--
-- The lesson worth keeping: when rewriting a function, start from the CURRENT
-- definition in the database, not from the migration that first created it.
-- Five migrations had touched this one.

begin;

create or replace function google_quota_reserve(
  p_user      uuid,
  p_breakdown jsonb,
  p_session   text default null
)
returns table (granted int, used_today int, daily_limit int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit     int;
  v_used      int;
  v_requested int;
  v_grant     int;
  v_left      int;
  v_take      int;
  r           record;
begin
  if p_user is null then
    raise exception 'google_quota_reserve requires a user; anonymous Google calls are not permitted';
  end if;
  if p_breakdown is null or jsonb_typeof(p_breakdown) <> 'object' then
    raise exception 'p_breakdown must be a json object of sku -> call count';
  end if;

  -- The per-user override (0019). Restored.
  select coalesce(pr.daily_google_call_limit, google_daily_call_limit())
    into v_limit
  from profiles pr where pr.id = p_user;
  -- No profile row means no override, not no limit.
  v_limit := coalesce(v_limit, google_daily_call_limit());

  select coalesce(sum((value)::int), 0) into v_requested
  from jsonb_each_text(p_breakdown);

  if v_requested < 0 then
    raise exception 'call counts must be >= 0 (got %)', v_requested;
  end if;

  select coalesce(sum(call_count), 0) into v_used
  from google_api_usage
  where user_id = p_user
    and called_at >= date_trunc('day', now());

  v_grant := least(v_requested, greatest(v_limit - v_used, 0));

  -- Allocate in a deterministic order. Only matters at the ceiling, where a
  -- partial grant has to be attributed somehow; resolution goes first because
  -- a details call on an unresolved place cannot happen without it.
  v_left := v_grant;
  for r in
    select key as sku, (value)::int as calls
    from jsonb_each_text(p_breakdown)
    where (value)::int > 0
    order by (key not like 'places.searchText%'), key
  loop
    exit when v_left <= 0;
    v_take := least(r.calls, v_left);
    insert into google_api_usage (user_id, sku, call_count, session_id)
    values (p_user, r.sku, v_take, p_session);
    v_left := v_left - v_take;
  end loop;

  return query select v_grant, v_used + v_grant, v_limit;
end $$;

revoke all on function google_quota_reserve(uuid, jsonb, text) from public, anon, authenticated;

commit;
