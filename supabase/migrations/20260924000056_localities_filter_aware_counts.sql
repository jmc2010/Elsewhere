-- catalog_localities: the count must answer the question the filter asked.
--
-- The town count is a promise on a button (see 0041, which made it exclude
-- non-destinations for exactly this reason). It was still lying in a second
-- way: it ignored the active cuisine filter entirely.
--
-- Measured locally through this function, with Mexican selected:
--
--   Gainesville   shows 154   actually 11
--   Valley View   shows  16   actually  1
--   Dallas        shows 1262  actually 69
--
-- (Those totals are lower than a naive count of `places` in the same towns,
-- because this function already excludes locality_suspect, probably_closed and
-- non_destination_suspect rows. Quote these numbers, not a raw count -- these
-- are the ones the UI shows.)
--
-- So "Gainesville · 157" invited a drive to a town with eleven options, and
-- with Barbecue selected it invited a drive to a town with none. This is the
-- same fault as the filter trap fixed on 0fd4087 -- filter state persists, the
-- UI does not reflect it, and the user acts on a number that was never true.
--
-- Three decisions worth recording, because each one had a wrong answer that
-- looks reasonable:
--
--   1. `place_count` STAYS, and `match_count` is added beside it. The UI shows
--      "11 of 157": the match count answers "how much choice will I have",
--      the total is what distinguishes a real town from a mis-filed address.
--
--   2. `having count(*) >= 5` still counts the TOTAL, not the matches. Gating
--      on matches would make towns disappear from the list as you filter,
--      which reads as a broken list rather than an honest zero. A town with no
--      matches is shown at 0.
--
--   3. The centroid is built from ALL of a town's places, not the matching
--      ones. A town's location is not a property of your filter, and moving
--      the pin when the filter changes would also move the distance.
--
-- Group expansion is copied from catalog_search deliberately: a slug may name
-- a GROUP or a LEAF, and if these two disagree about what `asian` means then
-- the count on the button and the list behind it are computed differently.

begin;

-- The return type gains a column and the signature gains a parameter, so
-- `create or replace` cannot do it -- and the old signature must go by its
-- exact argument list. Leaving it would give PostgREST two candidates and a
-- PGRST203 ambiguity error, which cost an hour earlier in this project.
drop function if exists catalog_localities(double precision, double precision, integer);

create or replace function catalog_localities(
  p_lat      double precision,
  p_lon      double precision,
  p_limit    int     default 200,
  p_cuisines text[]  default null
)
returns table (
  locality        text,
  lat             double precision,
  lon             double precision,
  place_count     bigint,
  match_count     bigint,
  distance_meters double precision
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_here        geography(point, 4326);
  v_include_ids int[];
begin
  if p_lat is null or p_lat < -90 or p_lat > 90
     or p_lon is null or p_lon < -180 or p_lon > 180 then
    raise exception 'p_lat/p_lon out of range (got %, %)', p_lat, p_lon;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'p_limit must be between 1 and 500 (got %)', p_limit;
  end if;

  -- Same expansion as catalog_search: a group slug matches all of its leaves.
  select array_agg(id) into v_include_ids
  from cuisines
  where p_cuisines is not null
    and (slug = any(p_cuisines)
         or parent_id in (select id from cuisines where slug = any(p_cuisines)));

  if p_cuisines is not null and array_length(p_cuisines, 1) is not null
     and v_include_ids is null then
    raise exception 'no cuisine matched %; check slugs against the cuisines table', p_cuisines;
  end if;

  v_here := st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography;

  return query
  -- The match test is computed per ROW here rather than inside an aggregate
  -- FILTER, which keeps it a plain boolean and avoids a correlated subquery
  -- in a context that is awkward at best.
  with tagged as (
    select p.locality as loc,
           p.location as loc_geom,
           (v_include_ids is null or exists (
              select 1 from place_cuisines pc
              where pc.place_id = p.id and pc.cuisine_id = any(v_include_ids))) as matches
    from places p
    where p.locality is not null
      and not p.locality_suspect
      and not p.permanently_closed
      and not p.probably_closed
      and not p.non_destination_suspect
  ),
  towns as (
    select t.loc,
           count(*)                        as n,
           count(*) filter (where t.matches) as n_match,
           st_centroid(st_collect(t.loc_geom::geometry))::geography as centre
    from tagged t
    group by t.loc
    -- Total, not matches. See the header.
    having count(*) >= 5
  )
  select t.loc,
         st_y(t.centre::geometry),
         st_x(t.centre::geometry),
         t.n,
         t.n_match,
         st_distance(t.centre, v_here)
  from towns t
  order by st_distance(t.centre, v_here)
  limit p_limit;
end $$;

grant execute on function catalog_localities to authenticated;

commit;
