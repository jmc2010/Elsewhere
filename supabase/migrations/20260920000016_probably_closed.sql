-- Infer that a known chain Google cannot find has closed.
--
-- Confirmed on the ground, twice in one small town. Rider's Smokehouse in
-- Valley View sold years ago; Overture says `open`. The Valley View Dairy
-- Queen shut and the building is now Tia's Tex-Mex; Overture says `open` and
-- Google, asked for "Dairy Queen, Valley View, TX", answered with the SANGER
-- branch 14km away.
--
-- Google's businessStatus is the corrective the spec anticipated (§11 risk 2),
-- and it helped with neither: it only works when Google still carries the dead
-- listing, and for both of these Google carries nothing at all.
--
-- The usable signal is an asymmetry in Google's coverage:
--
--   * Chain coverage is effectively complete. Google knows every Dairy Queen.
--     If it cannot find one at these coordinates, the branch is gone.
--   * Independent coverage in rural areas is NOT complete. That gap is the
--     reason this catalog exists, so an unresolved independent means nothing.
--
-- We already know which places are chains: 7,755 of 39,304 (19.7%) match
-- brand_cuisine_map. So the inference is free, and it is narrow -- only a
-- chain that ALSO fails resolution is suppressed.
--
-- Deliberately NOT places.permanently_closed. That column is set from Google
-- businessStatus and means Google asserted it. This is our inference from an
-- absence, it can be wrong, and conflating the two would lose that
-- distinction exactly where it matters.
--
-- Known false positive: a brand-new franchise Google has not indexed yet is
-- hidden until the 30-day resolution retry clears it.

alter table places add column probably_closed boolean not null default false;

comment on column places.probably_closed is
  'INFERRED, not asserted: a known chain that Google cannot find near these
   coordinates. Suppressed from shortlists. Distinct from permanently_closed,
   which comes from Google businessStatus. Cleared automatically if the place
   later resolves.';

create index places_probably_closed_idx on places (probably_closed)
  where probably_closed;

-- The inference lives here rather than in places-proxy: the function should
-- not need to know what a chain is, and keeping it in one place means the
-- retry path cannot forget to clear it.
create or replace function google_place_id_record(
  p_place    uuid,
  p_place_id text,
  p_failed   boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_chain boolean;
begin
  if p_failed or p_place_id is null then
    select exists (
      select 1 from places p
      join brand_cuisine_map b on b.name_norm = norm_place_name(p.name)
      where p.id = p_place
    ) into v_is_chain;

    update places
       set google_resolution_failed       = true,
           google_resolution_attempted_at = now(),
           probably_closed                = v_is_chain,
           updated_at                     = now()
     where id = p_place;
    return;
  end if;

  -- It resolved, so whatever we inferred from its absence was wrong.
  update places
     set google_place_id                 = p_place_id,
         google_place_id_resolved_at     = now(),
         google_resolution_failed        = false,
         google_resolution_attempted_at  = now(),
         probably_closed                 = false,
         updated_at                      = now()
   where id = p_place;
exception
  when unique_violation then
    update places
       set google_resolution_failed       = true,
           google_resolution_attempted_at = now(),
           updated_at                     = now()
     where id = p_place;
end $$;

revoke execute on function google_place_id_record(uuid, text, boolean) from public;
grant  execute on function google_place_id_record(uuid, text, boolean) to service_role;

-- Backfill the chains already known to have failed resolution.
update places p
   set probably_closed = true
 where p.google_resolution_failed
   and exists (select 1 from brand_cuisine_map b
                where b.name_norm = norm_place_name(p.name));

-- --- catalog_search excludes them -------------------------------------------
--
-- Lifted from 0014 with the predicate and its opt-out added, rather than
-- reworded, so the two cannot diverge.

drop function if exists catalog_search(
  double precision, double precision, double precision,
  text[], text[], uuid, boolean, boolean, integer);

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
    select p.id, p.name, p.location, p.address_line, p.locality, p.website,
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
            select 1 from place_vetoes v where v.place_id = n.id)
      and (not p_unvisited_only or p_household_id is null or not exists (
            select 1 from visits vi
            where vi.place_id = n.id and vi.household_id = p_household_id))
    order by n.dist
    limit p_limit
  )
  select
    f.id, f.name,
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
