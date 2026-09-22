-- Split the name rule: SEO-tail cut and locality strip are different jobs.
--
-- The one-sided dash allowance was a mistake, and no tuning of it could have
-- worked: "Louisiana Famous Fried Chicken- Irving TX" and "Estrada's TEX- MEX
-- Catering Services" are structurally identical -- word, dash, space, word --
-- so a rule that cuts one cuts the other. They are different jobs wearing the
-- same punctuation.
--
--   SEO-tail cut  requires whitespace on BOTH sides of the dash. A separator
--                 somebody typed deliberately. Reverts the one-sided
--                 allowance, which means "Chicken- Irving TX" is no longer
--                 cut by THIS rule.
--   Locality strip its own pattern, matching a trailing "<City> TX" whatever
--                 the spacing. Handles the Louisiana case without going
--                 anywhere near TEX-MEX.
--
-- And a new guard: revert if the result ends in an all-caps token of four
-- characters or fewer. "Estrada's TEX" should have tripped something even
-- with the bad cut -- a name ending in a short shout is a fragment of a word,
-- not a name.

begin;

create or replace function display_name_is_worse(p_clean text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    -- Bare store or unit number.
    btrim(p_clean) ~ '^[0-9#]+$'
    -- A town plus a state names no business at all.
    or btrim(p_clean) ~ '^[A-Z][a-z]+( [A-Z][a-z]+)*,? TX( #[0-9]+)?$'
    -- Ends in a short all-caps token: "Estrada's TEX", "Something MEX".
    -- A cut that leaves a shout on the end has cut inside a word.
    or btrim(p_clean) ~ '[A-Z]{1,4}$' and btrim(p_clean) ~ '\s[A-Z]{1,4}$'
    -- Nothing usable left.
    or length(btrim(p_clean)) < 2;
$$;

create or replace function derive_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s        text;
  prev     text;
  head     text;
  tail     text;
  m        text[];
  guard    int  := 0;
begin
  if p_name is null then
    return null;
  end if;

  s := decode_html_entities(p_name);
  s := regexp_replace(s, '\s*www\.\S*\s*$', '', 'i');

  loop
    guard := guard + 1;
    exit when guard > 10;
    prev := s;

    -- DBA: everything before and including it is the legal entity.
    s := regexp_replace(s, '^.*?\m(dba|d/b/a)\M[\s.,:-]*', '', 'i');

    if position('|' in s) > 0
       and not display_name_head_is_prefix(split_part(s, '|', 1))
       and not display_name_must_keep(substring(s from position('|' in s)))
    then
      s := split_part(s, '|', 1);
    end if;

    -- SEO-tail cut. Whitespace on BOTH sides, deliberately: "Coal-Fired" and
    -- "TEX- MEX" are inside words, and only a spaced separator is a separator.
    m := regexp_match(s, '^(.*?)\s+[-–—:]\s+(.*)$');
    if m is not null then
      head := btrim(m[1]);
      tail := btrim(m[2]);
      if length(tail) > length(head)
         and not display_name_head_is_prefix(head)
         and not display_name_must_keep(tail)
      then
        s := head;
      end if;
    end if;

    -- Locality strip. A trailing "<City> TX" is an address fragment however it
    -- is punctuated, and it is never part of the name. Separate from the cut
    -- above because it is a different job: this one knows what it is looking
    -- at rather than guessing from a separator and a length comparison.
    s := regexp_replace(s, '[,\-–—]?\s*[A-Z][a-zA-Z]*(\s+[A-Z][a-zA-Z]*)*,?\s+TX\.?$', '', 'i');

    s := btrim(regexp_replace(btrim(s), '[\s|,;:–—-]+$', ''));
    exit when s = prev;
  end loop;

  if s = '' or display_name_is_worse(s) then
    return decode_html_entities(p_name);
  end if;

  return s;
end $$;

commit;
