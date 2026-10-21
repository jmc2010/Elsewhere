# What leaves the device

Source material for the privacy statement and the App Store / Play Console
data-safety answers. Audited 2026-09-23 against the 26 direct dependencies in
`package.json` and every network destination reachable from `src/`.

Re-audit this file when a dependency with network behaviour is added. The
mechanical check is `grep -rn "source={{ uri" src/` plus the destination list
below — a new remote image host is the easiest way to acquire an undisclosed
third-party recipient without noticing.

## Analytics and crash reporting: none

Searched the direct dependencies *and* the whole of `node_modules` for Sentry,
Bugsnag, Firebase, Crashlytics, Amplitude, Mixpanel, Segment, PostHog,
Datadog, AppsFlyer, OneSignal and LogRocket. None are present at any depth, so
none can be enabled by configuration. There is no SDK in the bundle capable of
reporting a crash, a screen view, or a session.

The app therefore collects no usage analytics whatsoever. Nothing needs to be
disclosed under "Analytics" or "Diagnostics" — including on Apple's form,
where crash data counts as collection even when it is only sent to the
developer.

## The four destinations that receive data from the device

### 1. Our own Supabase project — the only recipient of user content

`@supabase/supabase-js`, over HTTPS. Carries:

- **Anonymous auth.** A generated user id and a JWT. No email, phone, name or
  social identity is ever requested; the account is not recoverable and is not
  tied to a person.
- **Precise location, as a query parameter.** `catalog_search` takes `p_lat` /
  `p_lon`. It is *transmitted* on every shortlist build and it is **not
  stored** — the function is `stable` and writes nothing, and while a
  `profiles.home_point` column exists in the schema, the app never writes to
  it. Verified: the only client writes are verdicts, visits, confirmations,
  lock-ins, corrections and tags.
- **Layer 3 content.** Verdicts (`again` / `maybe` / `not_again`), free-text
  notes, visit dates, corrections, chosen places. This is the sensitive
  material; it is ours, stays ours, and is protected by RLS.
- **Hydration requests.** `place_id` lists, a session id, the app tier.

#### Is the location in any retained log? Tested, not assumed.

This decides the form answer, so it was verified empirically on 2026-09-23
rather than reasoned about. A `catalog_search` call was made over PostgREST
with sentinel coordinates `33.1234567 / -97.7654321`, twice — once succeeding,
once deliberately raising — and every log surface was then swept for that
string.

**Result: zero occurrences, in all twelve containers**, including Postgres,
the Kong gateway, PostgREST, the edge runtime, and the Logflare analytics
pipeline that Supabase Cloud uses for its own log ingestion.

The reason is structural, which is why it is trustworthy rather than lucky.
All three coordinate-carrying calls are `supabase.rpc(...)`, which is a **POST
with the values in the JSON body** — never a query string. PostgREST then
passes that entire body to Postgres as a **single bind parameter**, so the SQL
text contains `$1`, not the numbers.

The erroring call proves it under the one condition that does log SQL. Postgres
ships with `log_min_error_statement = error`, so a statement that raises gets
its text written to the log — and it did:

```
ERROR:  p_limit must be between 1 and 1000 (got 9999)
STATEMENT:  WITH pgrst_source AS (SELECT "pgrst_call".* FROM
            (SELECT $1 AS json_data) pgrst_payload, LATERAL ...
```

`$1 AS json_data`. The coordinates were in that parameter and they are not in
the log, because `log_parameter_max_length_on_error = 0` suppresses bind
values. `pg_stat_statements` likewise holds the normalised text with no
literals — searched, zero hits.

The gateway logs method, path, status and bytes, never bodies:

```
"POST /rest/v1/rpc/catalog_search HTTP/1.1" 200 2
```

Settings read from the running instance:

| Setting | Value | Consequence |
|---|---|---|
| `log_statement` | `ddl` | ordinary SELECTs are never logged |
| `log_min_duration_statement` | `-1` | no slow-query logging, so no path that logs params |
| `log_min_error_statement` | `error` | erroring statements ARE logged — text only |
| `log_parameter_max_length_on_error` | `0` | bind values suppressed on error |
| `log_parameter_max_length` | `-1` | would log in full, but only for statements `log_statement` selects — and it selects none |

**The caveat, stated plainly.** Those settings were read from the *local*
instance. It runs the same `supabase/postgres` image with stock configuration,
so the cloud project is expected to match, but a compliance answer should not
rest on an expectation. Confirm on the cloud project in the SQL editor:

```sql
select name, setting from pg_settings where name in (
  'log_statement', 'log_min_duration_statement',
  'log_parameter_max_length', 'log_parameter_max_length_on_error');
```

Only two values could overturn this: `log_statement` set to `all` or `mod`, or
`log_min_duration_statement` set to a non-negative number. Either would start
logging the statements *and* their bind parameters, putting precise
coordinates into a retained log and making the "not collected" answer wrong.
Neither is a Supabase default and neither was set by us.

**What the gateway does retain is the IP address.** Not precise location and
not what Apple means by it, but it is an identifier, it is linked to a request
timeline, and it is retained for whatever the plan's log-retention window is
(1 day on Free, 7 on Pro, visible in the dashboard). Worth answering honestly
under Identifiers rather than discovering later.

### 2. `u.expo.dev` — EAS Update

`expo-updates`, configured in `app.json`. Contacts Expo's CDN at launch to ask
whether a newer JS bundle exists for this runtime version and channel. The
request carries the platform, the runtime version, the channel, the project id
and an installation id generated by the library. No user content and no
location. This is the one recipient the user does not initiate and cannot see.

### 3. Google's image CDN — the only direct device→third-party call

`src/app/place/[id].tsx:379` renders a Google reviewer's avatar through
`expo-image`:

```
<Image source={{ uri: r.authorAttribution.photoUri }} />
```

That is a request from the **user's device** to a Google-hosted URL, so
Google receives the device's **IP address and user-agent** — tied to viewing
a specific restaurant, at a specific moment. It carries no account identifier
and no location, but it is real third-party collection and it is the one item
here that is disclosable as such.

**Ruled 2026-09-23: this stays exactly as it is. Do not proxy it, do not drop
it.** The avatar is not the optional part of attribution — Google's policy
names it as the floor: *for reviews, if space is limited, the minimum
requirement is to display the author's avatar.* Dropping it to avoid a
disclosure would trade a privacy line-item for a licence violation.

Proxying it server-side is out for a separate reason: Google prohibits
pre-fetching and caching their content, so a caching proxy breaks the licence,
and a non-caching one pays bandwidth on every render while interposing our
server in the middle of Google's own CDN path — cost and a failure mode, for
no licence benefit.

So this is disclosed, not engineered away. The App Privacy answer names Google
as a third party receiving an identifier (IP address). Anyone later proposing
to "simplify" the detail screen by dropping avatars should read this paragraph
first.

### 4. Apps the user explicitly opens

`Linking.openURL` for `tel:` (Call), `https://maps.google.com/?q=lat,lon`
(Directions), the place's own website, and the reviewer's Google profile. Each
is a deliberate tap that hands off to the dialer or browser. The coordinates in
the maps URL are the **restaurant's**, not the user's.

## What the server does — not the device

`places-proxy` (an edge function) is the only thing that talks to
`places.googleapis.com`, and two properties of it matter for the statement:

- **Google never receives the user's identity.** The proxy forwards a
  `place_id` and holds the API key server-side. There is no Google SDK in the
  app bundle and no key in it either.
- **Google never receives the user's location.** The resolution call's
  `locationBias.circle.center` is the **place's** catalog coordinates, from
  Overture — not the device fix. Verified at
  `supabase/functions/places-proxy/index.ts:218`.

So the user's position reaches our backend and stops there.

## Local-only, despite appearances

- **`expo-notifications`** — local notifications only. `getExpoPushToken` is
  never called, no token is registered, nothing reaches Expo's push service.
  The review prompt is scheduled on the device and fires on the device.
- **`expo-location`** — reads the fix. Transmission is our own code's doing
  (see #1), not the library's.
- **`@react-native-async-storage/async-storage`** — on-device only. Holds the
  Supabase session, `elsewhere.theme.v1`, `elsewhere.reviewPrompt.*` and
  `elsewhere.notifications.asked.v1`.
- **`expo-constants`, `expo-device`** — read local values. Not imported by
  `src/` at all; present as transitive dependencies.
- **`expo-font`** — loads the bundled static instances from the app package.
  No Google Fonts, no network.
- **`react-native-web`** — not used in shipped iOS/Android builds.
- Everything else (`expo-router`, `react-query`, `reanimated`, `worklets`,
  `gesture-handler`, `safe-area-context`, `screens`, `status-bar`,
  `system-ui`, `splash-screen`, `url-polyfill`, `expo-image` as a renderer)
  has no network behaviour of its own.

## Expo's own telemetry — developer machine, not the app

The Expo and EAS CLIs collect anonymous usage telemetry when commands are run
on a **developer machine** at build time. It is not in the shipped app, it
reports nothing about users, and it belongs in no user-facing privacy
statement. `EXPO_NO_TELEMETRY=1` disables it; it is currently not set either
way.

## The short version, for the statement itself

The app has no account, no analytics, no crash reporting, no advertising and
no push tokens. Location is used to find nearby places and is sent only to our
own backend, where it is not retained. The only data about a person that is
stored is what they tell the app about places they have been. One third party
— Google — sees the device's IP address, and only when a place's detail screen
shows a reviewer's avatar.

## The recurring Supabase RLS advisor email — assessed, no action

Supabase emails "a table is publicly accessible because Row-Level Security is
not enabled" for this project. Investigated 2026-10-20. **It is a false
positive and there is nothing to do.**

The table is `public.spatial_ref_sys` — PostGIS's own catalogue of EPSG
coordinate-reference-system definitions. It is the only table in `public`
without RLS. It holds no user data of any kind; it is published reference data
that ships with the extension.

Three things were established rather than assumed:

1. **It cannot be fixed.** The table is owned by `supabase_admin`.
   `alter table ... enable row level security` fails with *must be owner of
   table spatial_ref_sys*, and `revoke` reports *no privileges could be
   revoked* — on local and on cloud. PostGIS is installed into the `public`
   schema, which is why its tables are linted at all, and relocating PostGIS
   after the fact is not supported.

2. **The grants look alarming and are not.** `anon` and `authenticated` both
   hold `arwdDxtm` — all privileges, including DELETE — and PostgREST does
   expose the table, so an anonymous caller holding the publishable key can
   read it and in principle write to it.

3. **The worst case does nothing.** Tested on local inside a transaction:
   with SRID 4326 deleted outright, `catalog_search` still returned its 15
   rows and `catalog_localities` its towns. PostGIS uses WGS84 constants for
   the `geography` type rather than consulting the table, and this codebase
   uses nothing else — no `ST_Transform`, no non-4326 SRIDs. Rolled back.

So the exposure is public data, unfixable by us, and inert if vandalised.
Dismiss the advisor in the dashboard. If it ever matters, it is a support
request to Supabase, not a migration.

**What the same check DID confirm is healthy:** no policy anywhere grants
`anon` or `public` access to user data, and `brand_cuisine_map`,
`google_api_usage`, `name_cuisine_map` and `overture_staging` have RLS enabled
with zero policies — deny-by-default, reachable only by `service_role`, which
is correct for tables only the edge function and ingest touch.

