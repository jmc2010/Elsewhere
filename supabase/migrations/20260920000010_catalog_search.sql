-- catalog_search: the Layer 1 + Layer 3 narrowing query.
--
-- Returns a shortlist of candidates for hydration. It makes NO Google calls
-- and never will -- browse and filter are free, and that is the whole reason
-- the three-layer split exists (spec §4, §5). Rating, price and open-now are
-- Layer 2 and are applied AFTER hydration, by places-proxy, on the ~25 rows
-- this returns.
--
-- Shape: SPATIAL FIRST, deliberately. Both orderings measure the same at
-- metro scale (54.2ms cuisine-first vs 55.7ms spatial-first), so structure
-- decides: a 20-mile radius is ~1,000 places whether the catalog holds 40k
-- rows or 4M, while cuisine-first scales with how many places nationally
-- share a cuisine and pays an st_dwithin call per candidate. The planner
-- cannot be trusted to notice -- PostGIS estimated 2 rows where 1,004
-- matched. See docs/measurements.md.
--
-- `as materialized` on the nearby CTE is load-bearing. Without it the planner
-- flattens the CTE and is free to re-choose the join order, which is exactly
-- what we are pinning down.
--
-- Two plpgsql hazards are handled explicitly at the top of the body:
--
--   #variable_conflict use_column   RETURNS TABLE declares every output name
--     (`name`, `cuisines`, `delivery_only`, ...) as a plpgsql variable, and
--     those collide with real column and table names in the query. Preferring
--     the column is what the query text already assumes.
--
--   search_path = public, extensions   PostGIS lives in `extensions` on some
--     Supabase projects and `public` on others. Pinning to `public` alone
--     would make st_dwithin unresolvable at runtime, not at create time.
--
-- SECURITY INVOKER: the caller's RLS applies, so vetoes and visits are
-- naturally scoped to the calling user without this function having to know
-- how. Do not make it SECURITY DEFINER -- that would leak one household's
-- history into another's shortlist.

create or replace function catalog_search(
  p_lat                    double precision,
  p_lon                    double precision,
  p_radius_meters          double precision default 32187,  -- 20 miles
  p_cuisines               text[]  default null,   -- include; null = any
  p_exclude_cuisines       text[]  default null,
  p_household_id           uuid    default null,   -- for novelty + last visit
  p_unvisited_only         boolean default false,
  p_include_delivery_only  boolean default false,
  p_limit                  int     default 25      -- the hydration ceiling
)
returns table (
  place_id        uuid,
  name            text,
  lat             double precision,
  lon             double precision,
  distance_meters double precision,
  address_line    text,
  locality        text,
  website         text,
  cuisines        text[],
  delivery_only   boolean,
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

  v_center := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  -- Resolve slugs to ids ONCE. Doing this inline costs an index lookup into
  -- cuisines per candidate row: the measured plan did 922 of them to find 17
  -- matches. After this it is an integer comparison.
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

  -- A slug that matches nothing is a caller bug, and silently returning
  -- everything would hide it behind a plausible-looking result.
  if p_cuisines is not null and array_length(p_cuisines, 1) is not null
     and v_include_ids is null then
    raise exception 'no cuisine matched %; check slugs against the cuisines table', p_cuisines;
  end if;

  return query
  with nearby as materialized (
    select p.id, p.name, p.location, p.address_line, p.locality, p.website,
           p.delivery_only,
           st_distance(p.location, v_center) as dist
    from places p
    where st_dwithin(p.location, v_center, p_radius_meters)
      and not p.permanently_closed
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
      -- RLS restricts place_vetoes to the caller, so this needs no user
      -- predicate of its own.
      and not exists (
            select 1 from place_vetoes v where v.place_id = n.id)
      and (not p_unvisited_only or p_household_id is null or not exists (
            select 1 from visits vi
            where vi.place_id = n.id and vi.household_id = p_household_id))
    order by n.dist
    limit p_limit
  )
  -- Decoration runs only on the surviving rows, never on the full radius.
  select
    f.id, f.name,
    st_y(f.location::geometry), st_x(f.location::geometry),
    f.dist, f.address_line, f.locality, f.website,
    coalesce((select array_agg(c.slug order by c.slug)
              from place_cuisines pc join cuisines c on c.id = pc.cuisine_id
              where pc.place_id = f.id), '{}'::text[]),
    f.delivery_only,
    (select max(vi.visited_at) from visits vi
      where vi.place_id = f.id
        and (p_household_id is null or vi.household_id = p_household_id)),
    (select count(*) from visits vi
      where vi.place_id = f.id
        and (p_household_id is null or vi.household_id = p_household_id))
  from filtered f
  order by f.dist;
end $$;

comment on function catalog_search is
  'Layer 1 + Layer 3 narrowing. Returns up to p_limit candidates for
   hydration, nearest first. Makes no Google calls. Rating, price and open-now
   are Layer 2 and are applied after hydration.';

grant execute on function catalog_search to authenticated;
