-- Drop `warehouse` from the non-destination patterns.
--
-- THE TEST IS SEMANTIC AMBIGUITY, NOT HIT COUNT. "The Warehouse" is a
-- plausible name for a bar, a brewery or a music venue, so the pattern is
-- unsound at any volume -- a hundred correct hits would not make it safe,
-- because the failure is in what the word means rather than in how often it
-- appears. Measured here it was 6 wrong out of 8 (five Spaghetti Warehouse,
-- plus La Cave Warehouse - Fine Wine), but the count is corroboration, not
-- the argument.
--
-- The four that stay -- bitcoin atm, roasting facility, commissary,
-- distribution -- keep their place on 1 or 2 hits each, and should. They are
-- words that do not end up in a restaurant's name by accident: nobody calls
-- their bistro "Commissary" meaning a bistro.
--
-- Apply the same test to any pattern proposed later.

begin;

create or replace function name_suggests_non_destination(p_name text)
returns boolean
language sql immutable set search_path = public
as $$
  select p_name ~* (
    'bitcoin\s*atm'
    '|roasting\s+facility|commissary|distribution'
    '|\mnot\s+a\s+cafe\M'
  );
$$;

commit;
