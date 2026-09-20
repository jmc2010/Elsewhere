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
   country, website, primary_category, alternate_categories,
   category_hierarchy, basic_category, operating_status, confidence)
SELECT source_id, name, lon, lat, address_line, locality, region, postcode,
       country, website, primary_category, alternate_categories,
       category_hierarchy, basic_category, operating_status, confidence
FROM extracted;

SELECT count(*) AS rows_now_in_staging FROM pg.overture_staging;
SQL

echo
echo "Done. Next: review the distinct categories, then run the promote step."
