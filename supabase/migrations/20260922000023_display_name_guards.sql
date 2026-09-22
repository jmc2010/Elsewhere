-- derive_display_name: two guards against keeping the wrong half.
--
-- Measured against the live catalog after 0022. The rule was right about 317
-- names and wrong about 8, in two distinct ways -- both of which share a cause:
-- the rule assumes the text before the separator is the name, and sometimes it
-- is a prefix instead.
--
--   1. A numeric head is a franchise store number, not a name.
--        8517 - Nekter Juice Bar (Heritage Trace Plaza)  ->  8517
--        8034 - Nekter Juice Bar                         ->  8034
--      Five Nekter locations, plus `1817 - Butcher's Bavarian Backyard BBQ`
--      and `11|17`. The store number is the only part a customer never uses.
--
--   2. A US state code before a pipe is a listing prefix.
--        TX | Teriyaki Madness Dallas  ->  TX
--      This string is named in spec §2 as a case the cleaning should fix, and
--      the unguarded rule made it strictly worse.
--
-- Both guards are deliberately narrow. `KFC - Kentucky Fried Chicken` -> `KFC`
-- is correct and must keep working, so the test cannot be "the head is short"
-- -- it has to be "the head is not the kind of thing a name is made of".
--
-- Everything else is unchanged from 0022.

begin;

-- True when the text before a separator is a prefix rather than a name, and
-- cutting would therefore discard the name and keep the label.
create or replace function display_name_head_is_prefix(p_head text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    -- A store or unit number.
    btrim(p_head) ~ '^[0-9#]+$'
    -- A US state or territory code used as a listing prefix. Two letters only;
    -- a three-letter initialism like KFC or IFL is a brand, not a state.
    or upper(btrim(p_head)) = any (array[
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN',
      'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
      'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
      'TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','GU','VI','AS','MP'
    ]);
$$;

create or replace function derive_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s    text := p_name;
  head text;
  tail text;
  m    text[];
begin
  if s is null then
    return null;
  end if;

  -- 1. Everything from the first pipe onward is a keyword dump -- unless what
  --    precedes it is a prefix, in which case the name is on the other side.
  if position('|' in s) > 0
     and not display_name_head_is_prefix(split_part(s, '|', 1)) then
    s := split_part(s, '|', 1);
  end if;

  -- 2. Spaced dash, first occurrence, only when the tail outweighs the head
  --    and the head is actually a name.
  m := regexp_match(s, '^(.*?)\s+[-–—]\s+(.*)$');
  if m is not null then
    head := btrim(m[1]);
    tail := btrim(m[2]);
    if length(tail) > length(head) and not display_name_head_is_prefix(head) then
      s := head;
    end if;
  end if;

  -- 3. A trailing URL is never part of a name.
  s := regexp_replace(s, '\s*www\.\S*\s*$', '', 'i');

  -- Tidy what the cuts left behind: whitespace, and a dangling separator.
  s := btrim(s);
  s := btrim(regexp_replace(s, '[\s|,;:–—-]+$', ''));

  -- Never return nothing. A name that is entirely SEO is still the only handle
  -- the place has, and a blank card is strictly worse than an ugly one.
  if s = '' then
    return p_name;
  end if;

  return s;
end $$;

grant execute on function display_name_head_is_prefix to authenticated;
grant execute on function derive_display_name to authenticated;

commit;
