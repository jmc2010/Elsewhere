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
- **0003 staging** — applied. It had never been applied before 2026-09-20;
  the standing "confirm it is applied" note is now resolved.
- **0004 staging taxonomy** — applied. Adds `category_hierarchy`,
  `basic_category`, `operating_status` to `overture_staging`.
- **`extract_overture.sh` — corrected, and run against Supabase.** North Texas
  (`-97.9 32.3 -96.1 33.75`) landed **39,852 rows** in `overture_staging`:
  32,770 `open`, 6,534 null, 548 `permanently_closed`. Matched the local
  dry-run exactly. Idempotent — re-running rebuilds the box.
- **0005 brand cuisine map** — written, **not yet applied**. 201 chain names →
  cuisine, plus a `norm_place_name()` function. Closes **34.1%** of the
  no-cuisine gap (4,454 of 13,052 rows). Every row is `reviewed = false`.

### Connecting to Supabase from this machine

Use the **Session pooler** string (`…pooler.supabase.com:5432`), not the
direct connection. `db.oygsbuailwpjgkqbxllp.supabase.co` resolves **AAAA
only**, and the developer's network has no IPv6 egress, so the direct string
fails with no useful error. The transaction pooler (6543) also will not work
— DuckDB's bulk insert needs session-mode transactions. The paid IPv4 add-on
is not needed; the shared pooler is already IPv4.

## Next

**1. Audit the brand map (0005), then apply it.** Every row is
`reviewed = false` on purpose — these are proposed mappings, not reviewed
ones, and the spec requires a human pass before the mapping is applied.
Sort by `confidence` and argue with anything under 0.8:

```sql
select b.name_norm, c.slug, b.confidence, b.note
from brand_cuisine_map b join cuisines c on c.id = b.cuisine_id
where b.confidence < 0.8 order by b.confidence;
```

A cross-check against Overture's own categories agrees almost everywhere
(`deli-sandwiches` ↔ `sandwich_shop` 794 rows, `burgers` ↔
`burger_restaurant` 325, `wings` ↔ `chicken_wings_restaurant` 68), which is
reassuring but not a substitute for reading the low-confidence ones.

**2. Decide on the taxonomy gaps.** Two leaves are missing and it shows:

- **Chicken.** Overture has a `chicken_restaurant` category with **872 rows**
  in this metro; our taxonomy has no chicken leaf, so Chick-fil-A, KFC,
  Popeyes, Church's, Golden Chick, Raising Cane's and Chicken Express are all
  parked on `fast-food` at confidence 0.50. That is the single largest
  mapping compromise in 0005 and the easiest to fix — add `chicken` under
  `american`.
- **Hot dogs.** Smaller, but Wienerschnitzel has nowhere sensible to go.

**3. Build `category_cuisine_map` for the 182 Overture categories.** Most are
already cuisine-shaped (`mexican_restaurant`, `texmex_restaurant`,
`italian_restaurant`) and map by reviewed rename. This is the two-thirds of
the catalog the brand map does not touch.

**4. The Claude name pass** over the ~8,100 unique independent names — the
remaining 62% of the no-cuisine gap. Names carry the signal (*Angels NY
Pizza*, *Elizandro's Mexican Food*, *Ponder Coffee Company*), so this is the
offline pass the spec calls for, just keyed on names rather than categories.

**5. Promote** `overture_staging` → `places`, excluding
`operating_status = 'permanently_closed'`.

### Things that will not work, already checked

- **`alternate_categories` is a dead end.** 110 of 13,052 cuisine-less rows
  have any. Do not build around it.
- **`confidence` does not separate good rows from bad.** Suspect rows score
  *higher* than normal ones (0.922 vs 0.886 mean, identical 0.95 median). It
  is useless as a junk filter.
- **Never substring-match brand names.** `brand_cuisine_map` is exact-match on
  a normalized name for the same reason `%bar%` matched `barber`.

### Data-quality items for before anyone sees the app

None of these block the mapping work, but they all make a demo look broken:

- **465 rows (1.2%) carry legal entity names**, e.g.
  `Lsf5 Cactus, Llc.d/b/a Lone Star Steakhouse & Saloon`, `Rowdy's Diner,
  Llc`. A mix of real restaurants filed under their LLC name — which display
  terribly on a shortlist card — and genuine non-restaurants like
  `Xalka Healthcare Solutions, Llc`.
- **Delivery-only virtual brands** are in the catalog as places: `Barstool
  Bites`, `The Burger Den`, `Tenderfix by Noah Schnapp`, `Pardon My
  Cheesesteak`, `The Meltdown`. You cannot go to them. Whether they belong in
  a "where should we go" app is a product decision, flagged in 0005's notes.
- **Vending machines as places** — `Coca-Cola Freestyle` (5) and `Coca-Cola`
  (3) are mapped as food-and-drink POIs. Left unmapped deliberately.
- **~90 places have non-Latin names** (Japanese, Thai, Korean) that normalize
  to an empty string. 0005 rejects `''` as a key so they cannot collide; they
  fall through to the category map instead.

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
