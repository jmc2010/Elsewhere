# places-proxy

The only path to Google. Everything about this function exists to keep two
promises: **no Google content in the database**, and **no surprise bill**.

## Deploy

```bash
supabase secrets set GOOGLE_MAPS_API_KEY=...
supabase functions deploy places-proxy
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform. The Maps key must never appear anywhere else — not
in `.env`, not in the Expo bundle, not in a client call.

## Request

```jsonc
POST /functions/v1/places-proxy
Authorization: Bearer <user JWT>       // required; quota is per user

{
  "action": "hydrate",                  // or "detail"
  "place_ids": ["<our uuid>", ...],     // <=25 for hydrate, 1 for detail
  "session_id": "opaque-per-session"    // required for calls-per-session
}
```

`hydrate` is the shortlist path and deliberately does **not** request the
Atmosphere field set. At 25 cards that is the difference between Enterprise
($20/1k) and Enterprise+Atmosphere ($25/1k) on every card nobody opens.
`detail` is one place, opened on purpose, where Atmosphere is justified.

## Response

```jsonc
{
  "session_id": "...",
  "quota": { "granted": 18, "used_today": 60, "daily_limit": 60,
             "degraded": true },
  "places": [
    { "place_id": "<our uuid>", "name": "...",
      "live": { "rating": 4.4, ... },   // GOOGLE. Request-scoped. Never stored.
      "live_status": "ok" }
  ],
  "attribution": "Powered by Google"
}
```

`live_status` is one of:

| | |
|---|---|
| `ok` | hydrated |
| `unresolved` | no Google `place_id`; render catalog-only |
| `quota_exceeded` | budget ran out mid-batch; render catalog-only |
| `error` | the call failed; render catalog-only |

**Only `ok` carries a `live` object.** The other three are normal, not
exceptional — roughly a quarter of places do not resolve at all (see
`docs/measurements.md`), so the UI must be designed for a card with no rating
rather than treating it as a bug.

`degraded` means the batch was partially funded. The grant is spent in
shortlist order, so the cards the user sees first are the ones that get
hydrated.

## What may be persisted, and by what

Exactly two things, each with exactly one writer:

| Value | Writer | Retention |
|---|---|---|
| `place_id` | `google_place_id_record()` | indefinite |
| `businessStatus` → a **boolean** | `google_business_status_record()` | derived, not the string |

Everything else lives in `live`, which is serialised to the HTTP response and
dropped. `LiveFields` is typed distinctly from anything with a database
writer, and `scripts/check-no-google-persistence.py` fails the build if a
forbidden field name or the `live` envelope reaches `.insert()`, `.update()`,
`.upsert()` or an unapproved `.rpc()`. That check is verified to fail on a
violation, not just to pass when clean.

## Resolution: bias, then validate ourselves

Catalog rows carry no Google `place_id`, so the first hydration resolves one
with Text Search and stores it forever (spec §4).

**The request uses `locationBias`, and the result is validated in this
function**, by the rule:

```
accept if  distance <= 30m
       or (distance <= 250m and name_similarity >= 0.55)
```

This is measured, not assumed. `locationBias` is advisory — a 2km bias circle
returned a result **60km** outside it, and five chains matched at the wrong
branch with a name similarity of 1.00. `locationRestriction` was tried and is
worse: it lost four correct matches and still needed this same check. Full
numbers in `docs/measurements.md`.

A rejected resolution becomes `unresolved`, which is recoverable. A wrong
`place_id` would be stored permanently, served to every user forever, and
carry no signal that anything was wrong.

## Cost controls

- **Per-user daily quota**, `google_daily_call_limit()`, currently 60. Change
  it with a migration so the change has a diff.
- **Batch ceiling of 25** for `hydrate` — the shortlist *is* the cost ceiling
  per session (spec §5.1).
- **Budgeted before spending.** A place needing resolution costs 2 calls
  (searchText + details); an already-resolved one costs 1. The whole batch is
  reserved up front.
- **Fails closed.** A missing quota row grants 0, because guessing generously
  is how a bill happens.
- **Calls-per-session** via `google_calls_per_session()`. This is the metric
  the spec says to alert on, and the `session_id` column exists so that it can
  be computed from the first call rather than retrofitted.

## Attribution

Any surface showing `live` data must display **"Powered by Google"**, and
reviews must be shown unmodified with reviewer name, photo and link (spec §9).
The response carries the attribution string so the client cannot forget.
