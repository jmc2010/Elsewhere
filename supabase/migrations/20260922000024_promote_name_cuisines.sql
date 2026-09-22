-- promote_overture_staging: actually consult name_cuisine_map.
--
-- 0022 added the name map to the `src` CTE, which was the wrong place: that
-- CTE's cuisine_id was dead code that nothing read. place_cuisines is rebuilt
-- further down from an independent re-derivation over brand and category only,
-- so the name map never contributed and a promote took cuisine coverage from
-- 93.2% to 88.8% exactly as 0018 predicted. Measured, not assumed.
--
-- Precedence is unchanged and still brand > category > name: the brand is
-- better evidence than the category (3,414 rows disagree), and the category
-- came from Overture's own taxonomy while a name-derived cuisine is a guess a
-- language model made from a string.

begin;

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
    -- Only delivery_only is needed here. Cuisine is resolved further down,
    -- where place_cuisines is rebuilt -- NOT here. An earlier version of this
    -- function computed a cuisine_id in this CTE that nothing ever read, which
    -- is a good way to "fix" cuisine resolution and change nothing.
    select s.*,
           coalesce(bm.delivery_only, false) as delivery_only
    from overture_staging s
    left join brand_cuisine_map bm on bm.name_norm = norm_place_name(s.name)
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
    select p.id, coalesce(bm.cuisine_id, cm.cuisine_id, nm.cuisine_id)
    from places p
    join overture_staging s
      on s.source_id = p.source_id and p.source = 'overture'
    left join brand_cuisine_map    bm on bm.name_norm       = norm_place_name(s.name)
    left join category_cuisine_map cm on cm.source_category = s.primary_category
    left join name_cuisine_map     nm on nm.name_norm       = norm_place_name(s.name)
    where coalesce(bm.cuisine_id, cm.cuisine_id, nm.cuisine_id) is not null
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
