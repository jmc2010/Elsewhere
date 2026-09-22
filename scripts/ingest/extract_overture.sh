#!/usr/bin/env bash
#
# Pull food-and-drink places from Overture Maps into the Supabase staging
# table, for one bounding box.
#
# Usage:
#   export ELSEWHERE_PG_URL='postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres'
#   ./extract_overture.sh <xmin> <ymin> <xmax> <ymax>
#
# Bounding box is in decimal degrees: west south east north.
#
# Requires DuckDB (brew install duckdb).

set -euo pipefail

RELEASE="${OVERTURE_RELEASE:-2026-08-19.0}"

if [ $# -ne 4 ]; then
  echo "usage: $0 <xmin> <ymin> <xmax> <ymax>" >&2
  exit 1
fi

XMIN=$1; YMIN=$2; XMAX=$3; YMAX=$4

: "${ELSEWHERE_PG_URL:?set ELSEWHERE_PG_URL to your Supabase connection string}"

echo "Overture release : $RELEASE"
echo "Bounding box     : $XMIN $YMIN -> $XMAX $YMAX"
echo

duckdb <<SQL
INSTALL spatial;  LOAD spatial;
INSTALL httpfs;   LOAD httpfs;
INSTALL postgres; LOAD postgres;
SET s3_region='us-west-2';
SET TimeZone='UTC';

ATTACH '${ELSEWHERE_PG_URL}' AS pg (TYPE POSTGRES);

-- Overture's places schema carries two category systems. The legacy flat
-- 'categories' struct is what an older version of this script matched against
-- with LIKE '%restaurant%' etc.; 'taxonomy' is the hierarchical one, and it is
-- what we key on. taxonomy.hierarchy is the full root-to-leaf path, so
-- selecting the food-and-drink branch is an exact test rather than a
-- substring guess.
--
-- The substring approach was wrong in both directions, measured against one
-- Denton bbox: it matched 'barber' on %bar%, 'public_school' and
-- 'public_health_clinic' on %pub%, and 'courier_and_delivery_services' on
-- %deli%, while silently dropping donut shops, bagel shops, gelato, beer
-- gardens and a distillery, because none of those leaf names contain any of
-- the 21 substrings. Across this metro that is ~1,000 donut shops alone.
--
-- A small number of rows have no taxonomy but do carry basic_category. The
-- IN-list rescues those; every value in it was verified to appear outside the
-- food_and_drink branch only on exactly those orphan rows.
CREATE OR REPLACE TEMP TABLE extracted AS
SELECT
  id                                          AS source_id,
  names.primary                               AS name,
  ST_X(geometry)                              AS lon,
  ST_Y(geometry)                              AS lat,
  addresses[1].freeform                       AS address_line,
  addresses[1].locality                       AS locality,
  addresses[1].region                         AS region,
  addresses[1].postcode                       AS postcode,
  addresses[1].country                        AS country,
  websites[1]                                 AS website,
  -- Take the first phone. Only 11 rows in the whole metro carry more than
  -- one, so a second column would be 99.97% null for the sake of eleven
  -- places. 88% coverage overall (35,155 of 39,765), and free -- it is what
  -- makes "Call ahead" work on the frontier card without a Google lookup.
  phones[1]                                   AS phone,
  -- Overture's OWN timestamp for the record, not our ingest time. This is the
  -- only per-place age signal that exists, and it is what splits
  -- "Listed, fresh" from "Listed, stale" (spec 5). It is present in the
  -- current snapshot -- it needs no release diff.
  --
  -- It lives inside sources, which is a LIST of structs, typically three per
  -- record, one per contributing dataset, each with its own timestamp.
  --
  -- We take the FIRST, and not the most recent. Taking the maximum was tried
  -- and measured: it puts 39,852 of 39,852 records in the current cycle,
  -- because every record carries a bulk-stamped Overture source at the release
  -- date. That does not mean the catalog is fresh -- it means the maximum is
  -- reading the release, not the place. It would empty the stale bucket
  -- entirely and put Rider's Smokehouse, which has been shut for years, on the
  -- brass frontier card as somewhere nobody has been yet.
  --
  -- sources[1] is the record-level contributor and it varies per place:
  -- Tia's Tex-Mex 2026-08-10, Rider's Smokehouse 2025-10-16, the shut Dairy
  -- Queen 2025-07-13. That variation is the entire signal.
  sources[1].update_time::timestamptz         AS update_time,
  taxonomy.primary                            AS primary_category,
  array_to_string(taxonomy.alternates, ',')   AS alternate_categories,
  array_to_string(taxonomy.hierarchy, ' > ')  AS category_hierarchy,
  basic_category,
  operating_status,
  confidence
FROM read_parquet(
       's3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*',
       filename = true, hive_partitioning = 1)
WHERE bbox.xmin BETWEEN ${XMIN} AND ${XMAX}
  AND bbox.ymin BETWEEN ${YMIN} AND ${YMAX}
  AND names.primary IS NOT NULL
  AND (
    taxonomy.hierarchy[1] = 'food_and_drink'
    OR basic_category IN (
         'alcoholic_beverage_venue', 'bar', 'brewery', 'cafe', 'casual_eatery',
         'coffee_shop', 'distillery', 'fast_food_restaurant', 'food_and_drink',
         'food_truck_stand', 'lounge', 'non_alcoholic_beverage_venue',
         'restaurant', 'smoothie_juice_bar')
  );

SELECT count(*) AS extracted_rows FROM extracted;

-- Permanently-closed places are kept in staging rather than filtered here:
-- staging is meant to be inspectable, and the promote step is where they are
-- excluded. Reported so a sudden jump is visible.
SELECT operating_status, count(*) AS rows
FROM extracted GROUP BY 1 ORDER BY 2 DESC;

-- Clear the box, not the matching ids. Deleting by source_id would leave
-- behind places that Overture dropped between releases -- they would never
-- match a future extract and would sit in the catalog forever as zombies.
-- Rebuilding the whole box is also a single pushed-down predicate rather than
-- a 40k-element IN list.
DELETE FROM pg.overture_staging
WHERE lon BETWEEN ${XMIN} AND ${XMAX}
  AND lat BETWEEN ${YMIN} AND ${YMAX};

INSERT INTO pg.overture_staging
  (source_id, name, lon, lat, address_line, locality, region, postcode,
   country, website, phone, update_time, primary_category,
   alternate_categories, category_hierarchy, basic_category,
   operating_status, confidence)
SELECT source_id, name, lon, lat, address_line, locality, region, postcode,
       country, website, phone, update_time, primary_category,
       alternate_categories, category_hierarchy, basic_category,
       operating_status, confidence
FROM extracted;

SELECT count(*) AS rows_now_in_staging FROM pg.overture_staging;

-- Coverage of the two new fields, reported rather than assumed. Phone was
-- measured at 88%; a sharp drop means the upstream field moved.
SELECT
  count(*)                                           AS rows,
  count(phone)                                       AS with_phone,
  round(100.0 * count(phone) / nullif(count(*),0), 1) AS pct_phone,
  count(update_time)                                 AS with_update_time
FROM extracted;

-- Freshness distribution. The "Listed, stale" bucket -- untouched upstream
-- since 2024 -- is the one that gets the muted "Might have changed hands"
-- treatment instead of the brass frontier card.
SELECT
  CASE
    WHEN update_time IS NULL           THEN 'unknown'
    WHEN update_time >= DATE '2026-01-01' THEN 'this cycle (2026)'
    WHEN update_time >= DATE '2025-01-01' THEN 'during 2025'
    ELSE 'before 2025 (stale)'
  END AS freshness,
  count(*) AS rows
FROM extracted GROUP BY 1 ORDER BY 2 DESC;
SQL

echo
echo "Done. Next: review the distinct categories, then run the promote step."
