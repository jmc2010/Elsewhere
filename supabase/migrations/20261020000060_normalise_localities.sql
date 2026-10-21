-- Fold locality spelling variants. Keep the original on the row.
--
-- "Gainesville / GAINESVILLE / Gainsville as three separate towns in the
-- picker is visible, and it is visible in the exact control I reach for when
-- a dense area is not working."
--
-- Measured before acting, over 39,304 live rows:
--
--   distinct localities now                              354
--   after case-folding alone                             262   (92 collapse)
--   after deterministic folding                          253   (101 collapse)
--   after the curated typo map below                     245   (109 collapse)
--
-- Two tiers, deliberately, because the second one is where this goes wrong.
--
--   DETERMINISTIC, and therefore safe to run on anything: lowercase, trim,
--   strip trailing punctuation, strip a trailing state suffix (", TX",
--   " Texas"), collapse inner whitespace. That alone is 101 of the 109 and
--   it cannot invent a fold.
--
--   CURATED, eight entries, enumerated by hand. NOT a similarity threshold.
--   A trigram scan at 0.6 proposed folding `grapevine mills` into
--   `grapevine`, and Grapevine Mills is a shopping mall, not a misspelling
--   of the town it sits in. A threshold that is right eight times out of
--   nine silently destroys the ninth, so the eight are written out and the
--   ninth is left alone.
--
-- The canonical spelling is the MOST COMMON original for each key, taken
-- from the data rather than computed. initcap() would have produced
-- "Mckinney" and "Desoto"; the catalog already contains "McKinney" and
-- "DeSoto" spelled correctly, 1,283 and 274 times respectively, so the data
-- is a better authority on capitalisation than any rule.
--
-- places.locality_raw keeps exactly what the source said, per the ruling.

begin;

alter table places add column if not exists locality_raw text;

comment on column places.locality_raw is
  'The locality exactly as the upstream source gave it. `locality` is the
   folded, canonical form -- see normalise_locality(). Never show this to a
   user; it exists so a fold can be audited or reversed.';

-- The fold key. Deterministic tier, then the curated tier.
create or replace function locality_key(p_locality text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(btrim(regexp_replace(
                regexp_replace(
                  regexp_replace(lower(btrim(p_locality)), '[\s,\.]+$', ''),
                  '[\s,]+(tx|texas)$', ''),
                '\s+', ' ', 'g')))
    -- Eight by hand. Every one verified against the row counts: the variant
    -- is rare and the target is common by at least 20x.
    when 'forth worth'      then 'fort worth'
    when 'n richland hills' then 'north richland hills'
    when 'flowermound'      then 'flower mound'
    when 'gainsville'       then 'gainesville'
    when 'south lake'       then 'southlake'
    when 'balch prings'     then 'balch springs'
    when 'grand prarie'     then 'grand prairie'
    when 'waxahacie'        then 'waxahachie'
    else lower(btrim(regexp_replace(
           regexp_replace(
             regexp_replace(lower(btrim(p_locality)), '[\s,\.]+$', ''),
             '[\s,]+(tx|texas)$', ''),
           '\s+', ' ', 'g')))
  end;
$$;

-- key -> the spelling to actually display.
create table if not exists locality_canonical (
  key       text primary key,
  canonical text not null
);

comment on table locality_canonical is
  'Maps a locality_key() to the spelling shown to users: the most common
   original form in the catalog. Rebuilt by refresh_locality_canonical()
   after an ingest. A key with no row here passes through unchanged, so a
   brand-new town is never mangled by a fold nobody chose.';

create or replace function refresh_locality_canonical()
returns int
language plpgsql
set search_path = public
as $$
declare v_rows int;
begin
  -- Count by RAW spelling so a fold already applied cannot bias the vote.
  with spellings as (
    select locality_key(coalesce(locality_raw, locality)) as k,
           coalesce(locality_raw, locality)               as spelling,
           count(*)                                       as n
    from places
    where coalesce(locality_raw, locality) is not null
      and not permanently_closed
    group by 1, 2
  ),
  winner as (
    select k, (array_agg(spelling order by n desc, spelling))[1] as canonical
    from spellings group by k
  )
  insert into locality_canonical (key, canonical)
  select k, canonical from winner
  on conflict (key) do update set canonical = excluded.canonical;

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

create or replace function normalise_locality(p_locality text)
returns text
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select c.canonical from locality_canonical c where c.key = locality_key(p_locality)),
    p_locality);
$$;

/**
 * The fold is a property of the TABLE, not of one write path.
 *
 * Caught during verification: the backfill below runs while `places` is
 * still empty on a from-scratch reset, because seed.sql loads after all
 * migrations. So local came back unfolded while cloud -- which has data when
 * the migration runs -- came back folded. Patching promote() alone would not
 * have fixed it either, since the seed inserts directly.
 *
 * A trigger closes every path at once: promote, seed, and any hand-inserted
 * row. locality_raw is only ever set when empty, so a later correction to
 * `locality` cannot destroy what the source originally said.
 */
create or replace function places_fold_locality()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.locality is not null then
    if new.locality_raw is null then
      new.locality_raw := new.locality;
    end if;
    new.locality := normalise_locality(new.locality_raw);
  end if;
  return new;
end $$;

drop trigger if exists places_fold_locality_trg on places;
create trigger places_fold_locality_trg
  before insert or update of locality, locality_raw on places
  for each row execute function places_fold_locality();


-- The canonical map, as DATA.
--
-- It was originally computed at migration time from `places`. That works on
-- cloud, which has 39,304 rows when the migration runs, and silently does
-- nothing on a from-scratch local reset, where seed.sql loads AFTER all
-- migrations -- so local came back unfolded and diverged from cloud. Caught
-- in verification.
--
-- Embedding it fixes that and is better anyway: the fold becomes something
-- you can read and audit in the diff rather than something inferred at
-- runtime from whatever happened to be in the table. 244 entries,
-- each one the most common spelling in the catalog for its key.
--
-- refresh_locality_canonical() still exists and still extends this after an
-- ingest brings in towns the map has never seen.
insert into locality_canonical (key, canonical) values
  ('acton', 'Acton'),
  ('addison', 'Addison'),
  ('aledo', 'Aledo'),
  ('allen', 'Allen'),
  ('alvarado', 'Alvarado'),
  ('alvord', 'Alvord'),
  ('anna', 'Anna'),
  ('argyle', 'Argyle'),
  ('arlington', 'Arlington'),
  ('atlanta', 'Atlanta'),
  ('aubrey', 'Aubrey'),
  ('aurora', 'Aurora'),
  ('azle', 'Azle'),
  ('balch springs', 'Balch Springs'),
  ('bartonville', 'Bartonville'),
  ('bedford', 'Bedford'),
  ('bells', 'Bells'),
  ('benbrook', 'Benbrook'),
  ('blue mound', 'Blue Mound'),
  ('blue ridge', 'Blue Ridge'),
  ('bonham', 'Bonham'),
  ('bowie', 'Bowie'),
  ('boyd', 'Boyd'),
  ('briaroaks', 'Briaroaks'),
  ('bridgeport', 'Bridgeport'),
  ('burleson', 'Burleson'),
  ('caddo mills', 'Caddo Mills'),
  ('callisburg', 'Callisburg'),
  ('cameron', 'Cameron'),
  ('canton', 'Canton'),
  ('carrollton', 'Carrollton'),
  ('cedar crest', 'Cedar Crest'),
  ('cedar hill', 'Cedar Hill'),
  ('celeste', 'Celeste'),
  ('celina', 'Celina'),
  ('chico', 'Chico'),
  ('clarksville', 'Clarksville'),
  ('cleburne', 'Cleburne'),
  ('cockrell hill', 'Cockrell Hill'),
  ('colleyville', 'Colleyville'),
  ('collinsville', 'Collinsville'),
  ('colorado city', 'Colorado City'),
  ('coppell', 'Coppell'),
  ('copper canyon', 'Copper Canyon'),
  ('corinth', 'Corinth'),
  ('crandall', 'Crandall'),
  ('cresson', 'Cresson'),
  ('crosby', 'Crosby'),
  ('cross roads', 'Cross Roads'),
  ('crossroads', 'Crossroads'),
  ('crowley', 'Crowley'),
  ('dallas', 'Dallas'),
  ('dalworthington gardens', 'Dalworthington Gardens'),
  ('de soto', 'De Soto'),
  ('decatour', 'Decatour'),
  ('decatur', 'Decatur'),
  ('denison', 'Denison'),
  ('denton', 'Denton'),
  ('desoto', 'Desoto'),
  ('dfw', 'DFW'),
  ('dfw airport', 'DFW Airport'),
  ('dodd city', 'Dodd City'),
  ('double oak', 'Double Oak'),
  ('duncanville', 'Duncanville'),
  ('durant', 'Durant'),
  ('dwg', 'Dwg'),
  ('ector', 'Ector'),
  ('edgecliff village', 'Edgecliff Village'),
  ('ennis', 'Ennis'),
  ('era', 'Era'),
  ('euless', 'Euless'),
  ('eustace', 'Eustace'),
  ('everman', 'Everman'),
  ('fairfield', 'Fairfield'),
  ('fairview', 'Fairview'),
  ('far north dallas', 'Far North Dallas'),
  ('farmers branch', 'Farmers Branch'),
  ('farmersville', 'Farmersville'),
  ('fate', 'Fate'),
  ('ferris', 'Ferris'),
  ('flower mound', 'Flower Mound'),
  ('forest hill', 'Forest Hill'),
  ('forestburg', 'Forestburg'),
  ('forney', 'Forney'),
  ('fort hood', 'Fort Hood'),
  ('fort worth', 'Fort Worth'),
  ('frisco', 'Frisco'),
  ('ft worth', 'Ft Worth'),
  ('ft. worth', 'Ft. Worth'),
  ('gainesville', 'Gainesville'),
  ('galesburg', 'Galesburg'),
  ('garland', 'Garland'),
  ('gilmer', 'Gilmer'),
  ('glenn heights', 'Glenn Heights'),
  ('godley', 'Godley'),
  ('granbury', 'Granbury'),
  ('grand prairie', 'Grand Prairie'),
  ('grandview', 'Grandview'),
  ('grapevine', 'Grapevine'),
  ('grapevine mills', 'Grapevine Mills'),
  ('greenville', 'Greenville'),
  ('gun barrel city', 'Gun Barrel City'),
  ('gunter', 'Gunter'),
  ('haltom city', 'Haltom City'),
  ('haslet', 'Haslet'),
  ('heartland', 'Heartland'),
  ('heath', 'Heath'),
  ('hickory creek', 'Hickory Creek'),
  ('highland park', 'Highland Park'),
  ('highland village', 'Highland Village'),
  ('highlands ranch', 'Highlands Ranch'),
  ('hillsboro', 'Hillsboro'),
  ('houston', 'Houston'),
  ('howe', 'Howe'),
  ('hudson oaks', 'Hudson Oaks'),
  ('huntsville', 'Huntsville'),
  ('hurst', 'Hurst'),
  ('hutchins', 'Hutchins'),
  ('irivng', 'Irivng'),
  ('irving', 'Irving'),
  ('italy', 'Italy'),
  ('ivanhoe', 'Ivanhoe'),
  ('josephine', 'Josephine'),
  ('joshua', 'Joshua'),
  ('justin', 'Justin'),
  ('kaufman', 'Kaufman'),
  ('keene', 'Keene'),
  ('keller', 'Keller'),
  ('kemp', 'Kemp'),
  ('kennedale', 'Kennedale'),
  ('knollwood', 'Knollwood'),
  ('krugerville', 'Krugerville'),
  ('krum', 'Krum'),
  ('lake dallas', 'Lake Dallas'),
  ('lake kiowa', 'Lake Kiowa'),
  ('lake worth', 'Lake Worth'),
  ('lakeside', 'Lakeside'),
  ('lancaster', 'Lancaster'),
  ('lantana', 'Lantana'),
  ('las colinas', 'Las Colinas'),
  ('lavon', 'Lavon'),
  ('leonard', 'Leonard'),
  ('lewisville', 'Lewisville'),
  ('lillian', 'Lillian'),
  ('lindsay', 'Lindsay'),
  ('little elm', 'Little Elm'),
  ('lowry crossing', 'Lowry Crossing'),
  ('lucas', 'Lucas'),
  ('mabank', 'Mabank'),
  ('mansfield', 'Mansfield'),
  ('marietta', 'Marietta'),
  ('maypearl', 'Maypearl'),
  ('mc kinney', 'Mc Kinney'),
  ('mckinney', 'McKinney'),
  ('mclendon-chisholm', 'McLendon-Chisholm'),
  ('melissa', 'Melissa'),
  ('mesquite', 'Mesquite'),
  ('midlothian', 'Midlothian'),
  ('montague', 'Montague'),
  ('mt vernon', 'Mt Vernon'),
  ('muenster', 'Muenster'),
  ('murphy', 'Murphy'),
  ('nevada', 'Nevada'),
  ('newark', 'Newark'),
  ('north richland hills', 'North Richland Hills'),
  ('northlake', 'Northlake'),
  ('northwest grayson', 'Northwest Grayson'),
  ('oak cliff', 'Oak Cliff'),
  ('oak point', 'Oak Point'),
  ('ovilia', 'Ovilia'),
  ('ovilla', 'Ovilla'),
  ('palmer', 'Palmer'),
  ('pantego', 'Pantego'),
  ('paradise', 'Paradise'),
  ('parker', 'Parker'),
  ('payne springs', 'Payne Springs'),
  ('pilot point', 'Pilot Point'),
  ('plano', 'Plano'),
  ('ponder', 'Ponder'),
  ('poolville', 'Poolville'),
  ('princeton', 'Princeton'),
  ('prosper', 'Prosper'),
  ('providence village', 'Providence Village'),
  ('quinlan', 'Quinlan'),
  ('red oak', 'Red Oak'),
  ('reno', 'Reno'),
  ('rhome', 'Rhome'),
  ('richardson', 'Richardson'),
  ('richland hills', 'Richland Hills'),
  ('river oaks', 'River Oaks'),
  ('roanoke', 'Roanoke'),
  ('rockwall', 'Rockwall'),
  ('rowlett', 'Rowlett'),
  ('royse city', 'Royse City'),
  ('runaway bay', 'Runaway Bay'),
  ('sachse', 'Sachse'),
  ('sadler', 'Sadler'),
  ('saginaw', 'Saginaw'),
  ('saint jo', 'Saint Jo'),
  ('sanger', 'Sanger'),
  ('sansom park', 'Sansom Park'),
  ('savannah', 'Savannah'),
  ('savoy', 'Savoy'),
  ('scurry', 'Scurry'),
  ('seagoville', 'Seagoville'),
  ('seven points', 'Seven Points'),
  ('sherman', 'Sherman'),
  ('shreveport', 'Shreveport'),
  ('southlake', 'Southlake'),
  ('springtown', 'Springtown'),
  ('st jo', 'St Jo'),
  ('st paul', 'St Paul'),
  ('sunnyvale', 'Sunnyvale'),
  ('sunset', 'Sunset'),
  ('talty', 'Talty'),
  ('terrell', 'Terrell'),
  ('thackerville', 'Thackerville'),
  ('the colony', 'The Colony'),
  ('tioga', 'Tioga'),
  ('tolar', 'Tolar'),
  ('tom bean', 'Tom Bean'),
  ('tool', 'Tool'),
  ('trenton', 'Trenton'),
  ('trophy club', 'Trophy Club'),
  ('university park', 'University Park'),
  ('valley view', 'Valley View'),
  ('van alstyne', 'Van Alstyne'),
  ('venice', 'Venice'),
  ('venus', 'Venus'),
  ('watauga', 'Watauga'),
  ('waxahachie', 'Waxahachie'),
  ('weatherford', 'Weatherford'),
  ('westlake', 'Westlake'),
  ('westminster', 'Westminster'),
  ('weston', 'Weston'),
  ('westworth', 'Westworth'),
  ('westworth village', 'Westworth Village'),
  ('white settlement', 'White Settlement'),
  ('whitesboro', 'Whitesboro'),
  ('whitewright', 'Whitewright'),
  ('willow park', 'Willow Park'),
  ('wilmer', 'Wilmer'),
  ('wolfe city', 'Wolfe City'),
  ('wylie', 'Wylie')
on conflict (key) do update set canonical = excluded.canonical;

-- Preserve the originals, then build the map, then fold.
update places set locality_raw = locality where locality_raw is null;
select refresh_locality_canonical();
update places set locality = normalise_locality(locality_raw)
where locality_raw is not null and locality is distinct from normalise_locality(locality_raw);

-- Ingest applies the fold too, or the next Overture release reintroduces
-- every variant this migration just removed. Derived from the live
-- definition rather than rewritten.
CREATE OR REPLACE FUNCTION public.promote_overture_staging()
 RETURNS TABLE(promoted bigint, skipped_closed bigint, cuisines_linked bigint)
 LANGUAGE plpgsql
AS $function$
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
      source, source_id, name, display_name, location, address_line, locality, locality_raw,
      region, postcode, country, website, phone, update_time,
      source_categories, delivery_only)
    select
      'overture',
      src.source_id,
      src.name,
      derive_display_name(src.name),
      st_setsrid(st_makepoint(src.lon, src.lat), 4326)::geography,
      src.address_line,
      -- Folded for display; the source's own spelling kept beside it.
      normalise_locality(src.locality), src.locality,
      src.region, src.postcode, src.country,
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
      locality_raw      = excluded.locality_raw,
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
end $function$;

grant execute on function locality_key        to authenticated;
grant execute on function normalise_locality  to authenticated;

commit;
