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

Connection string lives in the developer's shell as `ELSEWHERE_PG_URL`.
It is a superuser credential — never commit it, never paste it into a chat.

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

## Next

**Run the Overture extract.** `scripts/ingest/extract_overture.sh`, see
`scripts/ingest/README.md`.

⚠️ That DuckDB query was written against Overture's documented schema and has
**never been run**. Expect field-name errors in the nested structs —
`addresses[1].freeform`, `categories.alternate`, `websites[1]` are the likely
culprits. Fix, re-run until rows land in `overture_staging`, then commit the
corrected script. This is expected iteration, not a setback.

Then: review `select primary_category, count(*) from overture_staging group by 1
order by 2 desc`, and build the category → cuisine mapping. The spec calls this
the hardest data problem in the project; audit it by hand for the first metro.

## Open decisions

- **Which metro first?** Blocks the extract. Needs to be somewhere the
  developer knows well enough to spot bad cuisine mappings.
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
