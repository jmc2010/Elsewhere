-- Data-quality flags, both found by hand-auditing the first real shortlist.
--
-- The audit is the step spec §11 asks for, and it earned its keep: two
-- distinct Overture problems that no amount of schema review would have
-- surfaced, both visible within the first 25 results.

-- === 1. Shared addresses ====================================================
--
-- places-proxy grants a name-free match when Google returns a result within
-- 30m, reasoning that at a few metres there is no other building, so a name
-- disagreement is just two sources naming one shop differently -- "Bayer's
-- Kolonialwaren" and "Bayers Bakery" in Muenster.
--
-- That fails whenever the address holds more than one business, and in North
-- Texas it does for **22,957 of 39,304 places (58%)**.
--
-- Found by audit: Rider's Smokehouse in Valley View closed years ago and the
-- premises have since been two other restaurants. Overture still lists
-- Rider's as `open`, and lists a successor, Middlebrooks Bar & Grill, 8m away
-- and also `open`. Resolving Rider's could easily return Middlebrooks, and
-- the 30m rule would have accepted it -- binding a defunct restaurant to a
-- live one's place_id permanently, so every hydration forever would show
-- Middlebrooks' rating and hours under Rider's name.
--
-- The same shape appears wholesale in ghost kitchens: Packin' Bowls, Bantu
-- Kitchens, Mandarin To Go and The Butcher's Son all sit on one point.
--
-- So the name-free pass is granted only where nothing else is there.

alter table places add column colocated_count int not null default 0;

comment on column places.colocated_count is
  'Other catalog places within 30m. When > 0 the address is shared, so
   places-proxy must NOT accept a Google match on proximity alone -- it could
   be a neighbour or a successor rather than a renaming.';

create index places_colocated_idx on places (colocated_count)
  where colocated_count > 0;

-- === 2. Addresses that do not belong to their coordinates ===================
--
-- Found by audit: "Santiago's Restaurant" renders as Colorado City, TX 79512
-- while sitting 1.1 miles from Valley View. Colorado City is 261 miles west.
-- The coordinates are right -- the distance was computed from them and is
-- correct -- but Overture attached the wrong address block.
--
-- About 1.65% of places have a postcode that disagrees with their nearest
-- neighbours'. This flag uses a tighter test: the locality is suspect when
-- **no other place in the same ~2.5km cell shares it**, in a cell holding at
-- least five places. That catches Santiago's while leaving genuine
-- town-boundary cases alone, and flags 0.74% rather than the 8.9% a
-- simple modal-locality comparison would.
--
-- The coordinate is trustworthy and the address is not, so the UI should hide
-- a suspect locality rather than print a town 261 miles away.

alter table places add column locality_suspect boolean not null default false;

comment on column places.locality_suspect is
  'Overture''s locality is not corroborated by any neighbouring place, so it
   probably does not belong to these coordinates. Hide it in the UI. The
   coordinates themselves are still trusted -- distance is computed from them.';

-- === Recompute ==============================================================
--
-- Both are derived from our own open data; no Google content is involved.
-- Called from promote_overture_staging() rather than left to whoever
-- remembers, because a stale flag is worse than no flag: places-proxy trusts
-- colocated_count when deciding whether a resolution is safe.

create function refresh_place_quality_flags()
returns void
language plpgsql
as $$
begin
  update places p
     set colocated_count = (
           select count(*) from places q
            where q.id <> p.id
              and st_dwithin(q.location, p.location, 30)
         );

  with g as (
    select id, lower(trim(locality)) as loc,
           floor(st_y(location::geometry) * 40) as gy,
           floor(st_x(location::geometry) * 40) as gx
    from places where locality is not null
  ),
  per_loc  as (select gx, gy, loc, count(*) as c from g group by gx, gy, loc),
  per_cell as (select gx, gy, sum(c) as n from per_loc group by gx, gy),
  flagged as (
    select g.id
    from g
    join per_loc  pl using (gx, gy, loc)
    join per_cell pc using (gx, gy)
    where pl.c = 1 and pc.n >= 5
  )
  update places p
     set locality_suspect = (p.id in (select id from flagged));
end $$;

select refresh_place_quality_flags();

-- === promote maintains them =================================================
--
-- Lifted verbatim from 0009 with one line added, rather than reworded, so the
-- two cannot quietly diverge.

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

  -- Addresses change when the catalog does, and places-proxy relies on this
  -- to decide whether a same-building Google match is safe to accept. Leaving
  -- it to whoever remembers to run it by hand is how it goes stale silently.
  perform refresh_place_quality_flags();

  return query select n_promoted, n_closed, n_cuisine;
end $$;
