# Status

Living handoff between working sessions. Update it when something lands.
Read `CLAUDE.md` for the rules and `docs/spec.md` for the reasoning — this
file only covers **where we are right now**.

**Phase 0 — Foundation. COMPLETE, 2026-09-20.** Exit criteria was catalog
queryable by radius + cuisine in under 200ms; measured at **54ms** on Micro.
See [`docs/measurements.md`](measurements.md).

**Phase 1 — Shortlist. COMPLETE, 2026-09-21.** Filter sheet (cuisine,
distance, stars, open now), a settable search origin, a hydrated shortlist,
and Surprise Me. A real "where to eat" query returns ten cards with live
ratings at about ten Google calls per session.

**Design pass one — landed 2026-09-22.** [`docs/design-spec.md`](design-spec.md) and the
published canvas. Tokens, type scale, tuning config and `PlaceCard` are built
and checked against the canvas in both themes; the eight card states and a 2x
text-scale case live at the `/harness` route.

**Phase 2 — Memory** is in progress. The schema landed 2026-09-22: verdicts,
tags and the ingest fields the card states depend on. What remains is the
screens that write to it — the cold-start grid, then review capture. Surprise
Me exists but three of its four weight terms stay neutral until Layer 3 has
data; `src/components/SurpriseReveal.tsx` is where they land.

**Ranking is correct rurally and a smaller compromise in cities than it
first looked.** `catalog_search` returns a pool the client ranks. Rurally the
pool is the whole truth — Valley View returns 21 of 21, Gainesville 163 of
163, nothing is excluded before ranking. Downtown Dallas has 3,982 eligible
places and the pool is 200, so any single request sees 5% of the city.

An earlier version of this note stopped there and concluded the client was
tuning weights over a 5% sample. That was measured before the ordering was
fixed and it is now too gloomy. The pool is banded by freshness and then
seeded per user per day (0031, 0036), so the slice rotates: **2,560 of 3,982
downtown Dallas places — 64% — are reachable across a month**, against 200
under the original fixed ordering. A given evening still shows 5%; what
changed is that the other 95% are reachable rather than excluded forever.

It remains a compromise. Ranking should move into `catalog_search` with the
§15 thresholds in a tuning table, so the whole eligible set is ranked rather
than a rotating sample of it. But it is a rotation problem now, not an
exclusion one.

**The pre-design screens are still the pre-design screens.** `index.tsx`,
`FilterSheet`, `LocationPicker` and `SurpriseReveal` are Phase 1 scaffolding
in system defaults, exempted by name in
`scripts/check-no-colour-literals.py`. Each comes off that list as it is
rebuilt; the list is expected to reach empty.

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

## Check what is actually applied

Migrations are applied by hand here, so nothing tracks them and the list
below is only as accurate as whoever last edited it. This is not:

```bash
psql "$ELSEWHERE_PG_URL" -P pager=off -f scripts/check-schema.sql
```

One row per migration, each looking for a landmark object only that migration
creates. Run it before trusting anything in this file.

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
- **0013 quality flags** / **0014 catalog_search locality** — applied.
  22,957 places share an address; 292 have an uncorroborated locality. Both
  came out of hand-auditing the first real shortlist.
- **0011 radius guard** — applied. Clamps radius to 100 miles and validates
  coordinates.
- **0012 google quota** — written, **not yet applied**. Per-user daily call
  limit, `session_id` on `google_api_usage`, the two permitted Google writers,
  and `places_coords` for the proxy. All revoked from `public`/`authenticated`
  and granted only to `service_role`.
- **`places-proxy` edge function** — **deployed and working**, 2026-09-20.
  First live hydration: Tia's Tex-Mex 4.8★ (287), Subway 3.7★ (75), both with
  price, business status and open-now. Quota recorded correctly.
- **0015 resolution retry** — applied. Failed resolutions retry after 30 days.
- **0016 probably_closed** — applied. Infers closure for a known chain Google
  cannot find, and suppresses it from shortlists.
- **Shortlist hydration working on a real device**, 2026-09-20. Ten cards
  with live ratings, price and open-now, filling in after the catalog list
  renders. Layer 1 → Layer 2 → screen, end to end.
- **0020 catalog_localities** — written, **not yet applied**. Towns with 5+
  open places, with centroid and distance, nearest first. 47ms. Powers
  "search somewhere I am not yet".
- **Location picker** — the search origin is settable: Near me, or a town you
  are travelling to. Mockup approved 2026-09-21. Ships over OTA.
- **Filter sheet working on a device**, 2026-09-20. Cuisine by group and
  distance presets, against the live catalog. Judged a good list.
- **OTA updates live.** JS changes now ship with
  `npx eas update --branch preview`; rebuilds are only needed for native
  changes.
- **Expo app scaffold** — SDK 57, RN 0.86, React 19, expo-router, TypeScript
  strict. iOS (3.3MB) and Android (3.6MB) bundles both build.
- **Running on a real device, 2026-09-20.** Home screen returns the nearest 25
  places within 20 miles of Valley View over Expo Go. The Phase 1 spine works
  end to end: location → anonymous session → `catalog_search` RPC → PostGIS →
  cuisine-mapped catalog. No Google call anywhere in that path.

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

### 2026-09-22 — design foundation, verdicts, and the ingest fields

- **Static font instances, not variable fonts.** React Native 0.86 has no
  `fontVariationSettings` on either platform — verified against the installed
  package, not recalled. Fraunces' SOFT and WONK axes are unreachable at
  runtime, so `scripts/fonts/build_static_instances.py` cuts ten static
  instances at the five spec'd axis combinations. The rating star is drawn
  into Archivo at U+2605: `react-native-svg` is a native module and would cost
  a full rebuild for a 10px mark, and `★` falls through to SF Pro or Roboto.
- **`scripts/check-no-colour-literals.py`** — in CI, verified to fail on hex,
  `rgba()` and named colours.
- **0021 verdicts and tags** — applied. Three verdicts, twenty seeded tags
  with propagation classes. `place_ratings` was measured empty (0 rows) and
  dropped behind a guard that raises if ever run against data;
  `place_vetoes` folded in as `not_again`. `catalog_search` was rewritten in
  the same migration because plpgsql does not resolve table references until
  runtime — dropping `place_vetoes` alone would have broken search silently.
- **0022–0024 ingest** — applied. `phone` (88.6%), `update_time` (100%),
  `display_name` (461 cleaned). Cuisine coverage **93.2%**.
- **0025 `known` verdict** — adds the cold-start state. `known` gets no
  recency suppression (it carries no date) but does suppress novelty.
  Not a weaker `fine`; collapsing them breaks the recognition grid.

Three bugs found by measuring rather than reading, all worth remembering:

1. **Taking the newest `update_time` across `sources` destroyed the signal** —
   39,852 of 39,852 records landed in the current cycle, because every record
   carries a bulk-stamped Overture source at the release date. It was reading
   the release, not the place. `sources[1]` is the record-level contributor.
   Check that holds: both known-closed Valley View places land stale — Dairy
   Queen 2025-07-13, Rider's Smokehouse 2025-10-16.
2. **The `name_cuisine_map` fold-in went into dead code.** `promote`'s `src`
   CTE computed a `cuisine_id` nothing read; `place_cuisines` is rebuilt
   further down from an independent re-derivation. The first promote took
   coverage 93.2% → 88.8%, exactly as 0018 predicted. Fixed in 0024.
3. **A backticked word in a SQL comment executed** — the extract heredoc must
   stay unquoted for `${RELEASE}`. Harmless output, but arbitrary execution in
   a script holding the database URL.


## Next

**Accounts and connections. The capture loop is built; identity is what makes
it worth anything.**

Three weeks of real use (2026-09-26 -> 2026-10-20) produced this, measured:

    verdicts        20     <- 19 of them 'known', from the cold-start grid
    real verdicts    1     <- one, ever
    lock-ins         1
    visits           0
    sessions in Oct  ~6    <- Oct 6, 8, 9, 10, 11, 16

Six sessions that captured nothing. The app was a browser. Diagnosis: a
lock-in could only be made by committing to a place the reveal offered, and a
verdict only by answering a prompt from such a lock-in -- so all of Layer 3
was gated behind a list showing 15 of Denton's 750. The user went elsewhere
and had no way to say so.

Built 2026-10-20, not yet on device:
  - catalog_find_by_name (migration 0057) + /find. Search any restaurant by
    name, no radius, nearest first. Layer 1, zero Google calls.
  - Place detail: "I'm going here" (lock-in -> schedules the existing review
    prompt) and "I've been here" (verdict directly; ReviewCapture already
    supported a null lockinId and had never been wired up).
  - Paging past the first 15, catalog-only. Only the first page hydrates, so
    browsing stays free. `ordered` / `shortlist` / `visible` are now three
    different things on purpose.

THE NEXT CHUNK IS ACCOUNTS, and it is not optional housekeeping. §3's ranking
wants friend verdicts; §4 specifies verdict visibility; place detail is
specified as yours, then your people, then Google. "Your people" is the
product. Anonymous auth cannot express it.

Sequencing, and the reason it is not a stall: Supabase converts an anonymous
user in place, keeping the same auth.uid(), so everything recorded between now
and then carries over and becomes attributable. Verify capture works first --
one person's loop has to work before a group's can -- then accounts, then
connections.

Two things that unblock with accounts:
  - `visits` is currently UNWRITABLE. household_id is NOT NULL and the RLS
    policy is membership-based, so a solo user cannot insert one. That is why
    the table has always been empty and why catalog_search's last_visited_at,
    visit_count and p_unvisited_only are permanently inert. Recency decay --
    CLAUDE.md calls it "the differentiator" -- has no data to act on.
  - Connections and group sessions (§9), both still unstarted.

Still open, unchanged:
  - Re-measure calls per session. measurements.md is flagged stale.
  - The review prompt has NO quiet-hours guard: `now + 6h` from an 8:30pm
    lock-in schedules a 2:30am notification. Offered, never ruled on.
  - "We didn't go" is one irreversible tap. It is now hidden where it has no
    lock-in to resolve, but still unconfirmed where it does.
  - Production channel is weeks behind preview.
  - Gainesville / GAINESVILLE / Gainsville show as three towns.

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
