-- The both-sides rule is for DASHES only.
--
-- 0044 required whitespace on both sides of the separator, to stop
-- "Estrada's TEX- MEX" being split inside a word. Applied to colons as well
-- it was an over-correction: a colon never appears mid-word, so there is no
-- "Coal:Fired" for it to break. Requiring a leading space reverted every
-- correct colon cut -- "BEE: Best Enchiladas Ever", "PBR Texas: A Coors
-- Banquet Bar", "Method: Caffeination & Fare" -- all of which are ordinary
-- English punctuation introducing a tagline.
--
--   dash  -> whitespace BOTH sides (a separator somebody typed deliberately)
--   colon -> whitespace AFTER only (how a colon is always written)

begin;

create or replace function derive_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s     text;
  prev  text;
  head  text;
  tail  text;
  m     text[];
  guard int := 0;
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

    s := regexp_replace(s, '^.*?\m(dba|d/b/a)\M[\s.,:-]*', '', 'i');

    if position('|' in s) > 0
       and not display_name_head_is_prefix(split_part(s, '|', 1))
       and not display_name_must_keep(substring(s from position('|' in s)))
    then
      s := split_part(s, '|', 1);
    end if;

    -- Dash: both sides. Colon: trailing space only.
    m := regexp_match(s, '^(.*?)(?:\s+[-–—]\s+|\s*:\s+)(.*)$');
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

    -- Trailing "<City> TX" is an address fragment however it is punctuated.
    s := regexp_replace(s, '[,\-–—]?\s*[A-Z][a-zA-Z]*(\s+[A-Z][a-zA-Z]*)*,?\s+TX\.?$', '', 'i');

    s := btrim(regexp_replace(btrim(s), '[\s|,;:–—-]+$', ''));
    exit when s = prev;
  end loop;

  if s = '' or display_name_is_worse(s) then
    return decode_html_entities(p_name);
  end if;

  return s;
end $$;

-- Re-derive every row so the stored column matches the rule.
update places
   set display_name = derive_display_name(name)
 where display_name is distinct from derive_display_name(name);

commit;
