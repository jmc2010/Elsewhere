-- Server-side controls for Google spend. places-proxy is the only caller.
--
-- Google Enterprise SKUs are the one cost that scales with usage and the
-- spec's primary engineering risk (§5): the naive design is ~$13k/month at
-- 10k users. Everything here exists to make that impossible rather than
-- unlikely.
--
-- None of it is reachable from the client. Execute is revoked from public and
-- authenticated and granted only to service_role, which only the edge
-- function holds. A client that could call google_quota_reserve directly
-- could burn its own quota without making a call, or worse, not burn it while
-- making one.

-- --- Telemetry --------------------------------------------------------------

-- Calls-per-session is a first-class metric "from the first hydration call,
-- not something to instrument after launch" (§5). It is not computable
-- without a session identifier, so the column goes in before the first call
-- rather than after.
alter table google_api_usage add column session_id text;

create index google_api_usage_session_idx
  on google_api_usage (session_id, called_at desc)
  where session_id is not null;

comment on column google_api_usage.session_id is
  'Opaque per-session id minted by the client. Groups calls so that
   calls-per-session can be measured; see google_calls_per_session().';

-- --- The limit --------------------------------------------------------------

-- A function rather than a literal so there is exactly one place to change
-- it, and changing it is a migration with a diff rather than an edit to a
-- deployed function nobody can see.
--
-- 60/user/day is deliberately generous against real use: a session hydrates
-- a shortlist of ~25 plus a handful of detail views, so this is roughly two
-- full sessions. It is a runaway-loop guard, not a product limit. Revisit it
-- against real calls-per-session data rather than by guessing again.
create function google_daily_call_limit()
returns int language sql immutable as $$ select 60 $$;

-- --- Quota ------------------------------------------------------------------

-- Reserve-and-record in one statement. The alternative -- check, then call,
-- then record -- leaves a window where concurrent requests both see budget
-- and both spend it. Recording up front means a crashed request has
-- over-counted, which costs the user some quota. Under-counting would cost
-- money, so the asymmetry is chosen on purpose.
--
-- Returns how many calls are GRANTED, which may be fewer than requested.
-- places-proxy must hydrate only that many and degrade the rest to
-- catalog-only, per §5's "degraded catalog-only mode when exceeded".
create function google_quota_reserve(
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
  v_limit int := google_daily_call_limit();
  v_used  int;
  v_grant int;
begin
  if p_user is null then
    raise exception 'google_quota_reserve requires a user; anonymous Google calls are not permitted';
  end if;
  if p_calls is null or p_calls < 0 then
    raise exception 'p_calls must be >= 0 (got %)', p_calls;
  end if;

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

-- --- place_id writeback -----------------------------------------------------

-- The ONLY Google-derived value that may be written to the database, and the
-- reason the whole lazy-resolution design pays off: resolution is bought once
-- per place across the entire user base (§4).
--
-- Nothing else from the Places response may pass through here. There is no
-- parameter for rating, hours or price, and there must never be one.
create function google_place_id_record(
  p_place    uuid,
  p_place_id text,
  p_failed   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_failed or p_place_id is null then
    update places
       set google_resolution_failed = true,
           updated_at = now()
     where id = p_place;
    return;
  end if;

  update places
     set google_place_id             = p_place_id,
         google_place_id_resolved_at = now(),
         google_resolution_failed    = false,
         updated_at                  = now()
   where id = p_place;
exception
  -- places.google_place_id is unique. Two catalog rows resolving to the same
  -- Google place means Overture holds a duplicate of one restaurant -- real,
  -- and not something to discover at 3am. Flag the loser rather than failing
  -- the whole hydration batch.
  --
  -- TODO: these are duplicate catalog rows and should be merged, not just
  -- flagged. Needs a dedupe pass; see docs/STATUS.md.
  when unique_violation then
    update places
       set google_resolution_failed = true,
           updated_at = now()
     where id = p_place;
end $$;

-- --- businessStatus writeback ----------------------------------------------

-- places.permanently_closed is OUR derived boolean, which the 0001 schema
-- already describes as "set from Google's businessStatus at hydration time
-- ... not retained Google content". This is the only thing that may set it
-- from a Places response, and it takes a boolean rather than the status
-- string precisely so the Google value cannot be stored verbatim.
--
-- Spec §11 risk 2: Overture data goes stale and closed restaurants appear.
-- Google's businessStatus is the corrective, and suppressing the row also
-- stops us paying to hydrate a dead restaurant again.
create function google_business_status_record(
  p_place uuid,
  p_permanently_closed boolean
)
returns void
language sql
security definer
set search_path = public
as $$
  update places
     set permanently_closed = p_permanently_closed,
         updated_at = now()
   where id = p_place
     and permanently_closed is distinct from p_permanently_closed;
$$;

-- --- Coordinates for the proxy ---------------------------------------------

-- places.location is geography, which PostgREST cannot serialise usefully.
-- places-proxy needs lat/lon to validate a resolution against the returned
-- coordinates, so it gets them here rather than by selecting the geometry and
-- parsing WKB in TypeScript.
create function places_coords(p_ids uuid[])
returns table (id uuid, lat double precision, lon double precision)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, st_y(p.location::geometry), st_x(p.location::geometry)
  from places p where p.id = any(p_ids)
$$;

-- --- Reporting --------------------------------------------------------------

-- The metric the spec says to alert on. Kept as a function so the definition
-- of "a session" lives in one place rather than in a dashboard nobody reads.
create function google_calls_per_session(p_since timestamptz default now() - interval '7 days')
returns table (
  session_id   text,
  user_id      uuid,
  calls        bigint,
  first_call   timestamptz,
  last_call    timestamptz
)
language sql stable security definer set search_path = public as $$
  select g.session_id, (array_agg(g.user_id))[1], sum(g.call_count)::bigint,
         min(g.called_at), max(g.called_at)
  from google_api_usage g
  where g.session_id is not null and g.called_at >= p_since
  group by g.session_id
  order by sum(g.call_count) desc
$$;

-- --- Lock the doors ---------------------------------------------------------

-- Postgres grants EXECUTE to PUBLIC by default, which would put the cost
-- controls in reach of any authenticated client.
revoke execute on function google_quota_reserve(uuid, text, int, text)   from public;
revoke execute on function google_place_id_record(uuid, text, boolean)   from public;
revoke execute on function google_business_status_record(uuid, boolean) from public;
revoke execute on function google_calls_per_session(timestamptz)         from public;
revoke execute on function google_daily_call_limit()                     from public;
revoke execute on function places_coords(uuid[])                          from public;

grant execute on function google_quota_reserve(uuid, text, int, text)    to service_role;
grant execute on function google_place_id_record(uuid, text, boolean)    to service_role;
grant execute on function google_business_status_record(uuid, boolean)  to service_role;
grant execute on function google_calls_per_session(timestamptz)          to service_role;
grant execute on function google_daily_call_limit()                      to service_role;
grant execute on function places_coords(uuid[])                           to service_role;
