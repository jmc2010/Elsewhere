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
- `scripts/check-no-google-persistence.sh` fails CI if a migration introduces
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

## Conventions

- TypeScript strict mode throughout.
- Screens own their own queries; no repository/service abstraction layer.
- Server-side secrets (Google Maps key, Anthropic key) live only in edge
  function environments. **Never ship an API key in the app bundle.**
- Migrations are forward-only and timestamped.
