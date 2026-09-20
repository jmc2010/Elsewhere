-- Promote: overture_staging -> places.
--
-- A function rather than a one-shot migration, because the spec calls for a
-- monthly reingest diffed against the existing table (§4, Layer 1). Run it
-- after every extract:
--
--     select * from promote_overture_staging();
--
-- What must survive a re-promote, and does, because the upsert never touches
-- these columns:
--
--   google_place_id              -- paid for once per place across all users;
--   google_place_id_resolved_at     re-resolving would be a real cost
--   google_resolution_failed
--   permanently_closed           -- set from Google's businessStatus at
--                                   hydration, not from Overture
--
-- That last one is worth being careful about. `places.permanently_closed` is
-- OUR derived boolean, set at hydration time from Google. Overture's
-- `operating_status` is a different field from a different source; it is used
-- here only to decide what to promote, and is never written to places.

alter table places add column delivery_only boolean not null default false;

comment on column places.delivery_only is
  'Ghost-kitchen brand: a delivery-only label operating out of another
   kitchen. Never offer as a Surprise Me pick -- that affordance means "go
   here now". See brand_cuisine_map.delivery_only.';

create index places_delivery_only_idx on places (delivery_only)
  where delivery_only = false;

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

  -- Cuisine resolution is coalesce(brand, category) -- BRAND WINS. See the
  -- trailing comment in 0008 for the measurement behind that; getting it
  -- backwards is silent and files McDonald's under generic fast food.
  with src as (
    select s.*,
           coalesce(bm.cuisine_id, cm.cuisine_id) as cuisine_id,
           coalesce(bm.delivery_only, false)      as delivery_only
    from overture_staging s
    left join brand_cuisine_map    bm on bm.name_norm       = norm_place_name(s.name)
    left join category_cuisine_map cm on cm.source_category = s.primary_category
    where s.operating_status is distinct from 'permanently_closed'
      and s.name is not null
      and s.lon  is not null
      and s.lat  is not null
  ),
  upserted as (
    insert into places (
      source, source_id, name, location, address_line, locality, region,
      postcode, country, website, source_categories, delivery_only)
    select
      'overture',
      src.source_id,
      src.name,
      st_setsrid(st_makepoint(src.lon, src.lat), 4326)::geography,
      src.address_line, src.locality, src.region, src.postcode, src.country,
      src.website,
      -- primary first, then any alternates, blanks removed
      array_remove(
        array[src.primary_category]
          || string_to_array(coalesce(src.alternate_categories, ''), ','),
        '')::text[],
      src.delivery_only
    from src
    on conflict (source, source_id) do update set
      name              = excluded.name,
      location          = excluded.location,
      address_line      = excluded.address_line,
      locality          = excluded.locality,
      region            = excluded.region,
      postcode          = excluded.postcode,
      country           = excluded.country,
      website           = excluded.website,
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

  return query select n_promoted, n_closed, n_cuisine;
end $$;

comment on function promote_overture_staging() is
  'Upsert overture_staging into places, excluding Overture-flagged
   permanently-closed rows, and rebuild place_cuisines. Safe to re-run;
   preserves google_place_id and places.permanently_closed.';
