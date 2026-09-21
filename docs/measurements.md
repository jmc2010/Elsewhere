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

### The fix is client-side validation, NOT locationRestriction

`locationRestriction` was the obvious response and it is the wrong one. Tried
against the same 30 places, it **lost four correct matches** while still
returning wrong businesses inside the box:

| Place | Under bias | Under restriction |
|---|---|---|
| Bless That Jerk | 3 m, name 1.00 | `no_result` |
| Chester's Chicken | 104 m, name 1.00 | `no_result` |
| Stiletto Kitchen | 3 m, name 1.00 | 1,411 m → *Parker Brothers Traildust* |
| Stiff Peaks Confections | 3 m, name 1.00 | 418 m → *Fruit Delite Krum tx* |

And it did not remove the need to validate: that run still produced five
`mismatch` rows within 2km, including `Subway` → *Firehouse Subs Frisco
Square* at 414m.

So the restriction costs recall and buys nothing, because the client-side
check is required either way.

| Approach | Resolved |
|---|---|
| **`locationBias` + validate distance and name client-side** | **22/30 (73%)** |
| `locationRestriction` (2km rectangle) | 20/30 (67%) |

**The validation rule, which is what actually provides the safety:**

```
accept if  distance <= 30m                              (same building; name may differ)
       or (distance <= 250m and name_similarity >= 0.55)
otherwise reject -> no_result
```

The 30m clause matters. "Bayer's Kolonialwaren" resolves to "Bayers Bakery"
5m away and "Ranchman's Ponder Steakhouse" to "Ranchman's by Marty B" 2m
away. Both are correct; at a few metres there is no other building, and
insisting on name agreement would throw away good resolutions.

Under bias, validation rejects all eight dangerous far-matches, including the
60km Frutería and both wrong-branch Subways.

### Rural was not worse than urban

Contrary to expectation: rural 15/20 (75%), urban 7/10 (70%). The urban
failures were ambiguous chain branches (two Subways), which is a different
problem from thin coverage. The worry that Elsewhere's rural advantage would
be undercut by unresolvable places is not supported at n=30 — though 30 is
small and this is worth re-measuring on a larger sample before leaning on it.

### The query must include locality

The 73% was measured with a text query of `"<name>, <locality>, TX"`, not the
bare name. That is not a detail.

`places-proxy` shipped sending only the name, and Valley View's Dairy Queen
came back `unresolved` — while the identical chain resolved at 11m, name
similarity 1.00, from the spike. Because `locationBias` is advisory, a bare
`"Dairy Queen"` lets Google return whichever branch it likes; the distance
check then correctly rejects it, and the place is recorded as having no
Google listing when it plainly has one.

**Any change to the query invalidates the 73%.** The measurement describes one
specific request shape, and the deployed code silently diverged from it.

### Requirements this places on `places-proxy`

1. **Use `locationBias`, and validate the returned coordinates and name
   yourself** using the rule above. Do not rely on Google to bound anything.
2. **Include locality and region in the text query.** The bias will not do
   that work for you.
2. **Reject rather than guess.** A rejected resolution is `no_result`, which
   is recoverable. A wrong `place_id` is stored permanently, is returned to
   every user forever, and has no runtime signal that anything is wrong.
3. **Treat resolution failure as normal, not exceptional.** ~27% of places
   will not resolve. Flag the row (`places.google_resolution_failed` already
   exists) and render catalog-only.
4. **Retry on later Overture releases.** Some `no_result` rows are coordinate
   drift rather than absence, so a failed resolution should not be permanent.

### Why the spec's 85% threshold is the wrong test

§4 treats unresolvable places as a flagged edge case, which assumes failures
are *visible*. Under `locationBias` alone they are not — a wrong answer and a
right answer are indistinguishable in the response body.

With validation the failure mode becomes an honest `no_result`. **A 73% rate
with honest failures is a far better position than an 85% rate where some of
the 85% is silently wrong.** Judge the failure mode first, the percentage
second.

At 73%, roughly one shortlist card in four shows no rating. That is a product
question as much as an engineering one, and it should be settled before the
shortlist UI is designed around every card having one.
