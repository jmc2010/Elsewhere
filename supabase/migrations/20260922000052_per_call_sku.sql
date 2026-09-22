-- Attribute Google spend PER CALL, by what was actually invoked.
--
-- The old reservation took one SKU for a whole batch, and a batch is not one
-- kind of call. Two errors compounded:
--
--   1. A place needing resolution costs two calls -- a searchText to find it,
--      then a details call. Both were billed as the batch SKU.
--   2. searchText is TEXT SEARCH, a different SKU family from Place Details
--      altogether. Billing it as places.details.enterprise_atmosphere was
--      wrong in the call type AND the tier.
--
-- Every one of the 396 calls logged so far carries that error and cannot be
-- re-attributed after the fact, which is why this lands before the device run
-- rather than after: a baseline measured against broken bookkeeping is worse
-- than no baseline.
--
-- THE MASK SELECTS THE TIER, which is why these three are distinct:
--
--   places.searchText.pro              MASK_RESOLVE asks for displayName and
--                                      location. Both are Pro-tier fields for
--                                      Text Search; only id/name/attributions
--                                      would have been Essentials.
--   places.details.enterprise          MASK_SHORTLIST adds rating,
--                                      priceLevel and opening hours.
--   places.details.enterprise_atmosphere  MASK_DETAIL adds reviews and the
--                                      serves*/goodFor* attributes.
--
-- The reservation stays atomic. Reserve-and-record in one statement is what
-- stops two concurrent requests both seeing budget and both spending it;
-- splitting it into check-then-record would reopen that window to fix a
-- reporting problem, which is a bad trade.

begin;

-- New signature, taking a breakdown rather than a single SKU. The old
-- single-SKU form is left in place so a deployed edge function keeps working
-- until it is redeployed; it should be dropped once nothing calls it.
comment on function google_quota_reserve(uuid, text, int, text) is
  'DEPRECATED: attributes a whole batch to one SKU. Use the jsonb breakdown form.';

create or replace function google_quota_reserve(
  p_user      uuid,
  p_breakdown jsonb,   -- {"places.searchText.pro": 3, "places.details.enterprise": 5}
  p_session   text default null
)
returns table (granted int, used_today int, daily_limit int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit     int := google_daily_call_limit();
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

  -- Allocate the grant across SKUs in a deterministic order. Under a FULL
  -- grant -- the normal case -- every SKU gets exactly what it asked for and
  -- the ordering is irrelevant. It only matters at the daily ceiling, where
  -- a partial grant has to be attributed somehow; resolution is taken first
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

revoke all on function google_quota_reserve(uuid, jsonb, text) from public, anon, authenticated;

commit;
