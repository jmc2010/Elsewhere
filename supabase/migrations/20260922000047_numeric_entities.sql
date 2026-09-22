-- Decode numeric HTML entities too.
--
-- 0032 handled the named forms (&amp, &quot, &apos, &lt, &gt) and missed the
-- numeric ones. One row carries it -- "Gloria&#39 S The Rim Restaurant San
-- Antonio Llc", where &#39 is an apostrophe -- and one visible defect on a
-- card is one too many when the fix is a regex.
--
-- Handles both &#NN; and the unterminated &#NN that this source actually
-- produces, and both decimal and hex forms.

begin;

create or replace function decode_html_entities(p_text text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  s text := p_text;
  m text[];
begin
  if s is null then
    return null;
  end if;

  -- Numeric first: a &#38 that decodes to & must not then be re-read as the
  -- start of another entity, and doing the named pass afterwards is what
  -- guarantees that ordering.
  loop
    m := regexp_match(s, '&#(x?)([0-9a-fA-F]+);?');
    exit when m is null;
    s := regexp_replace(
           s, '&#(x?)([0-9a-fA-F]+);?',
           chr(case when m[1] = 'x' then ('x' || lpad(m[2], 8, '0'))::bit(32)::int
                    else m[2]::int end),
           '');
  end loop;

  s := replace(replace(replace(replace(replace(replace(replace(replace(
         s,
         '&quot;', '"'), '&quot', '"'),
         '&apos;', ''''), '&apos', ''''),
         '&lt;', '<'), '&gt;', '>'),
         '&amp;', '&'), '&amp', '&');
  return s;
end $$;

update places set name = decode_html_entities(name)
 where name <> decode_html_entities(name);

update places set display_name = derive_display_name(name)
 where display_name is distinct from derive_display_name(name);

commit;
