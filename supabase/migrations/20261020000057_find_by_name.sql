-- catalog_find_by_name: look up a place you already have in mind.
--
-- Three weeks of real use produced one sentence that is really a bug report:
-- "I ended up coming up with a different idea that I went with and enjoyed. I
-- wasn't able to find those though, and I wasn't able to tell the app where I
-- ended up going."
--
-- Towns have been searchable since 0020. Places never have. So the only way
-- to reach a restaurant was for the shortlist to happen to offer it, and in
-- Denton the shortlist is 15 of 750. Everything the product knows about
-- somebody -- the whole of Layer 3, the moat -- was gated behind a list that
-- shows 2% of a town.
--
-- Measured at the time of writing: 1 real verdict, 1 lock-in, 0 visits, across
-- six app sessions in October. The capture loop has no entrance.
--
-- Deliberate differences from catalog_search, each one the opposite of what
-- that function should do:
--
--   NO RADIUS. Naming a place is not browsing near one. If you are telling
--   the app about the barbecue place in Fort Worth, a 15-mile gate around
--   home is exactly wrong. Distance is still returned -- the card shows it --
--   it just does not decide membership. Same reasoning the town picker
--   already uses: "somewhere I'm heading is meaningless if the list stops at
--   25 miles."
--
--   CLOSED AND SUSPECT ROWS ARE INCLUDED. probably_closed and
--   non_destination_suspect are suppressed while browsing because they waste
--   a slot. When you have typed the name, they are the answer -- you may be
--   recording a visit to somewhere the catalog wrongly believes is shut, and
--   finding it is how that gets corrected. permanently_closed stays excluded;
--   that one is Overture asserting the place no longer exists.
--
-- The return shape is catalog_search's, column for column, so the client
-- reuses CatalogPlace and PlaceCard rather than growing a parallel set.

begin;

-- 39,304 rows makes ILIKE '%x%' a sequential scan on every keystroke. The
-- trigram index turns it into an index scan. Installed into `extensions`,
-- which is the schema every function here already carries on its search_path.
create extension if not exists pg_trgm with schema extensions;

create index if not exists places_name_trgm_idx
  on places using gin ((coalesce(display_name, name)) extensions.gin_trgm_ops);

create or replace function catalog_find_by_name(
  p_lat   double precision,
  p_lon   double precision,
  p_query text,
  p_limit int default 20
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
  non_destination_suspect boolean,
  opening_soon    boolean,
  last_visited_at timestamptz,
  visit_count     bigint,
  my_verdict      verdict_kind,
  freshness       smallint,
  last_locked_at  timestamptz,
  confirmations   integer
)
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
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
    (select max(vi.visited_at) from visits vi where vi.place_id = h.id),
    (select count(*)          from visits vi where vi.place_id = h.id),
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
end $$;

grant execute on function catalog_find_by_name to authenticated;

commit;
