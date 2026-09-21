-- Trust the name when it says the place is closed.
--
-- Eight North Texas rows carry a closure marker in the name field, and
-- Overture marks six of them `open`:
--
--   [INACTIVE]ROMANO'S 3                              open
--   Chili's Grill & Bar - Closed                      open
--   Corner Bakery Cafe - Temporarily Closed           open
--   Firenza Pizza - Temporarily Closed                open
--   Sunset Lounge-dallas (closed)                     open
--   Blue Goose Cantina - Temporarily Closed           null
--   Closed now                                        null
--   Snap Kitchen - This Location Permanently Closed   permanently_closed
--
-- 0.02% of the catalog, so this is not a systemic signal -- it is three lines
-- that stop "Chili's Grill & Bar - Closed" appearing in a shortlist. Found by
-- reading the first page of names the cuisine pass was about to classify.
--
-- Folded into refresh_place_quality_flags() so it survives a reingest rather
-- than being a one-time UPDATE that the next Overture release undoes.
--
-- Note "Temporarily Closed" is caught too. A temporarily closed restaurant is
-- still a bad shortlist result, and probably_closed is reversible: a later
-- successful resolution clears it (0016).

create or replace function refresh_place_quality_flags()
returns void
language plpgsql
as $$
begin
  update places p
     set colocated_count = (
           select count(*) from places q
            where q.id <> p.id
              and st_dwithin(q.location, p.location, 30)
         );

  with g as (
    select id, lower(trim(locality)) as loc,
           floor(st_y(location::geometry) * 40) as gy,
           floor(st_x(location::geometry) * 40) as gx
    from places where locality is not null
  ),
  per_loc  as (select gx, gy, loc, count(*) as c from g group by gx, gy, loc),
  per_cell as (select gx, gy, sum(c) as n from per_loc group by gx, gy),
  flagged as (
    select g.id
    from g
    join per_loc  pl using (gx, gy, loc)
    join per_cell pc using (gx, gy)
    where pl.c = 1 and pc.n >= 5
  )
  update places p
     set locality_suspect = (p.id in (select id from flagged));

  -- The name says it is shut. Believe it -- unless Google has resolved the
  -- place, in which case believe Google.
  --
  -- Without that exception this fights 0016: a successful resolution clears
  -- probably_closed, and then the next promote would set it straight back,
  -- permanently hiding any real restaurant whose name happens to contain the
  -- word (a "Closed Loop Cafe" is not implausible at multi-metro scale).
  -- Having resolved is positive evidence of existing; a name is not.
  update places p
     set probably_closed = true
   where not p.probably_closed
     and p.google_place_id is null
     and p.name ~* '(\[inactive\]|\mclosed\M|permanently closed|temporarily closed)';
end $$;

select refresh_place_quality_flags();
