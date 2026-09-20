# Status

Living handoff between working sessions. Update it when something lands.
Read `CLAUDE.md` for the rules and `docs/spec.md` for the reasoning — this
file only covers **where we are right now**.

**Phase 0 — Foundation.** Exit criteria: catalog queryable by radius +
cuisine in under 200ms.

## Environment

| | |
|---|---|
| Supabase project | `https://oygsbuailwpjgkqbxllp.supabase.co` |
| PostGIS | 3.3 (`USE_GEOS=1 USE_PROJ=1 USE_STATS=1`) |
| Overture release | `2026-08-19.0` |
| First metro | **North Texas** — `-97.9 32.3 -96.1 33.75` |

Connection string lives in the developer's shell as `ELSEWHERE_PG_URL`.
It is a superuser credential — never commit it, never paste it into a chat.

The box runs Valley View down through the metroplex to Waxahachie, and
Weatherford across to Greenville. Chosen because the developer can eyeball
bad cuisine mappings in it. Size is not a cost problem: the audit surface is
the ~182 distinct categories, which barely grows with area, and bbox
predicates push down to parquet row-group stats so the whole extract takes
about nine seconds.

## Done

- Repo, `CLAUDE.md`, `docs/spec.md`
- CI guard `scripts/check-no-google-persistence.py`, verified to fail on a
  violation and pass clean
- **0001 init** — applied. 16 tables, all with RLS on. (`spatial_ref_sys`
  reports RLS off; it is PostGIS's own extension-owned table, contains only
  published EPSG definitions, and cannot be altered. Expect it as a permanent
  Supabase Security Advisor warning.)
- **0002 cuisines** — applied. 15 groups, 93 leaves.
- **0003 staging** — written; confirm it is applied before the extract.
- **0004 staging taxonomy** — written, not yet applied. Adds
  `category_hierarchy`, `basic_category`, `operating_status` to
  `overture_staging`. Apply it together with 0003.
- **`extract_overture.sh` — corrected and verified end-to-end.** Run against
  live Overture S3 and a throwaway local Postgres 16: 39,852 rows, 8.8s,
  idempotent on re-run. It has **not** been run against Supabase — see Next.

## Next

**Run the extract against Supabase.**

```bash
export ELSEWHERE_PG_URL='...'          # from the Supabase dashboard
scripts/ingest/extract_overture.sh -97.9 32.3 -96.1 33.75
```

Apply 0003 and 0004 first. Expect ~39,850 rows and roughly:

| | |
|---|---|
| `open` | 32,770 |
| `NULL` | 6,534 |
| `permanently_closed` | 548 |

The only untested surface left is the network path to Supabase — schema,
query, and the DuckDB→Postgres write are all verified.

**Then: build the category → cuisine mapping.** 182 distinct categories over
four branches (`restaurant` 120 leaves, `casual_eatery` 27,
`alcoholic_beverage_venue` 26, `non_alcoholic_beverage_venue` 8). The spec
calls this the hardest data problem in the project and it is still the step to
be careful about, but it is easier than the spec assumed — see below. Hand-
audit it for this metro.

## What changed in Overture, and why it matters

Overture now ships a **hierarchical** taxonomy (`taxonomy.primary`,
`taxonomy.hierarchy`) alongside the legacy flat `categories` struct the
original script was written against. Two consequences:

1. **The extract filter was wrong in both directions and is now exact.** The
   old `LIKE '%bar%'`-style filter matched `barber` (39 rows in one Denton
   box), `public_school`, `public_health_clinic` and
   `courier_and_delivery_services` — while *silently dropping* donut shops,
   bagel shops, gelato, cupcakes, beer gardens and a distillery, none of whose
   leaf names contain any of the 21 substrings. That is ~1,000 donut shops
   across North Texas, including Daily Donuts in Valley View. Per the README's
   own rule — over-capturing is cheap, a missed place is invisible — the false
   negatives were the serious half. The filter is now
   `hierarchy[1] = 'food_and_drink'`, with a verified `basic_category`
   fallback for the 87 rows that carry no taxonomy.

2. **The cuisine mapping got easier.** The spec assumed a flat category set
   needing a full offline Claude pass. Many leaves are already cuisine-shaped
   (`mexican_restaurant`, `texmex_restaurant`, `italian_restaurant`,
   `barbecue_restaurant`) and the hierarchy groups them. The real work is now
   the genuinely ambiguous leaves — `restaurant` (4,602 rows),
   `fast_food_restaurant` (3,249), `casual_eatery` — which carry no cuisine at
   all and need a different signal. **Re-scope the mapping task before
   starting it**; the spec's framing predates this schema.

Also new: `operating_status`. Overture flags permanently-closed places itself,
which partially pre-empts spec risk #2. They are kept in staging (inspectable)
and must be excluded at promote — every one that reaches the catalog is a
wasted Google hydration call against a restaurant that no longer exists. This
is Overture open data, **not** Google's `businessStatus`; storing it is legal
and the two are different fields.

## Open decisions

- **Apple account type.** Current developer account appears to be Individual,
  which publishes a personal legal name as the App Store seller. Either ship
  Individual and use App Transfer later, or form the entity and convert. Not
  urgent; does not block Phase 0.
- **App Store name.** "Elsewhere" alone is almost certainly taken (Elsewhere
  Dream Journal, ELSEWHERE.TO LTD). Plan of record is
  **"Elsewhere: Where to Eat"** with subtitle "Your dining concierge".
- **Trademark clearance.** ELSEWHERE.TO LTD is a real Class 9 conflict to put
  in front of an attorney before anything is published.

## Not started

Expo app scaffold · Google Cloud project + Places key · `places-proxy` edge
function · everything in spec Phase 1 and beyond.
