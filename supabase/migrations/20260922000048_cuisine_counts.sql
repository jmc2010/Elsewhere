-- Cuisine groups present near a point, with real counts.
--
-- Spec §6: the filter sheet shows ONLY the cuisine groups actually present,
-- each with its count. Fifteen groups in a twelve-place town is a screen of
-- dead ends, and a filter that returns nothing teaches people not to filter.
--
-- Counted server-side rather than from the returned pool. The pool is capped
-- (200), so in a dense area counting it would report "Mexican 31" when the
-- truth is 400 -- a number that is wrong in the direction that makes the
-- filter look useless.
--
-- Groups, not leaves: a place tagged `tex-mex` counts toward `mexican`,
-- because filtering on a group means filtering on all of its leaves.
--
-- Uncategorised is deliberately ABSENT from this list rather than offered as
-- a group. §6: never let a cuisine filter silently swallow the rows with no
-- cuisine. They are excluded from a positive filter, not hidden -- the same
-- principle as unrated.

begin;

create or replace function catalog_cuisine_counts(
  p_lat                      double precision,
  p_lon                      double precision,
  p_radius_meters            double precision,
  p_include_non_destinations boolean default false
)
returns table (slug text, label text, place_count bigint)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with nearby as (
    select p.id
    from places p
    where st_dwithin(
            p.location,
            st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
            p_radius_meters)
      and not p.permanently_closed
      and not p.probably_closed
      and not p.delivery_only
      and (p_include_non_destinations or not p.non_destination_suspect)
      and not exists (
            select 1 from place_verdicts v
            where v.place_id = p.id and v.verdict = 'not_again')
  )
  select g.slug, g.label, count(distinct n.id)
  from nearby n
  join place_cuisines pc on pc.place_id = n.id
  join cuisines leaf      on leaf.id = pc.cuisine_id
  -- A leaf rolls up to its parent; a group tagged directly counts as itself.
  join cuisines g         on g.id = coalesce(leaf.parent_id, leaf.id)
  group by g.slug, g.label
  having count(distinct n.id) > 0
  order by count(distinct n.id) desc, g.label;
$$;

grant execute on function catalog_cuisine_counts to authenticated;

commit;
