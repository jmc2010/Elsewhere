# Measurements

Numbers actually observed, with the query and the conditions. Kept separate
from `docs/spec.md` (what we intend) and `docs/STATUS.md` (where we are), so
that later work can argue with the evidence rather than re-derive it.

---

## Phase 0 exit criteria — catalog queryable by radius + cuisine under 200ms

**Met, 2026-09-20.** 54ms execution on a Supabase **Micro** instance.

| | |
|---|---|
| Catalog | 39,304 places, North Texas (`-97.9 32.3 -96.1 33.75`) |
| Cuisine links | 34,910 |
| Query | Italian within 20 miles of Valley View (`-97.1614 33.4937`) |
| Result | 17 places |

Run `analyze` after any bulk promote. Before it, planning time alone was
**52ms**; after, **1.3ms**. Execution barely moved — the win was entirely in
planning, and it is free.

### The GiST index works

```
Bitmap Index Scan on places_location_idx
  Index Cond: (location && _st_expand(..., 32187))   rows=2202
→ Bitmap Heap Scan, Filter: st_dwithin(...)          rows=1004
```

39,304 → 2,202 by bounding box → 1,004 exact inside 20 miles.

### Query shape: build catalog-search spatial-first

Both shapes were measured at metro scale and are equivalent:

| Shape | Execution |
|---|---|
| Cuisine-first (planner's own choice) | 54.2 ms |
| Spatial-first (`with nearby as materialized`) | 55.7 ms |

Since speed does not decide it, structure does — **spatial-first, because its
working set is bounded**:

- A 20-mile radius is ~1,000 places whether the catalog holds 40k rows or 4M.
- Cuisine-first scales with how many places *nationally* share that cuisine,
  and evaluates the expensive `st_dwithin` once per candidate. `italian-classic`
  is 684 links today; multi-metro `mexican` will be tens of thousands.

Do not rely on the planner to pick correctly as the catalog grows. **PostGIS's
selectivity estimate for `st_dwithin` on geography was wrong by 500×** —
`rows=2` estimated against 1,004 actual. It is choosing a good plan today from
numbers that carry no information.

Two further notes for whoever writes `catalog-search`:

- **Resolve the cuisine slug to an id once**, up front. The measured plan did
  922 index lookups into `cuisines` to find 17 matches, because the slug
  filter was applied last. `pc.cuisine_id = (select id from cuisines where
  slug = $1)` makes it an integer compare.
- **Budget planning time, not just execution.** A cold first query in a
  session planned for 127ms against 112ms of execution. It drops to ~1ms
  after, but on a Micro instance the 90-second decision window is end-to-end.

### Reproducing

```sql
analyze places; analyze place_cuisines; analyze cuisines;

explain (analyze, buffers)
with nearby as materialized (
  select p.id from places p
  where st_dwithin(p.location,
        st_setsrid(st_makepoint(-97.1614, 33.4937), 4326)::geography, 32187)
    and not p.permanently_closed
    and not p.delivery_only
)
select n.id from nearby n
join place_cuisines pc on pc.place_id = n.id
join cuisines c on c.id = pc.cuisine_id
where c.slug = 'italian-classic';
```

Run it twice; the first includes cold-cache and first-plan costs.

---

## Google place_id resolution — `locationBias` is advisory, `locationRestriction` is not

**Confirmed 2026-09-20**, against the live Places API (New) Text Search.

This is the finding to carry into `places-proxy`. It is a one-word difference
in the request body, and it is the difference between a working catalog and a
quietly poisoned one.

### What happened

A 30-place sample (20 rural North Texas, 10 urban) resolved at 73% using
`locationBias` with a 2km circle. The failures were not random:

| Catalog place | Google returned | Distance |
|---|---|---|
| Frutería Y Neveria Lupita | Pekes Frutería Y Neveria | **60,731 m** |
| Silo's Coffee, Smoothies & Cones | Silos In Celina | 28,642 m |
| Dickey's Barbecue Pit | Dickey's Barbecue Pit | 14,194 m |
| The Original Fried Pie Shop | The Original Fried Pie Shop | 8,406 m |
| Subway | Subway | 5,272 m |
| Subway | Subway | 2,422 m |

**Six of the eight failures were results returned from outside the 2km bias**,
one of them 60km outside it. `locationBias` is a hint that Google discards
when it finds a better text match elsewhere.

Five were chains matched at the wrong branch, with a name similarity of 1.00.
Nothing about the response looks wrong. Stored, that `place_id` binds a real
restaurant to a different location permanently, and every future hydration for
that place — for every user, forever — returns the wrong restaurant's hours,
rating and reviews.

### The fix

`locationRestriction` with a rectangle is a hard filter and is honoured.
Verified directly: the same Fried Pie Shop query that returned a confident
result 8.4km away under bias returns `{}` under restriction.

```json
"locationRestriction": {"rectangle": {"low": {...}, "high": {...}}}
```

Note `searchText` takes a **rectangle** here, not a circle.

### Why this changes how the spec's 85% threshold should be read

Spec §4 treats unresolvable places as a flagged edge case, which assumes
failures are *visible*. Under `locationBias` they were not — a wrong answer
and a right answer are indistinguishable in the response.

Under `locationRestriction` the failure mode becomes `no_result`: an honest
gap that can be flagged, fallen back from, and retried on a later Overture
release. **A lower rate with honest failures is a better position than a
higher rate with silent corruption.** Judge the result on the failure mode
first and the percentage second.

### Requirements this places on `places-proxy`

1. **Use `locationRestriction`, never `locationBias`**, for resolution.
2. **Validate the returned coordinates anyway.** We already compute the
   distance in order to classify; rejecting an out-of-radius resolution is a
   few lines and removes the dependency on Google continuing to honour the
   restriction.
3. **Treat resolution failure as normal, not exceptional.** Flag the row
   (`google_resolution_failed` already exists on `places`) and render
   catalog-only.

### Still outstanding

The full 30-place run under `locationRestriction` has not been recorded here
yet. The number to watch is whether `same_name_different_place` goes to zero;
the headline percentage is the less important half of the result.
