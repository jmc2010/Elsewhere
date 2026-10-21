-- catalog_area_total: how many places exist before any choice I made.
--
-- "I said the list feels like it is teasing me. Paging fixed the escape; the
-- suspicion is still there. Nine out of 1,171 reads as withholding when
-- nothing on screen says what produced the nine."
--
-- The shortlist could not state its own denominator. `pool` is already
-- filtered and already truncated at poolLimit, so the screen had no access to
-- the honest total -- the number of places that exist where you are looking,
-- before cuisine, before mood, before open-now. Without it the narrowing is
-- invisible, and invisible narrowing reads as withholding rather than as a
-- funnel you built and can undo.
--
-- Deliberately NOT a count of catalog_search. That function applies the
-- filters, which is the whole thing this number exists to be measured
-- against. Same exclusions as catalog_search otherwise, so the two agree
-- about what a place is: open, not delivery-only, in range.
--
-- Layer 1, no Google call, one index scan. Cheap enough to run per search.

begin;

create or replace function catalog_area_total(
  p_lat                      double precision,
  p_lon                      double precision,
  p_radius_meters            double precision,
  p_include_non_destinations boolean default true
)
returns bigint
language sql
stable
security invoker
set search_path = public, extensions
as $$
  select count(*)
  from places p
  where st_dwithin(
          p.location,
          st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
          p_radius_meters)
    and not p.permanently_closed
    and not p.probably_closed
    and not p.delivery_only
    and (p_include_non_destinations or not p.non_destination_suspect);
$$;

grant execute on function catalog_area_total to authenticated;

commit;
