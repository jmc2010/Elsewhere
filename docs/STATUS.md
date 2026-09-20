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
- **0010 catalog_search** — applied. Layer 1 + Layer 3 narrowing,
  spatial-first, no Google calls.
- **0011 radius guard** — applied. Clamps radius to 100 miles and validates
  coordinates.
- **0012 google quota** — written, **not yet applied**. Per-user daily call
  limit, `session_id` on `google_api_usage`, the two permitted Google writers,
  and `places_coords` for the proxy. All revoked from `public`/`authenticated`
  and granted only to `service_role`.
- **`places-proxy` edge function** — written, typechecks, **not yet
  deployed**. The only path to Google. Untested against the live API.
- **Expo app scaffold** — SDK 57, RN 0.86, React 19, expo-router, TypeScript
  strict. Home screen does location → `catalog_search` RPC → list. iOS bundle
  builds clean. **Never run against a device.**

### Decided 2026-09-20: catalog_search is called as an RPC, not an edge function

It touches no secrets, and the hop matters inside a 90-second decision window.
Quota enforcement — the actual reason to put something behind an edge function
— lives in `places-proxy`, which is a separate concern. This overrules the
spec's §8 listing of `catalog-search` as an edge function; **update the spec
when `places-proxy` lands.**

The security review that supported it, so it is not re-litigated from scratch:

- Passing another household's `p_household_id` leaks nothing. `visits_member`
  is `using (is_household_member(household_id))`, so RLS returns no rows
  regardless of the argument.
- Vetoes are scoped by `place_vetoes_self` (`user_id = auth.uid()`), which is
  why the function's veto check needs no user predicate of its own.
- The real gap was the **unbounded radius**, closed in 0011. Over RPC every
  argument is attacker-controlled, and a continental radius turns the bitmap
  index scan into a full-catalog scan. That burns database time rather than
  Google spend, so it would never appear in the calls-per-session metric.

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

**Deploy and exercise `places-proxy`.** Written and typechecked; nothing has
called it against the live Places API.

```bash
psql "$ELSEWHERE_PG_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260920000012_google_quota.sql
supabase secrets set GOOGLE_MAPS_API_KEY=...
supabase functions deploy places-proxy
```

Then hydrate a real shortlist from `catalog_search` and check three things:

1. `quota.used_today` climbs by the expected amount — 2 calls for a place
   needing resolution, 1 for one already resolved.
2. `google_calls_per_session()` reports that session. If it does not, the
   metric the spec says to alert on is not working, and it is much easier to
   fix now than after launch.
3. `live_status` distribution roughly matches the spike's ~73% — if `ok` is
   far below that, something in the resolution path differs from the spike.

**Run the app.** It has never been on a device.

```bash
cp .env.example .env     # fill in the two EXPO_PUBLIC_ values
npm install
npx expo start
```

The Home screen should ask for location with an in-context rationale, then
list real places near you, nearest first, with cuisines. No Google call
happens anywhere on that screen and none ever should.

It signs in **anonymously** on first launch. That is deliberate: every catalog
RLS policy is `to authenticated` and `catalog_search` is granted to that role,
so the app needs an identity before it can ask what is nearby. An anonymous
session is a real `auth.uid()`, so RLS, the Google quota and Layer 3 history
all work from first launch, and Supabase can convert it to a permanent
account later without losing history. It also keeps the cold start at zero
friction, which is the competitive point against Zest's Plaid wall (§10).

**Then the rest of Phase 1:** filter sheet, shortlist hydration through
`places-proxy`, place detail. Exit criteria is a real "where to eat" query
returning 10 good cards under budget.

### Two product questions that now have numbers behind them

- **About one card in four will have no rating, price or open-now.** Does an
  unresolved place rank lower, get a distinct treatment, or drop out of the
  shortlist? Dropping it would quietly reduce Elsewhere to "places Google
  knows well", which is the opposite of the thesis.
- **The daily quota is 60 calls.** That is roughly two full sessions, chosen
  as a runaway guard rather than a product limit. Revisit it against real
  calls-per-session data rather than by guessing a second time.

### Known follow-up: duplicate catalog rows

`google_place_id_record()` flags the loser when two catalog rows resolve to
the same Google place, because `places.google_place_id` is unique. Those are
Overture duplicates of one restaurant and should be merged rather than
flagged. Needs a dedupe pass; the flag keeps hydration working meanwhile.

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
