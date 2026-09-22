-- Two name-pipeline fixes: HTML entities, and DBA.
--
-- ENTITIES. 33 catalog names carry raw HTML entities from upstream --
-- "Y &amp A Holdings, Llc", "Muses Ktv &amp Cafe". Rendering "&amp;" on a
-- card is a visible defect with no judgement attached, so this decodes at
-- ingest and repairs the existing rows. Note the entities arrive both with
-- and without the trailing semicolon, so both forms are handled.
--
-- Applied to `name` itself, not just to display_name: `name` is what search
-- matches on, and nobody types "&amp".
--
-- DBA. 114 names are a corporate entity followed by the actual trading name:
-- "Boonburg Inc Dba Chapps Cafe", "Kangann Inc Dba Nori Sushi". The useful
-- name is everything AFTER the DBA, which makes this the inverse of every
-- other cut in the rule -- keep the tail, drop the head. Without it these
-- read as holding companies and most of them were being flagged as
-- non-destinations.
--
-- The existing worse-than-original guard still applies afterwards, so a DBA
-- strip that leaves a bare locality or a store number is discarded.

begin;

create or replace function decode_html_entities(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_text is null then null else
    -- &amp last would double-decode "&amp;lt;" into "<". Decoding it first is
    -- the conventional order and is why it sits at the end of the chain here:
    -- each replace feeds the next, so &amp must resolve after the others.
    replace(replace(replace(replace(replace(replace(replace(replace(
      p_text,
      '&quot;', '"'), '&quot', '"'),
      '&apos;', ''''), '&apos', ''''),
      '&lt;', '<'), '&gt;', '>'),
      '&amp;', '&'), '&amp', '&')
  end;
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

    -- DBA: everything before and including it is the legal entity, not the
    -- business. Non-greedy, so the FIRST DBA wins.
    s := regexp_replace(s, '^.*?\m(dba|d/b/a)\M[\s.,:-]*', '', 'i');

    if position('|' in s) > 0
       and not display_name_head_is_prefix(split_part(s, '|', 1))
       and not display_name_must_keep(substring(s from position('|' in s)))
    then
      s := split_part(s, '|', 1);
    end if;

    m := regexp_match(s, '^(.*?)(?:\s+[-–—:]\s*|\s*[-–—:]\s+)(.*)$');
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

    s := btrim(regexp_replace(btrim(s), '[\s|,;:–—-]+$', ''));
    exit when s = prev;
  end loop;

  if s = '' or display_name_is_worse(s) then
    -- Fall back to the decoded original, never the raw one: an entity is a
    -- defect whatever else happens.
    return decode_html_entities(p_name);
  end if;

  return s;
end $$;

grant execute on function decode_html_entities to authenticated;
grant execute on function derive_display_name  to authenticated;

-- Repair the rows that already exist. Promote will do this for new ones.
update places
   set name = decode_html_entities(name)
 where name <> decode_html_entities(name);

update places
   set display_name = derive_display_name(name)
 where display_name is distinct from derive_display_name(name);

commit;
