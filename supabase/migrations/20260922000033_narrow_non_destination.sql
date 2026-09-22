-- Narrow the non-destination flag, and decode entities in promote.
--
-- The first population flagged 1,578 rows on a legal suffix alone, and the
-- two measured groups make the case for splitting them:
--
--   legal suffix, NO cuisine   1,127 rows,  7% have a phone
--   legal suffix, HAS cuisine    433 rows, 33% have a phone
--
-- The second group is real restaurants that happen to be incorporated --
-- Song's Olive Bakery Llc, 34 Smoke LLC, Humperdinks Texas Llc,
-- Griff's Of America Inc. A cuisine assignment means Overture's own taxonomy
-- put it in a food category AND a brand or category map matched it; that is
-- real evidence, and it outweighs a suffix that every incorporated business
-- in Texas carries.
--
-- So: a legal suffix flags ONLY when the row has no cuisine at all. The
-- specific patterns -- bitcoin ATM, commissary, roasting facility,
-- distribution, warehouse -- still flag unconditionally, because they
-- describe what the place IS rather than how it is registered.
--
-- CAVEAT ON `warehouse`, unresolved: 6 of its 8 matches are false positives
-- (5 x Spaghetti Warehouse, plus La Cave Warehouse - Fine Wine). It is kept
-- because it was not ruled on, and it is a flag rather than an action, but it
-- is the weakest pattern in the set and should probably go.

begin;

create or replace function name_has_legal_suffix(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_name ~* '\m(ltd|llp|llc|inc|incorporated|corporation)\M';
$$;

-- Describes what the place is, not how it is registered. Flags on its own.
create or replace function name_suggests_non_destination(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_name ~* (
    'bitcoin\s*atm'
    '|roasting\s+facility|commissary|warehouse|distribution'
    '|\mnot\s+a\s+cafe\M'
  );
$$;

create or replace function refresh_non_destination_flags()
returns table (flagged_non_destination bigint, flagged_opening_soon bigint)
language plpgsql
set search_path = public
as $$
begin
  with judged as (
    select p.id,
           name_suggests_non_destination(p.name)
             or (name_has_legal_suffix(p.name)
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

grant execute on function name_has_legal_suffix to authenticated;

commit;
