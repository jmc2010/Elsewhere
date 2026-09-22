-- catalog_localities: exclude non-destinations from the counts.
--
-- The count is not decoration -- it is the promise on a button. The rural
-- exhausted screen offers "Open it up to Sanger · 57", and if the shortlist
-- then filters non-destinations out of that 57, the number on the button was
-- never true. A count shown to a user has to be the count they will get.
--
-- Same filter the shortlist passes, so the two cannot disagree.

begin;

create or replace function catalog_localities(
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
      and not p.non_destination_suspect
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

grant execute on function catalog_localities to authenticated;

commit;
