-- Retire `visits`. Recency comes from lock-ins and verdicts instead.
--
-- `visits` has been in the schema since 0001 and has never held a row. It
-- could not: household_id is NOT NULL and its RLS policy is membership-based,
-- so a solo user is structurally unable to write one. The consequence was that
-- catalog_search's last_visited_at, visit_count and p_unvisited_only were
-- permanently inert -- and recency decay, which CLAUDE.md calls "the
-- differentiator, not a nice-to-have", had no data to act on. The product's
-- stated edge over Zest was reading from an empty table.
--
-- Ruled 2026-10-20: do not build households to rescue it. What `visits` was
-- for is already expressible:
--
--   intent            place_lockins
--   visit + opinion   place_verdicts.visited_on
--   visit, no opinion verdict = 'known'
--   frequency         count of place_lockins where did_go  <- append-only
--   last visit        max(locked_at) where did_go
--
-- Reported before acting, and NOT covered: chosen_by, visit_attendees and
-- occasion. All three are group semantics that need accounts, which is the
-- next chunk; occasion is referenced nowhere in the app. They will be
-- redesigned against real identities rather than rescued here.
--
-- For frequency to be true, every visit must leave a lock-in row. The client
-- change that lands with this migration makes "I've been here" write an
-- already-resolved lock-in alongside the verdict, so place_lockins becomes
-- the visit ledger.
--
-- p_household_id goes with it: it existed solely to scope `visits`, and both
-- replacement tables are RLS-scoped to auth.uid(). The app never passed it.
-- The tables themselves are LEFT IN PLACE, empty and unread -- dropping them
-- buys nothing and §9 may want the shape back.

begin;

-- Signature changes, so the old one must go by its exact argument list or
-- PostgREST sees two candidates (PGRST203).
drop function if exists catalog_search(
  double precision, double precision, double precision, integer, text,
  text[], text[], uuid, boolean, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.catalog_search(p_lat double precision, p_lon double precision, p_radius_meters double precision, p_limit integer, p_seed text, p_cuisines text[] DEFAULT NULL::text[], p_exclude_cuisines text[] DEFAULT NULL::text[], p_unvisited_only boolean DEFAULT false, p_include_delivery_only boolean DEFAULT false, p_include_probably_closed boolean DEFAULT false, p_include_non_destinations boolean DEFAULT true)
 RETURNS TABLE(place_id uuid, name text, display_name text, phone text, update_time timestamp with time zone, lat double precision, lon double precision, distance_meters double precision, address_line text, locality text, website text, cuisines text[], delivery_only boolean, locality_suspect boolean, non_destination_suspect boolean, opening_soon boolean, last_visited_at timestamp with time zone, visit_count bigint, my_verdict verdict_kind, freshness smallint, last_locked_at timestamp with time zone, confirmations integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare
  v_center      geography(point, 4326);
  v_include_ids int[];
  v_exclude_ids int[];
begin
  -- The old ceiling was 100, justified as "the hydration budget is the cost
  -- ceiling per session". That conflated two different limits. catalog_search
  -- makes zero Google calls -- it is Layer 1 only -- so nothing it returns
  -- costs anything. The hydration budget caps how many of these get sent to
  -- places-proxy, which is a separate, later, much smaller number (~25).
  --
  -- This is now the catalog pool: the set the ranker gets to choose from. It
  -- wants to be large, because anything outside it can never be recommended
  -- however good it is. 1000 is a guard against a runaway query, not a budget.
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000 (got %). This is the '
                    'catalog pool size and costs nothing; the Google hydration '
                    'budget is enforced separately in places-proxy.',
                    p_limit;
  end if;

  if p_radius_meters is null or p_radius_meters <= 0 or p_radius_meters > 160934 then
    raise exception 'p_radius_meters must be between 1 and 160934 (100 miles), got %. '
                    'An unbounded radius turns the spatial index scan into a full '
                    'catalog scan.', p_radius_meters;
  end if;

  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lon is null or p_lon < -180 or p_lon > 180 then
    raise exception 'p_lat/p_lon out of range (got %, %)', p_lat, p_lon;
  end if;

  v_center := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  -- A slug may name a GROUP or a LEAF. Groups organise the filter UI; leaves
  -- are what places are actually tagged with. Per the taxonomy seed,
  -- "filtering on a group means filtering on all of its leaves" -- so a group
  -- slug expands to its children. Without this, filtering on `asian` matches
  -- nothing at all, because no place carries the group id.
  select array_agg(id) into v_include_ids
  from cuisines
  where p_cuisines is not null
    and (slug = any(p_cuisines)
         or parent_id in (select id from cuisines where slug = any(p_cuisines)));

  select array_agg(id) into v_exclude_ids
  from cuisines
  where p_exclude_cuisines is not null
    and (slug = any(p_exclude_cuisines)
         or parent_id in (select id from cuisines where slug = any(p_exclude_cuisines)));

  if p_cuisines is not null and array_length(p_cuisines, 1) is not null
     and v_include_ids is null then
    raise exception 'no cuisine matched %; check slugs against the cuisines table', p_cuisines;
  end if;

  return query
  with nearby as materialized (
    select p.id, p.name, p.display_name, p.phone, p.update_time,
           p.location, p.address_line, p.locality, p.website,
           p.delivery_only, p.locality_suspect,
           p.non_destination_suspect, p.opening_soon,
           p.elsewhere_confirmations,
           st_distance(p.location, v_center) as dist
    from places p
    where st_dwithin(p.location, v_center, p_radius_meters)
      and not p.permanently_closed
      and (p_include_probably_closed or not p.probably_closed)
      and (p_include_delivery_only or not p.delivery_only)
      and (p_include_non_destinations or not p.non_destination_suspect)
  ),
  filtered as (
    select n.*
    from nearby n
    where (v_include_ids is null or exists (
             select 1 from place_cuisines pc
             where pc.place_id = n.id and pc.cuisine_id = any(v_include_ids)))
      and (v_exclude_ids is null or not exists (
             select 1 from place_cuisines pc
             where pc.place_id = n.id and pc.cuisine_id = any(v_exclude_ids)))
      and not exists (
            select 1 from place_verdicts v
            where v.place_id = n.id and v.verdict = 'not_again')
      -- "Unvisited" now means no resolved lock-in you actually went to, AND
      -- no verdict of any kind -- `known` from the recognition grid is a
      -- statement that you have been. Both tables are RLS-scoped to
      -- auth.uid(), so this is yours and needs no user parameter, which is
      -- also why p_household_id could go.
      and (not p_unvisited_only or (
            not exists (select 1 from place_lockins l
                        where l.place_id = n.id and l.did_go)
            and not exists (select 1 from place_verdicts v2
                            where v2.place_id = n.id)))
    -- Distance orders nothing. It is a gate -- st_dwithin above -- and that is
    -- the whole of its role (spec 3). Measured: eight Valley View results span
    -- 0.1 to 0.2 miles and ten Dallas places sit at 0.0, so ordering by it is
    -- noise at three decimal places, and TRUNCATING by it is worse: it decides
    -- membership of the candidate set before anything in Layer 3 is consulted.
    --
    -- Truncating by freshness instead is unbiased with respect to distance and
    -- weakly positive: it favours the records most likely to still exist,
    -- which is the same signal 5 uses to split fresh from stale. Free, the
    -- column is already here, and `id` makes it deterministic.
    --
    -- nulls last so a row with unknown freshness never outranks a confirmed
    -- one. Every promoted row has update_time today; a hand-inserted one might
    -- not.
    --
    -- Banded, not by exact timestamp. update_time is never DISPLAYED anywhere
    -- in the app: §5 only ever uses it to choose which of four confidence
    -- treatments a card gets. So precision in the sort key buys nothing, and
    -- it costs a great deal -- sorting on the exact value made 647 of
    -- downtown Dallas's 3,982 places reachable over a month, because 647 of
    -- them share one bulk timestamp and the seed could only shuffle within
    -- that block. Banding lifts it to 2,650.
    --
    -- The tiebreak is SEEDED, and that is not a refinement -- ordering by `id`
    -- was a bug. Freshness barely discriminates in a dense area: 647 of the
    -- top 1000 downtown Dallas rows share one bulk timestamp, so the tiebreak
    -- decides the pool. With `id` that is a fixed order, which means the same
    -- 200 of 3,982 come back for every user on every request forever, and the
    -- other 3,782 are not deprioritised -- they are unreachable.
    --
    -- md5 rather than hashtext: hashtext is an internal function whose value
    -- is not guaranteed stable across releases or architectures, and the whole
    -- point here is a slice that is stable for exactly one day and not one
    -- second longer.
    order by freshness_band(n.update_time) desc, md5(n.id::text || p_seed)
    limit p_limit
  )
  select
    f.id, f.name,
    -- display_name is never null after promote, but coalesce anyway: a row
    -- inserted by hand would otherwise render as a blank card, and a blank
    -- card is strictly worse than an unclean name.
    coalesce(f.display_name, f.name),
    f.phone,
    f.update_time,
    st_y(f.location::geometry), st_x(f.location::geometry),
    f.dist, f.address_line, f.locality, f.website,
    coalesce((select array_agg(c.slug order by c.slug)
              from place_cuisines pc join cuisines c on c.id = pc.cuisine_id
              where pc.place_id = f.id), '{}'::text[]),
    f.delivery_only,
    f.locality_suspect,
    f.non_destination_suspect,
    f.opening_soon,
    -- last_visited_at / visit_count, sourced from place_lockins rather than
    -- the retired `visits` table. A lock-in resolved did_go IS a visit, and
    -- the table is append-only, so counting it gives frequency -- which
    -- place_verdicts cannot, being one upserted row per user per place.
    (select max(l.locked_at) from place_lockins l
      where l.place_id = f.id and l.did_go),
    (select count(*) from place_lockins l
      where l.place_id = f.id and l.did_go),
    -- The CALLER's own verdict. RLS on place_verdicts restricts this to
    -- auth.uid() already, so no user parameter is needed and none is offered
    -- -- a function that took one could be asked for somebody else's history.
    (select v.verdict from place_verdicts v where v.place_id = f.id),
    freshness_band(f.update_time),
    -- The caller's most recent lock-in here. RLS scopes place_lockins to
    -- auth.uid(), so this is theirs and nobody else's. Drives provisional
    -- recency suppression: without it the app offers tonight's restaurant
    -- again tomorrow morning.
    (select max(l.locked_at) from place_lockins l where l.place_id = f.id),
    f.elsewhere_confirmations
  from filtered f
  -- Same ordering as the pool. The caller ranks; this returns a set, not a
  -- ranking. distance_meters is still RETURNED -- the card shows it -- it just
  -- does not decide anything here.
  order by freshness_band(f.update_time) desc, md5(f.id::text || p_seed);
end $function$;

grant execute on function catalog_search to authenticated;

-- catalog_find_by_name (0057) copied the projection, so it reads `visits`
-- too. Same substitution; its signature is unchanged, so no drop needed.
CREATE OR REPLACE FUNCTION public.catalog_find_by_name(p_lat double precision, p_lon double precision, p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(place_id uuid, name text, display_name text, phone text, update_time timestamp with time zone, lat double precision, lon double precision, distance_meters double precision, address_line text, locality text, website text, cuisines text[], delivery_only boolean, locality_suspect boolean, non_destination_suspect boolean, opening_soon boolean, last_visited_at timestamp with time zone, visit_count bigint, my_verdict verdict_kind, freshness smallint, last_locked_at timestamp with time zone, confirmations integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
#variable_conflict use_column
declare
  v_here  geography(point, 4326);
  v_query text;
begin
  v_query := btrim(coalesce(p_query, ''));

  -- Two characters is the floor. One character matches most of the catalog
  -- and the trigram index cannot help, so it would be a 39k-row scan per
  -- keystroke. Returning nothing is honest: the caller shows its prompt.
  if length(v_query) < 2 then
    return;
  end if;

  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'p_limit must be between 1 and 50 (got %)', p_limit;
  end if;

  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lon is null or p_lon < -180 or p_lon > 180 then
    raise exception 'p_lat/p_lon out of range (got %, %)', p_lat, p_lon;
  end if;

  v_here := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  return query
  with hit as (
    select p.*,
           coalesce(p.display_name, p.name) as shown,
           st_distance(p.location, v_here)  as dist
    from places p
    where coalesce(p.display_name, p.name) ilike '%' || v_query || '%'
      and not p.permanently_closed
  )
  select
    h.id,
    h.name,
    coalesce(h.display_name, h.name),
    h.phone,
    h.update_time,
    st_y(h.location::geometry), st_x(h.location::geometry),
    h.dist, h.address_line, h.locality, h.website,
    coalesce((select array_agg(c.slug order by c.slug)
              from place_cuisines pc join cuisines c on c.id = pc.cuisine_id
              where pc.place_id = h.id), '{}'::text[]),
    h.delivery_only,
    h.locality_suspect,
    h.non_destination_suspect,
    h.opening_soon,
    -- Same source as catalog_search after 0058: lock-ins, not `visits`.
    (select max(l.locked_at) from place_lockins l
      where l.place_id = h.id and l.did_go),
    (select count(*) from place_lockins l
      where l.place_id = h.id and l.did_go),
    -- RLS scopes these to auth.uid(), exactly as in catalog_search.
    (select v.verdict  from place_verdicts v where v.place_id = h.id),
    freshness_band(h.update_time),
    (select max(l.locked_at) from place_lockins l where l.place_id = h.id),
    h.elsewhere_confirmations
  from hit h
  -- NEAREST FIRST, and nothing else ahead of it.
  --
  -- The first draft ranked prefix matches above mid-name ones, on the theory
  -- that typing "taq" wants Taqueria before Pollo Taquito. Measured, that is
  -- wrong in the case this function exists for: searching "donut" from Valley
  -- View put Donut Palace (53.3 mi) above Daily Donuts (0.3 mi), because
  -- "Donut" is a prefix of one and not the other.
  --
  -- You reach for this screen to record somewhere you actually went, so the
  -- answer is somewhere you could actually get to. Distance is the signal;
  -- typing another character is how you disambiguate, and it costs nothing.
  -- This is the one place in the product where distance SHOULD sort -- §3
  -- forbids it for browsing, where the user has expressed no target.
  order by h.dist, h.shown
  limit p_limit;
end $function$;

grant execute on function catalog_find_by_name to authenticated;

commit;
