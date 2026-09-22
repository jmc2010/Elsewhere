-- Ingest additions (design spec §12): phone, update_time, display_name.
--
-- All three are Layer 1 -- Overture open data, ours, free, no Google call.
-- Each one unblocks a card state that currently cannot be populated:
--
--   phone        makes `Call ahead` do something. 88% coverage (35,155 of
--                39,765). It is also the cheap half of an expensive question:
--                "call to check if they're open" costs nothing, "show me the
--                opening hours" is a paid Google lookup (§7).
--
--   update_time  splits `Listed, fresh` from `Listed, stale` (§5) -- the brass
--                "Nobody's been here" card from the muted "Might have changed
--                hands" one. Same visible data, opposite meaning. Without it
--                the two collapse into one and the frontier card starts
--                recommending places that shut in 2024. Both known-closed
--                Valley View rows sit in the stale bucket.
--
--   display_name is why `Funky Munky Shaved Ice Valley View` still carries its
--                town in its name.
--
-- display_name is added but deliberately left NULL here. Deriving it is a
-- destructive-looking transformation over 39,765 names and the rule gets
-- eyeballed against the long tail before it runs -- see derive_display_name()
-- below, which is pure and can be selected over the catalog read-only.

begin;

-- ---------------------------------------------------------------------------
-- Staging
-- ---------------------------------------------------------------------------
alter table overture_staging add column phone       text;
alter table overture_staging add column update_time timestamptz;

comment on column overture_staging.update_time is
  'Overture''s own upstream timestamp for the record, not our ingest time.';

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
alter table places add column phone        text;
alter table places add column update_time  timestamptz;
alter table places add column display_name text;

comment on column places.phone is
  'From Overture. Layer 1, ours. NOT Google''s formatted phone number.';
comment on column places.update_time is
  'Overture upstream freshness. Drives the fresh/stale confidence split (spec 5).';
comment on column places.display_name is
  'Cleaned for display. `name` stays intact and is what search matches on.';

-- ---------------------------------------------------------------------------
-- derive_display_name
-- ---------------------------------------------------------------------------
-- Three cuts, and deliberately only three. The average catalog name is 17.3
-- characters; the tail is SEO, not names -- "Best burgers and chicken wings,
-- bar in Watauga, TX". The rule is kept conservative so real names survive it:
--
--   1. Cut at the first `|`.
--   2. Cut at ` - ` / ` – ` / ` — `, but ONLY when the tail is longer than the
--      head. That asymmetry is what protects genuine names: in
--      "Cousins Maine Lobster — Dallas Fort-Worth, TX" head and tail are both
--      21 characters, so it is left whole, which is what the canvas draws.
--      A name like "Joe's — the best tacos in all of North Texas, open late"
--      has a tail that dwarfs its head, and loses it.
--   3. Strip a trailing `www.*`.
--
-- NOT done here, though §2 also asks for them: fixing all-caps and bad casing
-- (`Llc`, `Jbm`, `THE 1845`), and stripping trailing localities and legal
-- suffixes. Those are separate rules with their own failure modes and they
-- deserve their own before/after pass rather than riding along with this one.
--
-- Immutable and side-effect free on purpose, so it can be selected over the
-- whole catalog to review the result before anything is written.
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

  -- 1. Everything from the first pipe onward is a keyword dump.
  if position('|' in s) > 0 then
    s := split_part(s, '|', 1);
  end if;

  -- 2. Spaced dash, first occurrence, only when the tail outweighs the head.
  m := regexp_match(s, '^(.*?)\s+[-–—]\s+(.*)$');
  if m is not null then
    head := btrim(m[1]);
    tail := btrim(m[2]);
    if length(tail) > length(head) then
      s := head;
    end if;
  end if;

  -- 3. A trailing URL is never part of a name.
  s := regexp_replace(s, '\s*www\.\S*\s*$', '', 'i');

  -- Tidy what the cuts left behind: whitespace, and a dangling separator.
  s := btrim(s);
  s := btrim(regexp_replace(s, '[\s|,;:–—-]+$', ''));

  -- Never return nothing. A name that is entirely SEO is still the only
  -- handle the place has, and a blank card is strictly worse than an ugly one.
  if s = '' then
    return p_name;
  end if;

  return s;
end $$;

grant execute on function derive_display_name to authenticated;

-- ---------------------------------------------------------------------------
-- promote_overture_staging -- carries the new fields, and finally consults
-- name_cuisine_map
-- ---------------------------------------------------------------------------
-- The name-map join is the follow-up 0018 left open in writing: promote did
-- not consult name_cuisine_map, so the next reingest would have silently
-- dropped 1,677 name-derived cuisines and taken coverage from 93.2% back to
-- 88.8%. This ingest *is* that reingest, so it is fixed here rather than
-- noted again.
--
-- Precedence is brand > category > name, and the order matters in both
-- directions. Brand beats category because 3,414 rows disagree and the brand
-- is the better evidence. Category beats name because a category came from
-- Overture's own taxonomy while a name-derived cuisine is a guess made by a
-- language model from a string.
create or replace function promote_overture_staging()
returns table (promoted bigint, skipped_closed bigint, cuisines_linked bigint)
language plpgsql
as $$
declare
  n_promoted bigint;
  n_closed   bigint;
  n_cuisine  bigint;
begin
  select count(*) into n_closed
  from overture_staging
  where operating_status = 'permanently_closed';

  with src as (
    select s.*,
           coalesce(bm.cuisine_id, cm.cuisine_id, nm.cuisine_id) as cuisine_id,
           coalesce(bm.delivery_only, false)                     as delivery_only
    from overture_staging s
    left join brand_cuisine_map    bm on bm.name_norm       = norm_place_name(s.name)
    left join category_cuisine_map cm on cm.source_category = s.primary_category
    left join name_cuisine_map     nm on nm.name_norm       = norm_place_name(s.name)
    where s.operating_status is distinct from 'permanently_closed'
      and s.name is not null
      and s.lon  is not null
      and s.lat  is not null
  ),
  upserted as (
    insert into places (
      source, source_id, name, display_name, location, address_line, locality,
      region, postcode, country, website, phone, update_time,
      source_categories, delivery_only)
    select
      'overture',
      src.source_id,
      src.name,
      derive_display_name(src.name),
      st_setsrid(st_makepoint(src.lon, src.lat), 4326)::geography,
      src.address_line, src.locality, src.region, src.postcode, src.country,
      src.website,
      src.phone,
      src.update_time,
      -- primary first, then any alternates, blanks removed
      array_remove(
        array[src.primary_category]
          || string_to_array(coalesce(src.alternate_categories, ''), ','),
        '')::text[],
      src.delivery_only
    from src
    on conflict (source, source_id) do update set
      name              = excluded.name,
      display_name      = excluded.display_name,
      location          = excluded.location,
      address_line      = excluded.address_line,
      locality          = excluded.locality,
      region            = excluded.region,
      postcode          = excluded.postcode,
      country           = excluded.country,
      website           = excluded.website,
      phone             = excluded.phone,
      update_time       = excluded.update_time,
      source_categories = excluded.source_categories,
      delivery_only     = excluded.delivery_only,
      updated_at        = now()
    returning id
  )
  select count(*) into n_promoted from upserted;

  -- Rebuild cuisine links for everything this promote touched. A re-promote
  -- after the maps change should move a place's cuisine, not accumulate both
  -- the old and new one. place_cuisines currently holds nothing but
  -- map-derived rows; if manual tagging is ever added it will need a
  -- provenance column so this delete can be scoped to map-derived rows only.
  delete from place_cuisines pc
  using places p, overture_staging s
  where pc.place_id = p.id
    and p.source    = 'overture'
    and p.source_id = s.source_id;

  with linked as (
    insert into place_cuisines (place_id, cuisine_id)
    select p.id, coalesce(bm.cuisine_id, cm.cuisine_id)
    from places p
    join overture_staging s
      on s.source_id = p.source_id and p.source = 'overture'
    left join brand_cuisine_map    bm on bm.name_norm       = norm_place_name(s.name)
    left join category_cuisine_map cm on cm.source_category = s.primary_category
    where coalesce(bm.cuisine_id, cm.cuisine_id) is not null
    on conflict (place_id, cuisine_id) do nothing
    returning place_id
  )
  select count(*) into n_cuisine from linked;

  -- Addresses change when the catalog does, and places-proxy relies on this
  -- to decide whether a same-building Google match is safe to accept. Leaving
  -- it to whoever remembers to run it by hand is how it goes stale silently.
  perform refresh_place_quality_flags();

  return query select n_promoted, n_closed, n_cuisine;
end $$;

commit;
