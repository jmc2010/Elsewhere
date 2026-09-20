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
Overture GeoParquet from S3, selects the `food_and_drink` branch of the
category taxonomy inside the box, and writes into `overture_staging`.

North Texas — Valley View down through the metroplex to Waxahachie, Weatherford
across to Greenville:

```bash
./extract_overture.sh -97.9 32.3 -96.1 33.75
```

That box yields ~39,900 places across ~182 distinct categories, and takes
about seven seconds to extract. Bounding-box predicates are pushed down to the
parquet row-group statistics, so a large box costs far less than its area
suggests.

Re-running the same box is safe, and rebuilds it: **every staging row inside
the box is deleted first**, not just the ones the new extract matched. That is
deliberate — deleting only matching `source_id`s would strand places that
Overture dropped between releases, and they would never be cleaned up.

Pin a different Overture release with `OVERTURE_RELEASE=2026-08-19.0`.

### On the category filter

Overture carries two category systems. The legacy `categories` struct is flat;
`taxonomy` is hierarchical, and `taxonomy.hierarchy` is the full root-to-leaf
path. We select on `hierarchy[1] = 'food_and_drink'`.

An earlier version of this script matched substrings against the legacy flat
field (`LIKE '%restaurant%'`, `'%bar%'`, `'%pub%'` …). Do not go back to that.
Measured against a single Denton bounding box, it matched `barber` on `%bar%`,
`public_school` / `public_health_clinic` / `public_plaza` on `%pub%`, and
`courier_and_delivery_services` on `%deli%` — and it silently dropped donut
shops, bagel shops, gelato, cupcakes, beer gardens, an empanada restaurant and
a distillery, because none of those leaf names contain any of the 21
substrings. Donut shops alone are ~1,000 places across North Texas.

A few rows carry no taxonomy but do have `basic_category`; a verified IN-list
rescues those.

## Step 2 — Review the categories

Before promoting anything, see what came back:

```sql
select primary_category, count(*)
from overture_staging
group by 1
order by 2 desc;
```

The hierarchy is stored too, `' > '`-delimited, which is usually the faster way
in:

```sql
select split_part(category_hierarchy, ' > ', 2) as branch,
       count(*), count(distinct primary_category) as leaves
from overture_staging
group by 1 order by 2 desc;
```

For North Texas that splits into `restaurant`, `casual_eatery`,
`alcoholic_beverage_venue` and `non_alcoholic_beverage_venue`.

## Step 3 — Map categories to cuisines, then promote

Covered separately, because the mapping is reviewed before it is applied.
The spec calls this the hardest data problem in the project, and it is still
the step to be careful about — but the hierarchical taxonomy makes it markedly
easier than the spec assumed. Many leaves are already cuisine-shaped
(`mexican_restaurant`, `texmex_restaurant`, `italian_restaurant`,
`barbecue_restaurant`), so the mapping is mostly a reviewed rename plus
judgment calls on the genuinely ambiguous ones (`restaurant`,
`fast_food_restaurant`, `casual_eatery` carry no cuisine at all and need a
different signal).

Promote excludes `operating_status = 'permanently_closed'`. Those rows are
kept in staging deliberately, so the extract stays inspectable — but they must
never reach the catalog, because every one of them is a wasted Google
hydration call against a restaurant that no longer exists. North Texas has
~550.
