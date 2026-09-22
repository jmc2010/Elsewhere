-- Two changes to the non-destination rule.
--
-- (1) DROP `commissary` AND `distribution`. They fail the same semantic
--     ambiguity test `warehouse` failed, and the catalog proves it rather
--     than the test merely predicting it:
--         Distribution Bar   | Cocktail Bar   -- a bar called Distribution
--         The Commissary     | Tea House
--         Commissary         | Cafe
--     Kept: bitcoin atm, roasting facility, not a cafe. Those name a thing
--     the place IS, and none of them is a plausible venue name.
--
-- (2) A LEGAL SUFFIX NO LONGER FLAGS A VENUE. "The Lonesome Dove Western
--     Bistro Ltd" is Tim Love's restaurant; "J Samuell Restaurant, Llc" is a
--     restaurant. Every incorporated business in Texas carries a suffix, so
--     the suffix says nothing on its own -- what mattered was the ABSENCE of
--     any other evidence, and a venue word in the name is evidence.
--
--     Unless it also carries a holding word. "M Crowd Restaurant Group Inc"
--     is Mi Cocina's parent company: "Restaurant" plus "Group" is a company
--     that owns restaurants, not a restaurant.

begin;

create or replace function name_suggests_non_destination(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_name ~* (
    'bitcoin\s*atm'
    '|roasting\s+facility'
    '|\mnot\s+a\s+cafe\M'
  );
$$;

-- The place calls itself somewhere you can go.
create or replace function name_has_venue_word(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_name ~* '\m(bistro|cafe|café|restaurant|grill|grille|kitchen|taqueria|bakery|bar|cantina|diner|pizzeria|brewery|taproom)\M';
$$;

-- ...but the name says it OWNS them rather than being one.
create or replace function name_has_holding_word(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_name ~* '\m(group|holdings|investments|enterprise|enterprises|properties|management|partners|ventures)\M';
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
             or (
               name_has_legal_suffix(coalesce(p.display_name, p.name))
               and not exists (select 1 from place_cuisines pc where pc.place_id = p.id)
               and not (
                 name_has_venue_word(coalesce(p.display_name, p.name))
                 and not name_has_holding_word(coalesce(p.display_name, p.name))
               )
             ) as is_non_destination,
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

grant execute on function name_has_venue_word   to authenticated;
grant execute on function name_has_holding_word to authenticated;

commit;
