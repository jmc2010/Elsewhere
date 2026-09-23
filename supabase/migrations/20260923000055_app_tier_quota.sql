-- Per-tier Google quota, so a dev or preview build cannot eat the day.
--
-- All three apps -- development, preview, production -- talk to the SAME
-- cloud database. That is the right call (an app tier costs a config line; a
-- database tier costs 54 migrations, a 39k-row ingest, edge deploys, secrets
-- and an API key), but it means a dev build hammering refresh spends the same
-- Google budget as a real user.
--
-- Isolation of DATA comes free: the three apps have different package ids, so
-- different anonymous sessions, so different rows. What does not come free is
-- isolation of SPEND, because spend is charged to Google, not to a row.
--
-- ---------------------------------------------------------------------------
-- THE TIER CAN ONLY LOWER THE CAP, NEVER RAISE IT
-- ---------------------------------------------------------------------------
-- The tier arrives from the client, and a client can lie. So the resolution
-- order is built to make lying pointless:
--
--   explicit per-user override  (set by hand, always wins)
--   tier default                (only ever BELOW the global default)
--   global default              (60)
--
-- Claiming "production" gets you 60, which is what you would have had anyway.
-- Claiming nothing gets you 60. The only thing a tier marker can do is take
-- budget away from you, so there is nothing to gain by forging it and no need
-- to authenticate it.
--
-- An explicit override still wins outright: a dev account deliberately raised
-- to 2000 stays at 2000 even when its build reports `preview`. Overwriting
-- that would silently undo a decision somebody made on purpose.

begin;

alter table profiles add column app_tier text
  check (app_tier is null or app_tier in ('development', 'preview', 'production'));

comment on column profiles.app_tier is
  'Which build this account was last seen from. Advisory: it can only LOWER the quota, never raise it, so it needs no authentication.';

-- 20 calls. A full session measured at ~7 (cold open 5, a detail 1-2), so
-- this is about three sessions a day -- enough to exercise every screen,
-- nowhere near enough to exhaust a budget by leaving a simulator open.
create or replace function tier_daily_call_limit(p_tier text)
returns int
language sql
immutable
as $$
  select case p_tier
    when 'development' then 20
    when 'preview'     then 20
    else null            -- production and unknown fall through to the default
  end;
$$;

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

  -- Explicit override, then the tier default, then the global default.
  select coalesce(
           pr.daily_google_call_limit,
           tier_daily_call_limit(pr.app_tier),
           google_daily_call_limit())
    into v_limit
  from profiles pr where pr.id = p_user;
  -- No profile row means no override and no tier, not no limit.
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

  -- Deterministic allocation. Only matters at the ceiling; resolution first,
  -- because a details call on an unresolved place cannot happen without it.
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

-- Record the tier a caller reports. SECURITY DEFINER because profiles is
-- behind RLS and this is called from the edge function on the user's behalf.
create or replace function note_app_tier(p_user uuid, p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tier is null or p_tier not in ('development', 'preview', 'production') then
    return;
  end if;
  update profiles set app_tier = p_tier
   where id = p_user and app_tier is distinct from p_tier;
end $$;

revoke all on function note_app_tier(uuid, text) from public, anon, authenticated;

commit;
