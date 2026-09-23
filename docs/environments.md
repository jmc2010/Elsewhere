# Environments

**Three apps, two databases.** The asymmetry is deliberate.

## Why not three databases

An app tier costs a config line. A database tier costs 54 migrations, a
39,765-row ingest, edge function deploys, secrets and a Google API key. They
are not symmetrical, and treating them as if they were would triple the
expensive half to match the cheap one.

**Data isolation comes free anyway.** The three apps have different package
identifiers, so different anonymous sessions, so different `auth.users` rows.
Preview's junk verdicts land on a preview user and never touch real history.
Row-level isolation falls out of a change that was being made regardless.

**Spend isolation does not come free**, because Google charges the account,
not the row. That is what the tier quota exists for — see below.

**Local exists for the unrecoverable case.** A broken client writes
wrong-but-valid rows that can be deleted; a broken migration has already
dropped the column.

## The tiers

| | development | preview | production |
|---|---|---|---|
| Build | dev client, `expo start` | internal APK / ad-hoc IPA | TestFlight, later the stores |
| Who | just you, on a simulator | just you, on your phones | testers |
| Database | **local** (`supabase start`) | **cloud** | **cloud** |
| Update channel | n/a — Metro serves the bundle | `preview` | `production` |
| Google daily cap | **20** | **20** | 60 (the global default) |
| Badge on screen | yes | yes | **never** |

## What actually changes when you switch tiers

Only three variables, and only two of them ever differ:

| Variable | development | preview | production | Lives in |
|---|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | local, e.g. `http://192.168.1.x:54321` | cloud project | cloud project | `.env` locally; EAS environment for builds |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | local anon key from `supabase start` | cloud publishable key | same as preview | as above |
| `EXPO_PUBLIC_APP_TIER` | `development` | `preview` | `production` | EAS environment (all three set) |

Everything else is identical across tiers. The Google Maps key and the
Anthropic key are **server-side only** and live as Supabase edge function
secrets — they are not per-tier and never appear in a bundle.

**`.env` is for local `expo start` only.** EAS builds read the EAS
environment instead; `.env` is gitignored and never uploaded. That is why all
three EAS environments carry the Supabase values even though development
normally points at local: an `eas build --profile development` has no `.env`
to fall back on, and a build with no Supabase URL **crashes at launch**
rather than degrading. That exact gap cost an evening when the `production`
environment was empty — `src/lib/supabase.ts` throws at module scope, which
happens before any error boundary exists.

## Telling them apart on the device

Development and preview builds show a badge at the top of every screen:

```
PREVIEW · oygsbuailwpjgkqbxllp.supabase.co
DEVELOPMENT · LOCAL 192.168.1.230:54321
```

Never shown in production.

It reports the **host**, not a label, and that is the point. "development"
means two different databases depending on how the app was started: `expo
start` reads `.env` and points at local, while `eas build --profile
development` reads the EAS environment and points at cloud. Both are correct.
Both are called development. That ambiguity is exactly what costs an hour
three months later when data is "missing" and nothing is wrong except which
database you are looking at.

"cloud" and "local" are things somebody decided to call an environment.
`oygsbuailwpjgkqbxllp.supabase.co` is a fact. The badge shows the fact, so
"why is my data not there?" is answered by looking rather than by reasoning
about config.

## The Google spend guard

All three apps share one cloud database and therefore one Google budget. A
dev build left refreshing spends the same money a real user does.

The cap resolves in this order:

1. **Explicit per-user override** (`profiles.daily_google_call_limit`) — set
   by hand, always wins.
2. **Tier default** (`tier_daily_call_limit`) — 20 for development and
   preview, nothing for production.
3. **Global default** (`google_daily_call_limit()`) — 60.

**The tier can only lower the cap, never raise it.** It arrives from the
client, where it could be forged — so the design makes forging pointless.
Claiming `production` gets you 60, which an absent marker would also get you.
There is nothing to gain, so it needs no authentication.

20 is about three sessions: a cold open costs 5 calls and a place detail 1–2,
with a realistic session measured at ~7. Enough to exercise every screen,
nowhere near enough to exhaust a day by leaving a simulator open.

An explicit override still wins outright: a dev account deliberately raised to
2000 stays there even when its build reports `preview`. Overwriting that would
silently undo a decision somebody made on purpose.

## Switching, atomically

```bash
npm run env:cloud     # the default
npm run env:local     # needs `supabase start` running
npm run env:which     # which am I pointing at?
```

Each copies a **whole file** over `.env`. Never hand-edit `.env`, and never
change one line of it: a half-switch — a local URL with a cloud key, or the
reverse — fails as an opaque auth error that looks like nothing at all, and
costs far more time than it should to recognise.

`.env.cloud` and `.env.local` are **committed**, which is safe because both
hold publishable values only. `.env` itself stays gitignored.

Restart Metro with `expo start -c` after switching. Expo inlines
`EXPO_PUBLIC_*` at bundle time, so a running bundler keeps serving the old
values — and the app will look like it ignored you.

## Local database

```bash
supabase start            # first run pulls images; needs Docker
supabase db reset         # migrations from scratch, then supabase/seed.sql
```

Seeded with a **subset**: Valley View (rural, ~23), Gainesville (mid, ~164),
a downtown Dallas slice (dense, ~1,282) — about 1,470 rows. Density is what
the screens branch on, so three density regimes is what development needs.
Regenerate from cloud with `scripts/dev/generate_seed.sh`.

**Requires Docker Desktop.** Note that Homebrew's cask install can fail on a
machine that had Docker before: stale symlinks in `/usr/local/bin` from an
earlier install make brew think binaries are already linked, and it then
rolls the whole install back on an `xattr` step. Installing from Docker's own
`.dmg` avoids that.

If `docker` is not on PATH afterwards (brew's rollback removes its symlinks),
the binary still works from the bundle:

```bash
export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock"
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
```

### Verified from scratch, 2026-09-23

All **55 migrations applied clean in sequence** against an empty database,
followed by the seed. No failures, no ordering problems, no migration
depending on a schema state that only existed briefly. The only errors in the
run were Docker Hub rate-limits during image pulls, which retried.

Result: 1,469 places, 1,342 cuisine links, 109 cuisines, 20 tags, 18 flagged
non-destinations.

Pools at the three density slices: **Valley View 17, Gainesville 160,
downtown Dallas 200** (capped — the dense case truncates, as intended).
`catalog_cuisine_counts` returns 6 groups for Valley View rather than 15,
`catalog_localities` returns Valley View / Gainesville / Dallas,
`derive_display_name` leaves `Estrada's TEX- MEX` alone and cuts
`KFC - Kentucky Fried Chicken` to `KFC`.

Worth noting what the shortlist ordering looked like: 3.9, 2.7, 3.4, 0.2, 0.1
miles. Not distance-sorted — §3 working, with distance gating and the seeded
tiebreak ordering.
