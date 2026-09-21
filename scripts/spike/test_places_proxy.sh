#!/usr/bin/env bash
#
# Exercise a deployed places-proxy end to end, without the app.
#
# Signs in anonymously to get a real user JWT (the function requires one --
# the quota is per user, so an unauthenticated request has nothing to charge),
# picks a few places out of the catalog via catalog_search, and hydrates them.
#
# Costs Google calls. A place needing resolution costs 2 (searchText +
# details); an already-resolved one costs 1. Default 3 places, so at most 6.
#
# Usage:
#   export EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
#   export EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
#   ./test_places_proxy.sh [count]

set -euo pipefail

URL="${EXPO_PUBLIC_SUPABASE_URL:?set EXPO_PUBLIC_SUPABASE_URL}"
KEY="${EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY}"
COUNT="${1:-3}"

# Valley View, TX.
LAT=33.4937
LON=-97.1614

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1. anonymous sign-in"
# supabase-js signInAnonymously() posts to /auth/v1/signup with an empty body.
AUTH=$(curl -s -X POST "$URL/auth/v1/signup" \
  -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}')
TOKEN=$(printf '%s' "$AUTH" | python3 -c 'import sys,json
try:
    print(json.load(sys.stdin).get("access_token","") or "")
except Exception:
    print("")')
if [ -z "$TOKEN" ]; then
  echo "no access_token returned. Supabase said:" >&2
  printf '%s\n' "$AUTH" | head -c 600 >&2
  echo >&2
  echo "If it mentions anonymous sign-ins being disabled, enable them at" >&2
  echo "Authentication -> Sign In / Providers." >&2
  exit 1
fi
echo "   got a user token"

say "2. catalog_search -> candidate place_ids (no Google call)"
IDS=$(curl -s -X POST "$URL/rest/v1/rpc/catalog_search" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"p_lat\":$LAT,\"p_lon\":$LON,\"p_radius_meters\":32187,\"p_limit\":$COUNT}" \
  | python3 -c '
import sys, json
rows = json.load(sys.stdin)
if not isinstance(rows, list):
    print("ERROR:", rows, file=sys.stderr); sys.exit(1)
for r in rows:
    print(r["place_id"], "|", r["name"], file=sys.stderr)
print(json.dumps([r["place_id"] for r in rows]))')

say "3. places-proxy hydrate (THIS SPENDS GOOGLE CALLS)"
curl -s -X POST "$URL/functions/v1/places-proxy" \
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"hydrate\",\"session_id\":\"test-$(date +%s)\",\"place_ids\":$IDS}" \
  | "$(dirname "$0")/_render_hydrate.py"
