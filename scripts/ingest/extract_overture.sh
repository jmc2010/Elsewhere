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

-- Overture's category taxonomy is hierarchical, but each row carries only its
-- leaf category string. Rather than fetch the taxonomy, match broadly on the
-- leaf: over-capturing is harmless here because anything that fails to map to
-- a cuisine is flagged for review in the next step, whereas a missed place is
-- invisible and never comes back.
CREATE OR REPLACE TEMP TABLE extracted AS
SELECT
  id                                        AS source_id,
  names.primary                             AS name,
  ST_X(ST_GeomFromWKB(geometry))            AS lon,
  ST_Y(ST_GeomFromWKB(geometry))            AS lat,
  addresses[1].freeform                     AS address_line,
  addresses[1].locality                     AS locality,
  addresses[1].region                       AS region,
  addresses[1].postcode                     AS postcode,
  addresses[1].country                      AS country,
  websites[1]                               AS website,
  categories.primary                        AS primary_category,
  array_to_string(categories.alternate,',') AS alternate_categories,
  confidence
FROM read_parquet(
       's3://overturemaps-us-west-2/release/${RELEASE}/theme=places/type=place/*',
       filename = true, hive_partitioning = 1)
WHERE bbox.xmin BETWEEN ${XMIN} AND ${XMAX}
  AND bbox.ymin BETWEEN ${YMIN} AND ${YMAX}
  AND names.primary IS NOT NULL
  AND categories.primary IS NOT NULL
  AND (
       categories.primary LIKE '%restaurant%'
    OR categories.primary LIKE '%food%'
    OR categories.primary LIKE '%bar%'
    OR categories.primary LIKE '%cafe%'
    OR categories.primary LIKE '%coffee%'
    OR categories.primary LIKE '%bakery%'
    OR categories.primary LIKE '%pizza%'
    OR categories.primary LIKE '%diner%'
    OR categories.primary LIKE '%steakhouse%'
    OR categories.primary LIKE '%brewery%'
    OR categories.primary LIKE '%brewpub%'
    OR categories.primary LIKE '%pub%'
    OR categories.primary LIKE '%deli%'
    OR categories.primary LIKE '%dessert%'
    OR categories.primary LIKE '%ice_cream%'
    OR categories.primary LIKE '%juice%'
    OR categories.primary LIKE '%tea%'
    OR categories.primary LIKE '%sandwich%'
    OR categories.primary LIKE '%buffet%'
    OR categories.primary LIKE '%barbecue%'
    OR categories.primary LIKE '%bbq%'
  );

SELECT count(*) AS extracted_rows FROM extracted;

DELETE FROM pg.overture_staging
WHERE source_id IN (SELECT source_id FROM extracted);

INSERT INTO pg.overture_staging
  (source_id, name, lon, lat, address_line, locality, region, postcode,
   country, website, primary_category, alternate_categories, confidence)
SELECT source_id, name, lon, lat, address_line, locality, region, postcode,
       country, website, primary_category, alternate_categories, confidence
FROM extracted;

SELECT count(*) AS rows_now_in_staging FROM pg.overture_staging;
SQL

echo
echo "Done. Next: review the distinct categories, then run the promote step."
