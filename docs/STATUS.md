# Status

Living handoff between working sessions. Update it when something lands.
Read `CLAUDE.md` for the rules and `docs/spec.md` for the reasoning — this
file only covers **where we are right now**.

**Phase 0 — Foundation. COMPLETE, 2026-09-20.** Exit criteria was catalog
queryable by radius + cuisine in under 200ms; measured at **54ms** on Micro.
See [`docs/measurements.md`](measurements.md). Next phase is 1 — Shortlist.

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
- **0005 brand cuisine map** — applied. 201 chain names → cuisine, plus a
  `norm_place_name()` function. Closes **34.1%** of the no-cuisine gap
  (4,454 of 13,052 rows). Every row is `reviewed = false`.
- **0006 chicken cuisine** — applied. Adds a `chicken` leaf under `american`
  and moves 16 brands onto it (974 places). Decided 2026-09-20: one leaf, not
  a fried/rotisserie split, because Overture gives only `chicken_restaurant`
  and there is no signal to split on.
- **0007 delivery-only brands** — applied. Flags the 9 ghost-kitchen brands
  (145 places) rather than dropping them. Decided 2026-09-20: keep and flag.
  They are real answers to "what can we order tonight" and wrong answers to
  "where should we go", so the flag keeps both futures open where dropping at
  ingest would not.
- **0008 category cuisine map** — applied. All 182 Overture categories
  mapped, with an assertion that exactly 16 resolve to no cuisine. **Combined
  cuisine coverage: 88.6%** (35,310 of 39,852).
- **0009 promote** — applied, and run. `promote_overture_staging()` is a
  re-runnable function, not a one-shot, because the spec calls for monthly
  reingest. **39,304 places and 34,910 cuisine links in `places`**; 548
  Overture-flagged closed rows skipped. Preserves `google_place_id` and
  `places.permanently_closed` across re-runs.
- **Phase 0 exit criteria met.** Italian within 20 miles of Valley View
  returns 17 places in 54ms. Numbers and query shapes in
  [`docs/measurements.md`](measurements.md).
- **0010 catalog_search** — written and tested locally, **not yet applied to
  Supabase**. Layer 1 + Layer 3 narrowing, spatial-first, no Google calls.

### Local test harness

PostGIS now runs locally (PG17 + PostGIS 3.6; note `brew install postgis`
builds against 17/18, not 16). The whole chain 0001→0010 rebuilds on a clean
database and reproduces the Supabase promote numbers exactly — 39,304 / 548 /
34,910. Worth keeping: it caught a spec violation in `catalog_search` that
would have shipped.

### Connecting to Supabase from this machine

Use the **Session pooler** string (`…pooler.supabase.com:5432`), not the
direct connection. `db.oygsbuailwpjgkqbxllp.supabase.co` resolves **AAAA
only**, and the developer's network has no IPv6 egress, so the direct string
fails with no useful error. The transaction pooler (6543) also will not work
— DuckDB's bulk insert needs session-mode transactions. The paid IPv4 add-on
is not needed; the shared pooler is already IPv4.

## Next

**Phase 1 — Shortlist.** Exit criteria: a real "where to eat" query returns 10
good cards under budget.

The catalog is live and queryable, so the next pieces are the ones that turn
it into a product:

1. **Apply and verify `catalog_search` (0010) on Supabase.** Written and
   tested locally; the Micro-instance timings still need confirming, since
   local numbers say nothing about your instance.

   **Still open: transport.** The spec lists `catalog-search` as an edge
   function, but it touches no secrets, so calling the Postgres function
   directly as an RPC from `supabase-js` would save a network hop inside a
   90-second decision window. The function is the right primitive either way.
   Decide before the Expo work, not after.
2. **Google Cloud project + Places key.** Server-side only, never in the
   bundle.
3. **`places-proxy` edge function.** The only path to Google. Quota, batching,
   and the response envelope with no database writer. Instrument
   calls-per-session from the first call, not after.
4. **Expo app scaffold**, filter sheet, shortlist UI, place detail.

**Run `analyze` after every promote.** It took planning time from 52ms to
1.3ms and costs nothing.

**The Claude name pass** is still open and still an enhancement rather than a
blocker: ~4,200 places with no cuisine, almost all categorised `restaurant`,
where neither the category nor a chain name says anything. Names carry the
signal. It moves coverage from 88.6% toward the mid-90s.

### Audit queue, when there is time

Nothing here blocks promote. `reviewed = false` on every row of both maps.

- `brand_cuisine_map`: 32 rows below 0.8. Dairy Queen vs DQ Grill & Chill is
  the one worth a second opinion — the map disagrees with itself on purpose.
- `category_cuisine_map`: the coarse fallbacks, where our taxonomy is thinner
  than Overture's. `salvadoran_restaurant` (105 rows), `honduran_restaurant`
  (36) and `venezuelan_restaurant` (27) all land on `latin-american`; the note
  column records what was lost so it can be recovered if leaves are added.
- **Taxonomy gaps still open:** no plain **American** leaf (943 rows on
  `american_restaurant` → `new-american` at 0.65), no **hot dog** leaf (53
  rows plus Wienerschnitzel), no generic **African** leaf (46 rows unmapped),
  no **kosher** leaf. Chicken was the big one and is closed.

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
- **Delivery-only virtual brands** — resolved in 0007. Flagged, not dropped.
  Promote must carry `delivery_only` onto `places`, and **a delivery-only
  place must never be a Surprise Me pick** — that affordance means "go here
  now".
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
