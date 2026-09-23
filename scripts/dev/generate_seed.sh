#!/usr/bin/env bash
#
# Regenerate supabase/seed.sql -- the local development catalog.
#
# A SUBSET, not the whole catalog. 39,304 rows is slow to load, slow to reset,
# and tells you nothing the subset does not: what matters for development is
# hitting every DENSITY regime, because that is what the screens branch on.
#
#   Valley View      ~23 rows    rural. Exercises the exhausted state, the
#                                town-list shape of the location picker, and
#                                a shortlist shorter than the cap.
#   Gainesville     ~164 rows    mid. The "open it up to" target, and the
#                                case where the pool is complete but large.
#   Downtown Dallas ~1282 rows   dense. Pool truncation, the miles shape of
#                                the picker, and the seeded-tiebreak rotation.
#
# What it does NOT seed: cuisines, tags, and the brand/category/name maps all
# arrive from migrations. Seeding them here would mean two sources of truth
# for the same rows, and the migration would win on a reset anyway.
#
# Usage:
#   PGSERVICEFILE=... ./scripts/dev/generate_seed.sh      # regenerate from cloud
#   supabase db reset                                     # apply it locally
#
# Run it when the cloud catalog changes in a way development should see -- a
# reingest, a new column. Not routinely: the point of a seed is that it is
# stable enough to write tests against.

set -euo pipefail

cd "$(dirname "$0")/../.."
OUT="supabase/seed.sql"

: "${PGSERVICEFILE:?set PGSERVICEFILE (or edit this script to pass a connection string)}"
SERVICE="${PGSERVICE:-elsewhere}"

echo "Generating $OUT from service=$SERVICE ..."

{
  cat <<'HEADER'
-- Local development catalog. GENERATED -- do not edit by hand.
-- Regenerate with scripts/dev/generate_seed.sh
--
-- Three density slices, because density is what the screens branch on:
-- Valley View (rural), Gainesville (mid), downtown Dallas (dense).
--
-- Applied automatically by `supabase db reset` after the migrations run, so
-- everything it depends on -- cuisines, tags, the cuisine maps -- already
-- exists by the time this loads.

begin;

HEADER

  psql "service=$SERVICE" -At -c "
    with slices(lat, lon, m) as (values
      (33.4890::double precision, -97.1611::double precision, 8047::double precision),
      (33.6259, -97.1334, 8047),
      (32.7801, -96.8000, 2500)),
    picked as (
      select distinct p.*
      from places p join slices s
        on st_dwithin(p.location, st_setsrid(st_makepoint(s.lon, s.lat), 4326)::geography, s.m)
    )
    select
      'insert into places (id, source, source_id, name, display_name, location, address_line, locality, region, postcode, country, website, phone, update_time, source_categories, delivery_only, locality_suspect, non_destination_suspect, opening_soon, elsewhere_confirmations, permanently_closed, probably_closed) values ('
      || quote_literal(id) || ',' || quote_literal(source) || ',' || quote_literal(source_id) || ','
      || quote_literal(name) || ',' || coalesce(quote_literal(display_name),'null') || ','
      || quote_literal(st_astext(location)) || '::geography,'
      || coalesce(quote_literal(address_line),'null') || ',' || coalesce(quote_literal(locality),'null') || ','
      || coalesce(quote_literal(region),'null') || ',' || coalesce(quote_literal(postcode),'null') || ','
      || coalesce(quote_literal(country),'null') || ',' || coalesce(quote_literal(website),'null') || ','
      || coalesce(quote_literal(phone),'null') || ','
      || coalesce(quote_literal(update_time::text) || '::timestamptz','null') || ','
      || quote_literal(source_categories::text) || '::text[],'
      || delivery_only || ',' || locality_suspect || ',' || non_destination_suspect || ','
      || opening_soon || ',' || elsewhere_confirmations || ','
      || permanently_closed || ',' || probably_closed || ');'
    from picked order by id;"

  echo
  echo "-- Cuisine links for the seeded places only."
  psql "service=$SERVICE" -At -c "
    with slices(lat, lon, m) as (values
      (33.4890::double precision, -97.1611::double precision, 8047::double precision),
      (33.6259, -97.1334, 8047),
      (32.7801, -96.8000, 2500)),
    picked as (
      select distinct p.id
      from places p join slices s
        on st_dwithin(p.location, st_setsrid(st_makepoint(s.lon, s.lat), 4326)::geography, s.m)
    )
    select 'insert into place_cuisines (place_id, cuisine_id) values ('
      || quote_literal(pc.place_id) || ',' || pc.cuisine_id || ') on conflict do nothing;'
    from place_cuisines pc join picked k on k.id = pc.place_id
    order by pc.place_id, pc.cuisine_id;"

  cat <<'FOOTER'

-- Quality flags are derived, not copied: recomputing them locally proves the
-- function still works rather than trusting a snapshot of its output.
select refresh_place_quality_flags();
select refresh_non_destination_flags();

commit;
FOOTER
} > "$OUT"

ROWS=$(grep -c "^insert into places" "$OUT" || true)
LINKS=$(grep -c "^insert into place_cuisines" "$OUT" || true)
echo "Wrote $OUT: $ROWS places, $LINKS cuisine links, $(wc -l < "$OUT") lines."
