-- The non-destination flag must judge the TRADING name, not the legal one.
--
-- 0033 evaluated the legal-suffix test against `name`. 0032 had just added the
-- DBA rule, so for 62 rows `name` is the registered entity and `display_name`
-- is the actual restaurant. "Wood's Food Masters, Inc. Dba Joe's" was being
-- flagged as a non-destination on the strength of the "Inc." in a string no
-- customer will ever see, while the card renders "Joe's".
--
-- Split the two tests deliberately rather than moving both:
--
--   legal suffix   -> judged on display_name. An Inc. that survives into the
--                     trading name is evidence; one sitting in front of a DBA
--                     is not.
--   what-it-is     -> judged on `name`. Name cleaning can legitimately drop a
--                     descriptive tail ("- Roasting Facility"), and that tail
--                     is the entire signal. Judging it post-clean would throw
--                     the evidence away before reading it.
--
-- Rows like "Vasari, Llc Dba" -- a DBA with nothing after it -- keep their
-- flag, correctly: display_name falls back to the original because stripping
-- leaves an empty string, so the suffix is still there to be seen.

begin;

create or replace function refresh_non_destination_flags()
returns table (flagged_non_destination bigint, flagged_opening_soon bigint)
language plpgsql
set search_path = public
as $$
begin
  with judged as (
    select p.id,
           name_suggests_non_destination(p.name)
             or (name_has_legal_suffix(coalesce(p.display_name, p.name))
                 and not exists (select 1 from place_cuisines pc where pc.place_id = p.id))
             as is_non_destination,
           name_suggests_opening_soon(p.name) as is_opening_soon
    from places p
  )
  update places pl
     set non_destination_suspect = j.is_non_destination,
         opening_soon            = j.is_opening_soon
    from judged j
   where j.id = pl.id
     and (pl.non_destination_suspect is distinct from j.is_non_destination
       or pl.opening_soon            is distinct from j.is_opening_soon);

  return query
    select count(*) filter (where non_destination_suspect),
           count(*) filter (where opening_soon)
    from places;
end $$;

commit;
