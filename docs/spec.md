# Elsewhere — Product & Technical Spec

| Slot | Content |
|---|---|
| **Name** | Elsewhere |
| **App Store subtitle** | Your dining concierge |
| **Tagline** | Everyone's a critic. Here, yours is the only one that counts. |
| **Sign-off copy** | Bon appétit. |

**Why this name.** "Elsewhere" is the literal answer to the question the app
exists to answer — *"Where do you want to go?" "Elsewhere."* It means **not the
usual place**, so the core problem is encoded in the name. It avoids the
saturated food-pun namespace, and it stretches past restaurants to bars,
coffee, and weekend trips without a rename.

Deliberate division of labor: the **name** differentiates, the **subtitle**
explains and carries App Store search keywords ("dining", "concierge") without
making a generic category word our trademark, and the **tagline** states the
thesis — your rating changes tomorrow's shortlist, which is the precise inverse
of a global star average.

**Trademark posture.** Common English word, so expect narrow scope: file a
stylized mark in software classes and accept it. `elsewhere.com` is
unavailable; target `elsewhere.app` or `goelsewhere.app`. Rejected for
documented conflicts: Peckish, Dibs, Bon App, Voilà, Dig In, Foodsy/Foodie/
Foodly, Concierge.

---

## 1. The problem

Deciding where to eat is a recurring, low-stakes, high-friction decision made
under time pressure — usually in the car, usually hungry, usually with someone
else. The failure mode is not "I can't find a restaurant." It is:

1. **The rut.** Defaulting to the same 6–8 places because recalling anything
   else costs more effort than the decision is worth.
2. **Undifferentiated results.** Google returns a ranked list of nearby
   restaurants with no memory of what you liked, what you vetoed, or where you
   ate last Tuesday.
3. **Non-exhaustive, non-sliceable.** You cannot ask "every Italian place within
   50 miles rated 4+ with outdoor seating that we haven't tried" and get a
   complete, filterable answer.
4. **Group deadlock.** "I don't care, you pick" is the most common answer and
   the least useful one.

**The product is a decision engine, not a search engine.** Search is a means;
the deliverable is a short, confident, easy-to-pick-from list — or a single
pick the group will accept.

## 2. Competitive landscape

Two apps occupy adjacent ground. One is not a threat; the other is the most
important external fact in this document.

### Zest — the real competitor

Founded November 2024, launched June 2026. **$1.8M pre-seed from Alexis
Ohanian's 776 and Steve Jang's Kindred Ventures** — credible consumer
investors. Reported 100k+ visits within weeks of launch.

**Their mechanic:** import the user's credit-card transactions through Plaid,
filter to food-and-drink charges, and build a taste profile from where they
actually spent money. Blended with social content, community discussion,
editorial, and review platforms. Users can follow friends and creator-curated
profiles.

They share our core thesis — *Google doesn't know you; your actual behavior
should drive recommendations* — and they solved cold start with a genuinely
clever hack: transaction history hands them your entire dining past on day one
with zero user effort.

**Where they are structurally weak, and where we win:**

1. **Transaction data records that you paid, not that you enjoyed it.** A
   charge cannot distinguish a restaurant you love from one that is merely
   convenient, cannot see that the service was bad, and cannot know you will
   never return. Our explicit rating captures exactly what a receipt cannot.
2. **Their core signal reinforces the rut.** The more often you go somewhere,
   the stronger that place's signal becomes in a frequency-based model. The rut
   is the problem we exist to solve, and a transaction-weighted recommender
   makes it worse. **Our recency-decay mechanic is the direct structural
   counter, and it is the sharpest differentiation available to us.**
3. **Plaid is a brutal onboarding wall.** Asking someone to link a bank account
   before the app has delivered any value is among the highest-friction first
   runs in consumer software. Elsewhere asks for location and nothing more.
4. **It is a discovery feed, not a decision engine.** No evidence of a
   "pick for us, right now" function or of joint decision-making. Following
   friends and creators is social-graph content, not two people in a car
   settling on dinner. **The group decision moment is unclaimed.**

**Implication:** lead positioning with the anti-rut mechanic and the group
decision, not with "personalized recommendations" — that framing puts us in a
head-to-head we would be fighting on their turf with worse cold-start data.

### Concierge & Co. — not a threat

Solo developer (Jon Thomas Hoffman), free with IAP, iPhone-only, no visible
funding, press, or traction. Positions as "your personal guide to going out
well": ask-the-concierge LLM recommendations, saved collections, itineraries,
shareable lists.

It is an LLM-as-curator plus a saving app. The published feature set shows **no
visit history, no post-meal feedback loop, no learning from actual behavior,
and no group decision mechanism.** It validates that the curation framing
resonates without contesting Layer 3. Worth periodic monitoring, not a change
of plan.

## 3. Core product principles

- **Narrow, don't enumerate.** Every screen reduces the option set. A result
  list longer than ~10 has failed.
- **Memory is the moat.** Anyone can query Google. Nobody else knows that you
  liked the patio, hated the noise, and went there three weeks ago.
- **Novelty is a first-class input,** not a side effect. The app actively
  pushes against the rut.
- **Commitment over optionality.** Infinite rerolls recreate the paralysis the
  app exists to remove. Rerolls are limited by design.
- **Speed.** The decision window is ~90 seconds. Cold start to a usable
  shortlist must fit inside it.

---

## 4. Data architecture — the three layers

This is the central architectural decision and everything else follows from it.
Google Maps Platform terms forbid caching Places content, so a queryable
"catalog we own" cannot be built from Google data. We therefore split the data
into three layers with different ownership, cost, and legal profiles.

### Layer 1 — Catalog (ours permanently, free, infinitely sliceable)

**Source:** [Overture Maps](https://overturemaps.org/) Places theme
(GeoParquet, monthly releases) and/or Foursquare OS Places. Both are openly
licensed and carry no caching restrictions.

**Contents:** name, location, address, category taxonomy, website, brand,
confidence score. **No ratings, no reviews** — those come from Layer 2.

**Storage:** Supabase Postgres + PostGIS. One row per place, GiST index on
geography for radius queries.

**Refresh:** monthly reingest, diffed against the existing table so that
locally-derived enrichment (see cuisine normalization below) survives.

This layer answers *"what exists near here that matches these filters?"* at
zero marginal cost and with no result-count cap. It is what makes an
exhaustive, sliceable search legally and economically possible.

### Layer 2 — Live signal (Google, on demand, never persisted)

**Source:** Google Places API (New).

**Fetched only for a shortlist** — never during browse or filter. Fields:

| Field group | Billing tier | Notes |
|---|---|---|
| `rating`, `userRatingCount`, `priceLevel`, `regularOpeningHours`, `businessStatus`, `websiteUri` | Enterprise | The core quality + open-now signal |
| `reviews` (max 5, truncated), `servesVegetarianFood`, `outdoorSeating`, `goodForGroups`, `goodForChildren`, `reservable`, `takeout`, `delivery`, `servesCocktails`, `editorialSummary` | Enterprise + Atmosphere | The "slice and dice" attribute set |

**Retention:** `place_id` may be stored indefinitely (see the join problem
below). Lat/lng may be cached up to 30 days. **Everything else is
request-scoped and must not be written to the database.** This is enforced in
code, not by convention — see §8.

**Attribution:** "Powered by Google" on any surface showing Google content;
reviewer name, avatar, and link shown unmodified alongside any review.

### Layer 3 — Preference & history (100% ours, no restrictions)

The actual product. None of this is Google content, so none of the above
applies.

- **Visits** — place, date, attendees, who chose it, occasion.
- **Explicit signal** — rating, "never again", "special occasion only",
  "great patio", saved lists.
- **Implicit signal** — surfaced-but-skipped counts, detail views, reroll-aways.
- **Per-person and per-group profiles.** A meal has attendees; preferences
  resolve against whoever is actually present.

### The join problem (important)

Layer 1 and Layer 2 must be linked, and Overture POIs do not carry Google place
IDs. Resolution is **lazy and amortized**:

1. The first time a catalog place enters any user's shortlist, call Google Text
   Search with its name + coordinates to resolve a `place_id`.
2. Store that `place_id` permanently on the catalog row (legal, and the only
   Google field we may keep).
3. All subsequent hydrations for that place — for every user, forever — are a
   direct Place Details lookup with no resolution step.

Resolution cost is therefore paid once per place across the entire user base,
not once per user per query. Unresolvable places are flagged and fall back to
catalog-only display.

---

## 5. Cost model — the primary engineering risk

Google Enterprise-tier SKUs are the only variable cost that scales with usage,
and they are expensive enough to sink the product if hydration is careless.

**Reference prices (first 100k calls/month):** Nearby Search Enterprise
$35/1k · Place Details Enterprise $20/1k · Place Details Enterprise+Atmosphere
$25/1k. Free allowance is 1,000 calls per Enterprise SKU per month.

**Naive design** (every search hits Google): 10k users × 8 sessions × ~6 calls
≈ 480k calls/month ≈ **~$13k/month**.

**Three-layer design:** filtering is free (Layer 1). Google is touched only on
shortlist render, detail view, and Surprise Me confirmation.

Mandatory controls:

- **No Google call on browse or filter.** Ever. Filtering is a PostGIS query.
- **Batch hydration.** One edge-function call hydrates the whole shortlist and
  fans out server-side.
- **Per-user daily call quota,** enforced server-side, with a degraded
  catalog-only mode when exceeded.
- **Hydration budget telemetry** — calls-per-session tracked as a first-class
  metric from day one, with alerting on regression.
- **The flywheel.** Once users rate places in-app, we own a rating signal that
  is free forever. Over time this displaces Google dependence for
  frequently-surfaced places. Design the ranking function so that in-app
  signal can progressively outweigh Google's.

---

## 6. Feature set

### 5.1 Filter & shortlist (the workhorse)

Filters, all served from Layer 1 except where noted:

- Cuisine (multi-select, include **and** exclude)
- Distance (miles, from current location or a saved anchor like home/work)
- Price level *(Layer 2 — see note)*
- Minimum rating *(Layer 2 — see note)*
- Open now *(Layer 2)*
- Features: outdoor seating, good for groups, kid-friendly, reservable,
  vegetarian options, cocktails *(Layer 2)*
- Novelty: "somewhere we haven't been" *(Layer 3)*
- Exclude vetoed places *(Layer 3)*

**Note on Layer 2 filters:** rating, price, and open-now cannot be filtered
before hydration because we don't hold that data. The pattern is:
Layer 1 + Layer 3 narrow to ~25 candidates → hydrate → apply Layer 2 filters →
render top 10. Hydration of 25 is the cost ceiling per session and must be
tuned against real usage. If it proves too expensive, narrow harder in Layer 1
first (tighter radius, stricter cuisine match) rather than raising the budget.

### 5.2 Surprise Me

Guardrails the user sets: rating floor, max distance, cuisine include/exclude,
price ceiling, open now, "new places only."

**Selection is weighted-random, not argmax.** A deterministic best-match
returns the same answer every time and defeats the purpose.

```
weight = match_score × novelty_boost × recency_penalty × veto_gate
```

- `match_score` — fit against the resolved attendee preference profile
- `novelty_boost` — unvisited places favored; higher when the user opts into
  "somewhere new"
- `recency_penalty` — exponential decay on days-since-last-visit, so recent
  picks sink. **This is the direct counter to the rut.**
- `veto_gate` — hard zero for "never again" and active excludes

Sample from the weighted distribution, hydrate the winner only (1 Google call),
verify it is open and still meets the rating floor, reveal.

**Rerolls are capped at 3.** After that the choice stands or the user returns
to the shortlist. Deliberate friction.

### 5.3 Group decisions

Differentiator, retention hook, and the thing Google structurally cannot do.

- Start a meal → invite attendees (link or in-app)
- App generates a joint shortlist of ~8 using the union of attendee profiles
- Each person swipes yes/no privately
- Highest joint score wins; ties broken by whoever has been overruled most
  recently (a fairness ledger)

### 5.4 History

Every visit logged, browsable, filterable. Doubles as the training data for
Layer 3 and as the thing that makes the app feel personal within two weeks.

### 5.5 Natural-language entry

"Somewhere light, not Mexican, we haven't tried, within 20 minutes" → parsed
into structured filters via Claude (routed through a server-side proxy,
mirroring RanchIQ's `anthropic-proxy` pattern). Falls back to the filter sheet
on low confidence. **Nice-to-have, not Phase 1.**

---

## 7. Screens

1. **Home** — "Where to tonight?" Large Surprise Me affordance, recent visits,
   saved lists, quick-filter chips.
2. **Filter sheet** — the full narrowing UI.
3. **Shortlist** — ≤10 hydrated cards: name, cuisine, rating, price, distance,
   open/closed, your group's history badge.
4. **Place detail** — Google-attributed live data plus *your* layer: last
   visit, who liked it, your notes.
5. **Surprise reveal** — single pick, reroll counter, "lock it in."
6. **Group session** — invite, swipe, result.
7. **History** — chronological and by-place.
8. **Profile** — preferences, vetoes, saved anchors, household members.

---

## 8. Technical stack

| Concern | Choice | Rationale |
|---|---|---|
| App | React Native + Expo, EAS builds | True single codebase for iOS + Android; known quantity from RanchIQ |
| Backend | Supabase (Postgres + PostGIS, Auth, RLS) | Geospatial queries are the core workload; RLS handles multi-tenancy |
| Server logic | Supabase Edge Functions | Keeps the Google key server-side and is where quota enforcement lives |
| Client data | TanStack Query | **Departure from RanchIQ: no PowerSync.** Offline-first is not a requirement for a connected dining decision, and PowerSync's conflict-resolution complexity buys nothing here |
| AI | Claude via server-side proxy | NL query parsing; offline cuisine-taxonomy mapping |

### Edge functions

- **`places-proxy`** — the *only* path to Google. Holds the API key, enforces
  per-user quota, batches shortlist hydration, strips non-persistable fields
  from anything returned to the client. Never ship a Maps key in the app
  bundle.
- **`catalog-search`** — PostGIS radius + filter query over Layer 1, joined
  against Layer 3 for vetoes and recency.
- **`surprise`** — weighted sampling, single-place hydration, reveal payload.

### Non-persistence enforcement

Because "don't cache Google data" is a legal obligation and not a style
preference, it needs a mechanical guard:

- Google-derived fields are returned from `places-proxy` in a response envelope
  typed distinctly from anything with a database writer.
- The catalog table has **no columns** for rating, review text, price level, or
  hours. Storing them is a schema error, not a code review finding.
- A CI check asserts no migration introduces such columns.

### Cuisine normalization

Overture's category taxonomy is not a cuisine taxonomy. Mapping it to something
users actually filter by ("Italian", "Thai", "barbecue", "new American") is
**the hardest data problem in the project.** Approach: a one-time offline
Claude pass over the distinct category set, producing a reviewed mapping table
that is version-controlled and applied at ingest. Not an at-request LLM call.

---

## 9. Compliance & launch requirements

- **Google attribution** — "Powered by Google" on any Google-content surface;
  reviews displayed unmodified with reviewer name, photo, and link.
- **Open-data attribution** — Overture (CDLA-Permissive) and/or Foursquare OS
  Places (Apache 2.0) credited per their license terms.
- **No Google content persisted** beyond `place_id` (indefinite) and lat/lng
  (30 days).
- **Location permission** with a clear in-context rationale before the OS
  prompt.
- **Privacy policy** covering location, visit history, and group membership.
- **App Store / Play data-safety disclosures** — location and user-content
  collection both apply.
- **Account deletion** flow (App Store requirement for apps with accounts).

---

## 10. Phasing

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Foundation** | Repo scaffold, Supabase project, Overture ingest pipeline for one metro, cuisine mapping table | Catalog queryable by radius + cuisine in <200ms |
| **1 — Shortlist** | Filter sheet, `catalog-search`, `places-proxy` hydration, shortlist UI, place detail | A real "where to eat" query returns 10 good cards under budget |
| **2 — Memory** | Auth, visits, ratings, vetoes, recency decay, Surprise Me | The app's picks measurably differ from Google's ranking |
| **3 — Groups** | Households, meals, swipe rounds, fairness ledger | Two phones reach a joint decision |
| **4 — Scale** | Multi-metro ingest, cost telemetry + alerting, onboarding seed flow, store submission | Hydration calls/session within budget at 100 users |

**Cold start is now a competitive problem, not just a UX one.** A brand-new
user has no history and therefore no edge over Google — and Zest has already
solved this with Plaid transaction import (see §2). Our answer has to be good
enough to not lose the first session, without asking for a bank login:

1. **"Pick 5 places you already love"** during onboarding — fast, zero-trust
   required, and it doubles as a taste-calibration exercise.
2. **Google Maps Timeline / saved-list import.** A user-consented takeout
   import of their own location history or saved places would seed real visit
   history on day one. This is *their* data being imported by *them*, so it is
   not subject to the Places caching restrictions in §4. Investigate the
   current export format and permission flow in Phase 2 — if it works, it
   neutralizes Zest's main structural advantage at a fraction of the
   onboarding friction.
3. **Household inheritance.** The second person to join a household starts with
   the household's accumulated history rather than from zero.

---

## 11. Open risks

1. **Cuisine taxonomy quality** gates the entire filtering value proposition.
   De-risk early in Phase 0 by hand-auditing one metro.
2. **Overture data staleness** — closed restaurants will appear. Google's
   `businessStatus` is the corrective, applied at hydration; permanently-closed
   results are suppressed and flagged back to the catalog.
3. **Hydration cost at scale** — the shortlist-of-25 pattern is the main lever.
   Instrument from the first hydration call, not after launch.
4. **Google ToS change risk** — pricing and caching terms have moved before.
   The three-layer split is itself the hedge: Layers 1 and 3 survive any
   Google change, and Layer 2 is replaceable (Yelp Fusion, Foursquare,
   TripAdvisor) behind the `places-proxy` interface. Keep that interface
   provider-agnostic.
5. **Two-sided cold start for groups** — group features need both people to
   install. Single-player value must stand alone first, which is why groups
   are Phase 3.
6. **A funded competitor with better cold-start data.** Zest has money, press,
   and a zero-effort history import. Our hedge is that their signal is
   structurally blind to enjoyment and actively reinforces the rut (§2). That
   advantage only holds if the recency-decay and explicit-rating mechanics are
   genuinely good, so they are Phase 2 scope, not a later polish item. If the
   Google Timeline import proves viable, prioritize it — it closes their one
   real lead.
