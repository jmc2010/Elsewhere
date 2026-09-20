# Overture ingest

Populates the Layer 1 catalog from [Overture Maps](https://overturemaps.org/)
open data. Runs in three steps so a bad extract can be inspected and re-run
without touching the live catalog.

## One-time setup

```bash
brew install duckdb          # macOS; see duckdb.org/docs/installation otherwise
```

Get your Postgres connection string from the Supabase dashboard:
**Project Settings → Database → Connection string → URI**. It contains your
database password.

```bash
export ELSEWHERE_PG_URL='postgresql://postgres:PASSWORD@db.xxxx.supabase.co:5432/postgres'
```

Keep this out of the repo and out of chat logs. It is a superuser credential
for your database.

## Step 1 — Extract

```bash
./extract_overture.sh <xmin> <ymin> <xmax> <ymax>
```

Bounding box in decimal degrees, west south east north. DuckDB streams the
Overture GeoParquet from S3, filters to food-and-drink leaf categories inside
the box, and writes into `overture_staging`.

Re-running the same box is safe: matching `source_id`s are deleted first.

Pin a different Overture release with `OVERTURE_RELEASE=2026-08-19.0`.

## Step 2 — Review the categories

Before promoting anything, see what came back:

```sql
select primary_category, count(*)
from overture_staging
group by 1
order by 2 desc;
```

The extract filter is deliberately over-inclusive. Over-capturing is cheap —
an unmapped category gets flagged and fixed. A missed place is invisible and
never comes back.

## Step 3 — Map categories to cuisines, then promote

Covered separately, because the mapping is reviewed before it is applied.
This is the step the spec calls the hardest data problem in the project.
