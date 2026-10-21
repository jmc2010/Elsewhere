# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

**Read [`docs/spec.md`](docs/spec.md) before any substantive work.** It is the
source of truth for product and architecture decisions. This file covers only
the rules that are easy to violate by accident.

## The one rule that is not negotiable

**Google Places content must never be written to the database.**

This is a legal obligation under the Google Maps Platform Terms, not a style
preference. Only two exceptions exist:

| Data | May we store it? |
|---|---|
| `place_id` | **Yes, indefinitely.** This is what makes the catalog join possible. |
| Latitude / longitude from Places | Up to 30 days |
| Everything else — name, address, `rating`, `userRatingCount`, `priceLevel`, opening hours, `reviews`, the `serves*`/`goodFor*` attributes | **No. Request-scoped only.** |

Note the asymmetry that makes the whole design work: we *do* store names,
addresses, and coordinates — but they come from **Overture / Foursquare open
data** (Layer 1), which carries no such restriction. The same field is legal
from one source and illegal from another. When adding a column, the question is
never "what is this field?" but **"where did this value come from?"**

Mechanical guards, so this doesn't rely on memory:

- The `places` table has **no columns** for rating, review text, price level, or
  hours. Adding one is a schema error, not a code-review finding.
- `scripts/check-no-google-persistence.py` fails CI if a migration introduces
  one. Do not weaken it to make a migration pass.
- Google-derived values are returned from `places-proxy` in a response envelope
  that has no database writer. Keep it that way.

## The three layers

Every piece of data belongs to exactly one, and they have different rules.

1. **Layer 1 — Catalog.** Overture / Foursquare open data in Postgres + PostGIS.
   Ours permanently, free to query, no result-count cap. All filtering happens
   here. **Never call Google to filter or browse.**
2. **Layer 2 — Live signal.** Google Places, fetched only for a shortlist of
   ~25 candidates, never persisted. Every call costs money; see the cost model
   in the spec.
3. **Layer 3 — Preference & history.** Visits, ratings, vetoes, household
   membership. Entirely our own data, no restrictions. This is the product's
   moat.

## Cost discipline

Google Enterprise-tier SKUs are the only cost that scales with usage, and they
are expensive enough to sink the product if hydration is careless.

- **No Google call on browse or filter. Ever.**
- Hydration is batched — one edge-function call per shortlist, fanned out
  server-side.
- Per-user daily quota is enforced in `places-proxy`, with a degraded
  catalog-only mode when exceeded.
- Calls-per-session is a first-class metric from the first hydration call, not
  something to instrument after launch.

If a change increases the number of Google calls per user session, say so
explicitly in the PR description with the new number.

## Positioning constraints that affect product decisions

Our funded competitor (Zest) builds taste profiles from credit-card
transactions. That gives them a better cold start and a structurally worse
signal: a charge records that you *paid*, not that you *enjoyed it*, and
frequency-weighting reinforces the very rut we exist to break.

Consequences for anyone building features here:

- **Recency decay is the differentiator, not a nice-to-have.** Anything that
  weakens it needs a strong argument.
- Don't frame features as "personalized recommendations" — that is a
  head-to-head on their strength. Frame as anti-rut and group decisioning.
- Cold start matters competitively. Onboarding that seeds Layer 3 quickly is
  high-priority work.

## Every migration runs against local first. No exceptions.

Before a migration touches the cloud database, it must apply cleanly to a
**local** one built from scratch:

```bash
supabase db reset          # drops, runs all migrations in order, applies seed.sql
```

Not "usually". Not "unless it looks simple". Every one.

The asymmetry is the reason. **A broken client writes wrong-but-valid rows
that can be deleted. A broken migration is unrecoverable** — it has already
dropped the column, already rewritten the function, already lost the data,
and the cloud database is the only copy of 54 migrations, a 39,765-row
ingest, and every verdict anybody has recorded.

`supabase db reset` also catches the failure that applying-in-sequence never
does: a migration that works against *today's* schema but not against a
schema built from scratch. Those pass in the cloud, where the earlier
migrations already ran months ago, and fail the first time anyone needs to
rebuild — which is the moment they are least able to cope with it.

Local is seeded with a subset, not the catalog: Valley View, Gainesville and
a downtown Dallas slice, ~1,470 rows. Regenerate with
`scripts/dev/generate_seed.sh`. Density is what the screens branch on, so
three density regimes is what development needs; 39k rows would only be
slower to reset.

## A migration must never derive data from the contents of a table

The same file runs against an **empty local database** and a **populated
cloud one**. Anything computed from existing rows therefore diverges silently
between them: it does the right thing on cloud, where the data is already
there, and quietly nothing on local, where `seed.sql` loads *after* every
migration has run.

Silently is the problem. Nothing fails, nothing warns, and the two databases
stop agreeing about something nobody is looking at.

Two acceptable forms:

- **Embed the data as versioned rows in the migration**, so the values are
  auditable in the diff rather than inferred at runtime.
- **Compute it in a trigger**, so the property belongs to the table rather
  than to one write path — which also covers `promote`, `seed.sql`, and any
  row inserted by hand.

Found twice in one session, both in 0060: the `locality_raw` backfill, and
then `locality_canonical`, which was built the same way. **The second only
surfaced because the first had been looked for.** When this bites, check
whether it bit more than once in the same file.

## Never run `supabase db push` against this project

The cloud database **has no migration history**. `supabase_migrations` does not
exist as a schema; every migration reached cloud by being applied directly,
and the CLI has no record of any of it.

So `supabase migration list` reports all 56 migrations as unapplied on remote,
which is not a bug to fix but a fact to work around, and **`supabase db push`
would try to replay all of them from `0001` against a live database holding
39,304 places and every verdict anyone has recorded.** `0001` is the init
migration. That is the unrecoverable case the local-first rule exists to
prevent, reached by the one command that sounds like the safe way to do it.

The actual procedure, and it has not changed:

```bash
supabase db reset                                    # local, from scratch. Always first.
psql "$(cat ~/.elsewhere-db-url)" -v ON_ERROR_STOP=1 \
     -f supabase/migrations/<the one new file>.sql   # cloud, one file, explicitly
```

`ON_ERROR_STOP=1` is not optional: without it psql continues past a failed
statement and commits a half-applied migration. Every migration file is wrapped
in `begin`/`commit`, so with it, a failure rolls back cleanly.

Two things that follow:

- **Apply the migration BEFORE shipping the JS that needs it.** New parameters
  get defaults, so the deployed app keeps working against the new function;
  the reverse is not true, and the old app would break the moment the new
  column is missing.
- Adopting CLI migration history later means back-filling `schema_migrations`
  with all 56 rows, not running `db push`. Nobody should attempt that casually.

## Before stopping: rewrite the Next section

**At the end of every session, rewrite the `## Next` section of
[`docs/STATUS.md`](docs/STATUS.md) before stopping.** Not "if something
changed" -- every session.

That file is the resume point; a session typically begins by reading it and
picking up from `Next`. When it goes stale it does not fail loudly, it just
quietly describes work that was finished days ago, and the next session starts
by doing the wrong thing or by spending its first minutes working out that the
instructions are fiction. It has already happened once: `Next` still said to
deploy `places-proxy` and build the first APK long after both were done.

What `Next` must contain when you stop:

- The single next action, specific enough to start from cold.
- Anything applied to the live database that is not obvious from the
  migrations directory.
- Anything deliberately left undone, and why -- a known gap is information, a
  forgotten one is a bug.

Move finished work into `## Done` rather than deleting it. The record of what
was tried and rejected is worth more than a tidy file.

## Handoff block

End every completed chunk of work with a block in exactly this format, fenced
so it can be copied in one selection. Most fields will be "None" — that is what
keeps it short. Be terse. No code diffs, no narrative of the work.

```
## HANDOFF
**Done:** files and migrations touched, one line each, semantic not literal
**Now possible:** what the app can do that it couldn't before
**Spec conflicts:** section number + what reality said. The spec is
  authoritative, so if it is wrong, this is where it gets corrected. "None"
  if none.
**Chose for you:** decisions made because the spec was silent. Every one.
  This is where drift enters, so err toward listing it. "None" if none.
**Numbers:** real counts, distributions, before/after samples. Raw values,
  not characterisations — "2,076 rows (5.3%)", never "a small number".
**Awaiting ruling:** decisions needed from the reader, WITH THE DATA INLINE.
  Paste the actual strings, rows and counts here. Never "see above" and never
  "pasted earlier" — this block is what gets forwarded, so anything outside
  it does not exist. "None" if none.
**Blocked:** what is waiting, and on what
**Skipped:** deliberately not done, and why
```

Two rules about it:

- **"Spec conflicts" and "Chose for you" are the two that matter.** A chunk
  that reports "None" for both when it actually made a judgment call is worse
  than no block at all.
- **Do not soften numbers.** If the name-cleaning rule mangles 40 of the 489
  long names, say 40 and show three of them.
- **"Awaiting ruling" carries its own evidence.** A question that references
  data sitting in the surrounding prose is a question that never gets asked,
  because the block travels and the prose does not. If a ruling needs forty
  rows, forty rows go in the block.

## The anonymous session key is the only thing holding Layer 3 together

There is no account yet. Every verdict, lock-in and correction is scoped to an
anonymous `auth.uid()`, and the only thing that reconnects a returning user to
their own history is a token in AsyncStorage under a key supabase-js derives
from the project URL:

```
https://oygsbuailwpjgkqbxllp.supabase.co  ->  sb-oygsbuailwpjgkqbxllp-auth-token
http://127.0.0.1:54321                    ->  sb-127-auth-token
```

Change the key and the app finds no session, signs in anonymously again, and
gets a **new user id**. The old rows are not deleted — they are orphaned under
an id nothing will ever present again, and because `hasSeenColdStart()` counts
verdicts through RLS, the new identity sees zero and onboarding restarts. To
the user that is indistinguishable from losing everything.

Two ways to do it by accident:

1. **Publishing an OTA to `production` while `.env.local` is active.**
   `EXPO_PUBLIC_*` is inlined at bundle time, so the production install would
   start looking under `sb-127-auth-token`. Check `npm run env:which` before
   any production publish.
2. **Setting an explicit `storageKey` in `createClient`.** This is the correct
   long-term hardening — it decouples the session from the URL — but doing it
   naively *causes* the loss it prevents, because every existing install
   stores its token under the derived key. It needs a one-time migration that
   reads the old key and writes the new one, kept for at least a release.
   **Do not "harden" this casually.**

The good news, and the reason this is recoverable: different URLs produce
different keys rather than overwriting one. A session pointed away is dormant,
not destroyed — restore the correct URL and it returns.

This stops mattering once accounts exist (§8). Until then it is the single
point of failure for the product's moat.

## Conventions

- TypeScript strict mode throughout.
- Screens own their own queries; no repository/service abstraction layer.
- Server-side secrets (Google Maps key, Anthropic key) live only in edge
  function environments. **Never ship an API key in the app bundle.**
- Migrations are forward-only and timestamped.
