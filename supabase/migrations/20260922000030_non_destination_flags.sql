-- Non-destination and opening-soon flags, from the name.
--
-- The catalog is full of records nobody can eat at, and the names give them
-- away: "2153698 Alberta Ltd - Canadian Company Using Borrower Addres",
-- "Sdi Of Grapevine - Grapevine Mills Mall Llp", "CoinFlip Bitcoin ATM -
-- Flamingo Beer & Wine (Carrollton)". They carry a food_and_drink category,
-- so the taxonomy filter cannot see them.
--
-- This is the free, bulk version of spec §5's "Not somewhere you eat or
-- drink" correction: the same judgement, applied from a pattern instead of
-- from a person, over the whole catalog, at no cost.
--
-- FLAGS ONLY. Nothing is deleted and nothing is filtered out of
-- catalog_search by this migration. A pattern match is evidence, not a
-- verdict, and some real independents genuinely carry `Llc` in their trading
-- name -- which is exactly why the flag is reviewable and the rows stay.
--
-- `opening_soon` is the opposite case and is CAPTURED, not stripped.
-- "Crumbl Cookies - Rayzor Ranch - Coming Soon" is not noise: it means the
-- place is not open yet, which is a fact worth having and worth showing.

begin;

alter table places add column non_destination_suspect boolean not null default false;
alter table places add column opening_soon            boolean not null default false;

comment on column places.non_destination_suspect is
  'Name suggests this is not a place you can eat or drink at. Evidence, not a verdict -- never auto-delete on it.';
comment on column places.opening_soon is
  'Name says the place has not opened yet. A fact to show, not noise to strip.';

create or replace function name_suggests_non_destination(p_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_name ~* (
    -- Corporate/legal entity suffixes. Word-bounded: "Llc" must be its own
    -- token, so "Llcaqueria" or similar cannot trip it.
    '\m(ltd|llp|llc|inc|incorporated|corporation)\M'
    -- Not a place, a machine.
    '|bitcoin\s*atm'
    -- Production and logistics sites that carry a food category.
    '|roasting\s+facility|commissary|warehouse|distribution'
    -- The record telling you outright.
    '|\mnot\s+a\s+cafe\M'
  );
$$;

create or replace function name_suggests_opening_soon(p_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_name ~* '(coming\s+soon|opening\s+soon|now\s+hiring)';
$$;

-- Re-runnable. Should be called from promote once the flags have been eyed
-- over; deliberately NOT wired in yet, so the first population can be
-- reviewed before it becomes automatic.
create or replace function refresh_non_destination_flags()
returns table (flagged_non_destination bigint, flagged_opening_soon bigint)
language plpgsql
set search_path = public
as $$
begin
  update places
     set non_destination_suspect = name_suggests_non_destination(name),
         opening_soon            = name_suggests_opening_soon(name)
   where non_destination_suspect is distinct from name_suggests_non_destination(name)
      or opening_soon            is distinct from name_suggests_opening_soon(name);

  return query
    select count(*) filter (where non_destination_suspect),
           count(*) filter (where opening_soon)
    from places;
end $$;

grant execute on function name_suggests_non_destination to authenticated;
grant execute on function name_suggests_opening_soon    to authenticated;

commit;
