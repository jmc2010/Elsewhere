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
