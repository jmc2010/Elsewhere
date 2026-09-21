-- Towns you can search from, derived from the catalog itself.
--
-- Spec §5.1 measures distance "from current location or a saved anchor like
-- home/work". This is the more useful generalisation: search somewhere you
-- are not yet. "We are driving to Gainesville, where should we eat when we
-- get there" is a decision, not a search, and it is where owning the catalog
-- beats renting an API -- Google is overwhelmingly near-me first.
--
-- No geocoding API is involved, and none should be. The catalog already knows
-- every town and where it is; a Geocoding call would cost money to learn
-- something we already hold.
--
-- Excludes the flags that exist precisely so a picker like this is not
-- polluted: an uncorroborated locality (0013) would offer a town the place is
-- not in, and closed places should not pad a town's count.

create function catalog_localities(
  p_lat   double precision,
  p_lon   double precision,
  p_limit int default 200
)
returns table (
  locality        text,
  lat             double precision,
  lon             double precision,
  place_count     bigint,
  distance_meters double precision
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_here geography(point, 4326);
begin
  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lon is null or p_lon < -180 or p_lon > 180 then
    raise exception 'p_lat/p_lon out of range (got %, %)', p_lat, p_lon;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500 (got %)', p_limit;
  end if;

  v_here := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  return query
  with towns as (
    select p.locality as loc,
           count(*)   as n,
           st_centroid(st_collect(p.location::geometry))::geography as centre
    from places p
    where p.locality is not null
      and not p.locality_suspect
      and not p.permanently_closed
      and not p.probably_closed
    group by p.locality
    -- A town with a handful of rows is usually a mis-filed address rather
    -- than somewhere worth driving to, and its centroid is meaningless.
    having count(*) >= 5
  )
  select t.loc,
         st_y(t.centre::geometry),
         st_x(t.centre::geometry),
         t.n,
         st_distance(t.centre, v_here)
  from towns t
  order by st_distance(t.centre, v_here)
  limit p_limit;
end $$;

comment on function catalog_localities is
  'Towns with 5+ open places, with their centroid and distance from a point,
   nearest first. The origin list for "search somewhere I am not yet". Derived
   from the catalog; no geocoding service is involved.';

grant execute on function catalog_localities to authenticated;
