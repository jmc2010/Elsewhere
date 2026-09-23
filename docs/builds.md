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

## Over-the-air updates

Configured. `expo-updates` is installed, `app.json` carries the update URL,
and each build profile declares a channel — without a channel a build
subscribes to nothing and can never receive an update.

**Any build made BEFORE this was added cannot receive updates.** The binary
has to contain `expo-updates`, so one more build is required; after that, JS
changes ship in seconds:

```bash
npx eas update --branch preview --message "what changed"
```

The app picks it up on next launch. `fallbackToCacheTimeout: 0` makes it wait
for the update rather than running yesterday's code for one launch — the
bundle is local, so it costs a few hundred milliseconds, and a decision app
silently running stale code is worse.

**`runtimeVersion` is `appVersion` policy**, so an update only reaches builds
whose native layer matches. That is what stops JS being shipped that calls a
native module the installed binary does not have.

### What OTA cannot do

Native changes still need a rebuild: a new native module, anything in
`app.json` affecting the manifest or entitlements, an SDK upgrade. Everything
in this project since the initial scaffold would have been OTA-able.

## Still Expo Go for desk work

```bash
npx expo start            # same Wi-Fi
npx expo start --tunnel   # anywhere, slower
```


## Why `web.output` is `single`, not `static`

`eas update` exports **every platform**, web included. With the template's
default `"output": "static"`, Expo server-renders each route in Node at export
time — and this app cannot be server-rendered: `supabase-js` restores its
session through AsyncStorage, which touches `window`, and Node has none. The
whole update fails with:

```
ReferenceError: window is not defined
```

We do not ship web. `"single"` emits a plain SPA shell with no server render,
which keeps `npx expo start --web` usable for a quick look and removes the
class of failure entirely. It affects web bundling only — no rebuild needed.

If web ever becomes a target, the fix is to guard the Supabase client's
storage for server rendering rather than to switch `output` back.


## 1.0.1 — expo-notifications, 2026-09-22

**This release needs a NEW APK. It cannot ship over the air.**

`expo-notifications` is a native module, added for the review prompt (spec
§4). New native code means a new binary, and `runtimeVersion` follows
`version`, so the app version went 1.0.0 -> 1.0.1 deliberately.

That bump is not bookkeeping — it is a safety interlock. Had the version
stayed at 1.0.0, the new JS bundle would have been served to the OLD APK,
which has no notifications module compiled in, and it would have crashed on
launch at the import. Bumping the version means the old build stops matching
these updates and keeps running the last bundle that suits it.

```bash
npx eas build -p android --profile preview
```

Install the resulting APK. Updates published after this point target runtime
1.0.1 and will not reach the 1.0.0 build.
