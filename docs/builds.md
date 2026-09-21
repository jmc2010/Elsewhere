# Builds

Expo Go loads JavaScript from Metro on your Mac over the local network. That
is fine at a desk and useless in a car — and Elsewhere's whole premise is that
the decision happens *in the car*, so field testing needs a standalone build.

## One-time setup

```bash
npx eas login          # the Expo account that already has RanchIQ
npx eas init           # links this repo, writes extra.eas.projectId to app.json
```

Then give EAS the two client values. They are **not** in the repo (`.env` is
gitignored) and EAS builds on Expo's servers, so without this step the app
installs and immediately shows "Couldn't connect".

```bash
npx eas env:create preview \
  --name EXPO_PUBLIC_SUPABASE_URL \
  --value 'https://oygsbuailwpjgkqbxllp.supabase.co' \
  --visibility plaintext

npx eas env:create preview \
  --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
  --value 'sb_publishable_...' \
  --visibility plaintext
```

Environment is **positional**, and `create` and `delete` do not agree on flag
names for the same idea — a detail worth writing down because guessing costs a
round trip each time:

```bash
npx eas env:list   preview
npx eas env:create preview --name NAME --value VALUE --visibility plaintext
npx eas env:delete preview --variable-name NAME
```

Run any of them bare to be prompted instead. The dashboard at expo.dev →
project → Environment Variables does the same job without flags, and is the
faster way to see what is actually stored.

`plaintext` is correct here and not a slip. Both values are inlined into the
JS bundle no matter what, because that is what `EXPO_PUBLIC_` means — marking
them secret would imply a protection that does not exist. The publishable key
is safe precisely because RLS does the work.

**The Google Maps key is not here and must never be.** It lives as a Supabase
Edge Function secret and is only ever used by `places-proxy`:

```bash
supabase secrets set GOOGLE_MAPS_API_KEY=AIza...
```

The two are easy to confuse because both are called "API key" and both are
pasted into a dashboard. They are not interchangeable:

| | Source | Starts | Belongs in |
|---|---|---|---|
| Supabase publishable | Supabase → Settings → API | `sb_publishable_` | the app |
| Google Places | Google Cloud Console | `AIza` | an edge function secret, never the app |

Putting the Google key in an `EXPO_PUBLIC_` variable compiles a billable
credential into the APK. If that happens, **rotate the key** — deleting the
variable does not un-ship a build that already has it.

## Preview build — the one to drive around with

```bash
npx eas build --platform android --profile preview
```

Builds on Expo's servers, ~10–20 minutes on the free tier, and produces an
APK. EAS prints a URL and a QR code; open it on the phone and install. No
Mac, no tunnel, no dev server.

Android first is deliberate: its `package` is only locked once you publish to
Play, while `ios.bundleIdentifier` is permanent after the first App Store
submission — so Android is the cheap place to find out whether the
identifiers feel right.

## Identifiers

```
ios.bundleIdentifier  app.goelsewhere.elsewhere
android.package       app.goelsewhere.elsewhere
```

Reverse-DNS of `goelsewhere.app`, the fallback domain the spec targets, and
consistent with the `goelsewhere-app` GCP project.

**Change them now if you are going to.** Both are free to change today. After
the first App Store submission the iOS one is permanent, and it interacts
with two decisions still open in `STATUS.md` — the Apple Individual-vs-entity
question, and trademark clearance against ELSEWHERE.TO LTD. If that
clearance goes badly, an identifier not built on the name is easier to live
with.

## When the JS changes

A preview build has the bundle baked in, so app changes need a rebuild — or
EAS Update, which pushes new JavaScript to an installed build without one.
Worth configuring once field testing becomes a habit; not needed yet.

## Still Expo Go for desk work

```bash
npx expo start            # same Wi-Fi
npx expo start --tunnel   # anywhere, slower
```
