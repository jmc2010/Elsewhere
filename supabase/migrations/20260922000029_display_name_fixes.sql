-- derive_display_name: four fixes, from reviewing all 81 changed long names.
--
--   a. Never return a bare locality or store number. "Grand Prairie, TX -
--      Epic West Towne Crossing" became "Grand Prairie, TX" -- a hero line
--      naming a town, not a restaurant. Five such rows. The governing rule:
--      NEVER MAKE A NAME LESS USABLE THAN YOU FOUND IT. If the cleaned result
--      is worse than the mess, keep the mess.
--
--   b. Never discard a parenthetical carrying a negation. "Ascension Coffee
--      Roasters - Roasting Facility (not A Cafe)" lost the only words saying
--      it is not somewhere you go, and post-clean it reads as a coffee shop.
--
--   c. Apply the cuts iteratively until stable. "It's Sno Worth It - Snow
--      Cones | Shaved Ice" cut at the pipe, then failed the dash test against
--      the already-shortened string, and stopped half-cleaned.
--
--   d. Separator variants: a dash with whitespace on only ONE side
--      ("Chicken- Irving"), a spaced colon ("Blue Fox : Sports Bar - ..."),
--      and strip a trailing www.* BEFORE the separator test rather than after.
--
-- Still deliberately not done: casing repair (Llc, THE 1845) and stripping
-- trailing localities in general. Both are separate rules with their own
-- failure modes and deserve their own review pass.

begin;

-- A cleaned result that is worse than the original. Checked against the
-- OUTPUT, unlike display_name_head_is_prefix which checks the input side.
create or replace function display_name_is_worse(p_clean text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    -- Bare store or unit number.
    btrim(p_clean) ~ '^[0-9#]+$'
    -- "Grand Prairie, TX", "Southlake TX #119", "Fort Worth TX #204".
    -- A place name that is only a town plus a state, optionally with a store
    -- number, names no business at all.
    or btrim(p_clean) ~ '^[A-Z][a-z]+( [A-Z][a-z]+)*,? TX( #[0-9]+)?$'
    -- Nothing usable left.
    or length(btrim(p_clean)) < 2;
$$;

-- A fragment that must never be discarded, however long it is.
create or replace function display_name_must_keep(p_fragment text)
returns boolean
language sql
immutable
set search_path = public
as $$
  -- A parenthetical negation is the record telling you it is not what the
  -- name implies: "(not A Cafe)", "(no dine-in)". That is the single most
  -- useful thing in the string and cutting it inverts the meaning.
  select p_fragment ~* '\([^)]*\m(not|no)\M[^)]*\)';
$$;

create or replace function derive_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s        text := p_name;
  prev     text;
  head     text;
  tail     text;
  m        text[];
  guard    int  := 0;
begin
  if s is null then
    return null;
  end if;

  -- (d) A trailing URL goes first. Doing it last meant the separator test ran
  -- against a string still ending in "- www.example.com", where the tail was
  -- the URL rather than the descriptive clause.
  s := regexp_replace(s, '\s*www\.\S*\s*$', '', 'i');

  -- (c) Cuts interact: removing one separator can expose another. Loop until
  -- the string stops changing. The guard is belt and braces -- each pass can
  -- only shorten the string, so it terminates -- but an infinite loop inside
  -- an immutable function called over 39k rows is not a failure worth risking.
  loop
    guard := guard + 1;
    exit when guard > 10;
    prev := s;

    -- Pipe. Skipped when what precedes it is a prefix rather than a name
    -- ("TX | Teriyaki Madness Dallas").
    if position('|' in s) > 0
       and not display_name_head_is_prefix(split_part(s, '|', 1))
       and not display_name_must_keep(substring(s from position('|' in s)))
    then
      s := split_part(s, '|', 1);
    end if;

    -- (d) Dash or colon, with whitespace on at least one side. Requiring it on
    -- both missed "Chicken- Irving TX"; requiring neither would split
    -- "Coal-Fired" and "Tex-Mex", which is why bare punctuation never counts.
    m := regexp_match(s, '^(.*?)(?:\s+[-–—:]\s*|\s*[-–—:]\s+)(.*)$');
    if m is not null then
      head := btrim(m[1]);
      tail := btrim(m[2]);
      if length(tail) > length(head)
         and not display_name_head_is_prefix(head)
         and not display_name_must_keep(tail)   -- (b)
      then
        s := head;
      end if;
    end if;

    s := btrim(regexp_replace(btrim(s), '[\s|,;:–—-]+$', ''));
    exit when s = prev;
  end loop;

  if s = '' then
    return p_name;
  end if;

  -- (a) Last word: if the cleaning made it worse, it did not happen.
  if display_name_is_worse(s) then
    return p_name;
  end if;

  return s;
end $$;

grant execute on function display_name_is_worse to authenticated;
grant execute on function display_name_must_keep to authenticated;
grant execute on function derive_display_name to authenticated;

commit;
