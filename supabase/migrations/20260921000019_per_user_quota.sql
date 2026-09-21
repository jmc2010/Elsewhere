-- Per-user quota override, so development does not require raising the
-- default for everyone.
--
-- 60/user/day was a guess made before any real data existed. There is data
-- now: a normal session is ~10 calls, and a minute of filter browsing hit 42
-- before per-place caching landed. That is fine for a user and far too low
-- for whoever is building the thing, who will run ten sessions in an hour.
--
-- The tempting fix -- raise google_daily_call_limit() to 300 -- is the one
-- that ends in a bill. It would have to be remembered and lowered before real
-- users arrive, and that is exactly the kind of thing that is not remembered.
-- So the default stays at 60 and individual accounts can be granted more.

alter table profiles add column daily_google_call_limit int
  check (daily_google_call_limit is null or daily_google_call_limit >= 0);

comment on column profiles.daily_google_call_limit is
  'Overrides google_daily_call_limit() for this account. NULL means the
   default. Intended for development accounts; every Google call it permits
   costs real money, so do not hand it out.';

-- Nobody may raise their own quota. The column is writable only by
-- service_role, which the client never holds.
revoke update (daily_google_call_limit) on profiles from authenticated;

create or replace function google_quota_reserve(
  p_user    uuid,
  p_sku     text,
  p_calls   int,
  p_session text default null
)
returns table (granted int, used_today int, daily_limit int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_used  int;
  v_grant int;
begin
  if p_user is null then
    raise exception 'google_quota_reserve requires a user; anonymous Google calls are not permitted';
  end if;
  if p_calls is null or p_calls < 0 then
    raise exception 'p_calls must be >= 0 (got %)', p_calls;
  end if;

  select coalesce(pr.daily_google_call_limit, google_daily_call_limit())
    into v_limit
  from profiles pr where pr.id = p_user;
  -- No profile row means no override, not no limit.
  v_limit := coalesce(v_limit, google_daily_call_limit());

  select coalesce(sum(call_count), 0) into v_used
  from google_api_usage
  where user_id = p_user
    and called_at >= date_trunc('day', now());

  v_grant := least(p_calls, greatest(v_limit - v_used, 0));

  if v_grant > 0 then
    insert into google_api_usage (user_id, sku, call_count, session_id)
    values (p_user, p_sku, v_grant, p_session);
  end if;

  return query select v_grant, v_used + v_grant, v_limit;
end $$;

revoke execute on function google_quota_reserve(uuid, text, int, text) from public;
grant  execute on function google_quota_reserve(uuid, text, int, text) to service_role;

-- Grant the override to every account that has used the app so far. During
-- development that is only the developer's own devices; before there are real
-- users this becomes a targeted UPDATE instead.
--
-- TODO before launch: verify no unintended account carries an override.
--   select id, daily_google_call_limit from profiles
--    where daily_google_call_limit is not null;
update profiles
   set daily_google_call_limit = 2000
 where id in (select distinct user_id from google_api_usage
               where user_id is not null);
