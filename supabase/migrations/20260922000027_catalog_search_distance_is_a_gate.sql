-- catalog_search: distance becomes a gate only.
--
-- Spec 3 says distance is a gate, not a sort key. The function did not honour
-- that: it ordered the spatial CTE by distance, truncated it with LIMIT, and
-- ordered the projection by distance again. Re-ranking in the client cannot
-- fix that, because truncation happens first -- in Dallas, "nearest 25 of
-- 8,360" is a distance-selected set before Layer 3 sees anything, and the
-- twenty-sixth place was never a candidate.
--
-- Three changes:
--   1. p_radius_meters and p_limit lose their defaults and become required.
--   2. Distance no longer orders anything, anywhere.
--   3. The pool is ordered by update_time desc, id -- see the comment inline.

begin;

-- Signature changes, so the old one must go by its exact argument list.
drop function if exists catalog_search(
  double precision, double precision, double precision,
  text[], text[], uuid, boolean, boolean, boolean, integer);

create or replace function catalog_search(
  p_lat                    double precision,
  p_lon                    double precision,
  -- Required, no defaults. A default of "25 rows within 20 miles" is a product
  -- decision, and product decisions do not belong in a function signature --
  -- changing one would mean a migration. Both come from
  -- src/config/tuning.ts, where they are visible and tunable as spec 15 knobs.
  --
  -- p_limit sits here rather than last because Postgres will not accept a
  -- parameter without a default after one that has one. Callers use named
  -- arguments, so the position is not load-bearing.
  p_radius_meters          double precision,
  p_limit                  int,
  p_cuisines               text[]  default null,
  p_exclude_cuisines       text[]  default null,
  p_household_id           uuid    default null,
  p_unvisited_only         boolean default false,
  p_include_delivery_only  boolean default false,
  p_include_probably_closed boolean default false
)
returns table (
  place_id        uuid,
  name            text,
  display_name    text,
  phone           text,
  update_time     timestamptz,
  lat             double precision,
  lon             double precision,
  distance_meters double precision,
  address_line    text,
  locality        text,
  website         text,
  cuisines        text[],
  delivery_only   boolean,
  locality_suspect boolean,
  last_visited_at timestamptz,
  visit_count     bigint
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_center      geography(point, 4326);
  v_include_ids int[];
  v_exclude_ids int[];
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100 (got %). The hydration '
                    'budget is the cost ceiling per session; see spec §5.',
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
           st_distance(p.location, v_center) as dist
    from places p
    where st_dwithin(p.location, v_center, p_radius_meters)
      and not p.permanently_closed
      and (p_include_probably_closed or not p.probably_closed)
      and (p_include_delivery_only or not p.delivery_only)
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
      and (not p_unvisited_only or p_household_id is null or not exists (
            select 1 from visits vi
            where vi.place_id = n.id and vi.household_id = p_household_id))
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
    order by n.update_time desc nulls last, n.id
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
    (select max(vi.visited_at) from visits vi
      where vi.place_id = f.id
        and (p_household_id is null or vi.household_id = p_household_id)),
    (select count(*) from visits vi
      where vi.place_id = f.id
        and (p_household_id is null or vi.household_id = p_household_id))
  from filtered f
  -- Same ordering as the pool. The caller ranks; this returns a set, not a
  -- ranking. distance_meters is still RETURNED -- the card shows it -- it just
  -- does not decide anything here.
  order by f.update_time desc nulls last, f.id;
end $$;

grant execute on function catalog_search to authenticated;

commit;
