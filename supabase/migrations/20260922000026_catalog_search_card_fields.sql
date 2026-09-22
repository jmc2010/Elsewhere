-- catalog_search returns the fields 0022 added.
--
-- The data landed in the catalog but nothing surfaced it, so the card states
-- that depend on it could not be populated. Each of the three drives a
-- specific piece of the card (design spec §2, §5):
--
--   display_name  what the card renders. `name` is still returned, because
--                 search matches on the original string.
--   phone         makes `Call ahead` do something. Free, ours, 88.6%.
--   update_time   the raw upstream timestamp, NOT a pre-bucketed confidence
--                 state. The fresh/stale threshold is a product decision that
--                 will move; baking it into the RPC would mean a migration
--                 every time it does, and would stop the app showing "last
--                 confirmed in October 2025" if that ever reads better than a
--                 bucket name.
--
-- Everything else is unchanged from 0021. Lifted rather than reworded.

begin;

-- The return type changes, and `create or replace` cannot do that -- Postgres
-- refuses with "cannot change return type of existing function". Drop by the
-- full argument signature, the same way 0016 did.
drop function if exists catalog_search(
  double precision, double precision, double precision,
  text[], text[], uuid, boolean, boolean, boolean, integer);

create or replace function catalog_search(
  p_lat                    double precision,
  p_lon                    double precision,
  p_radius_meters          double precision default 32187,
  p_cuisines               text[]  default null,
  p_exclude_cuisines       text[]  default null,
  p_household_id           uuid    default null,
  p_unvisited_only         boolean default false,
  p_include_delivery_only  boolean default false,
  p_include_probably_closed boolean default false,
  p_limit                  int     default 25
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
    order by n.dist
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
  order by f.dist;
end $$;

grant execute on function catalog_search to authenticated;

commit;
