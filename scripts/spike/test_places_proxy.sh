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
TOKEN=$(curl -s -X POST "$URL/auth/v1/signup" \
  -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d '{}' | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')
if [ -z "$TOKEN" ]; then
  echo "no access_token returned. Is 'Anonymous sign-ins' enabled in" >&2
  echo "Authentication -> Providers?" >&2
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
  | python3 -c '
import sys, json
r = json.load(sys.stdin)
if "error" in r:
    print("ERROR:", r["error"]); sys.exit(1)
q = r.get("quota", {})
print(f"quota   granted={q.get(\"granted\")} used_today={q.get(\"used_today\")}"
      f" limit={q.get(\"daily_limit\")} degraded={q.get(\"degraded\")}")
print(f"attribution: {r.get(\"attribution\")}")
print()
for p in r.get("places", []):
    live = p.get("live") or {}
    bits = []
    if live.get("rating") is not None:
        bits.append(f"{live[\"rating\"]}* ({live.get(\"userRatingCount\")})")
    if live.get("priceLevel"):        bits.append(str(live["priceLevel"]))
    if live.get("businessStatus"):    bits.append(str(live["businessStatus"]))
    print(f"  {p[\"live_status\"]:16} {p[\"name\"][:34]:34} {\"  \".join(bits)}")
print()
ok = sum(1 for p in r.get("places", []) if p["live_status"] == "ok")
print(f"hydrated {ok}/{len(r.get(\"places\", []))}")
print()
print("live_status meanings:")
print("  ok             hydrated")
print("  unresolved     no Google place_id; render catalog-only. ~27% expected.")
print("  quota_exceeded budget ran out mid-batch")
print("  error          the call failed; check function logs")'
