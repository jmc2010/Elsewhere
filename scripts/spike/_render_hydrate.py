#!/usr/bin/env python3
"""Render a places-proxy hydrate response. Reads JSON on stdin.

Kept in its own file rather than inline in the shell script: escaping quotes
through a shell single-quoted `python3 -c` and then again inside an f-string
is how the first version got a SyntaxError after already spending the Google
calls.
"""
import json
import sys

r = json.load(sys.stdin)

if "error" in r:
    print("ERROR:", r["error"])
    sys.exit(1)

q = r.get("quota", {})
print("quota   granted={} used_today={} limit={} degraded={}".format(
    q.get("granted"), q.get("used_today"), q.get("daily_limit"),
    q.get("degraded")))
print("attribution:", r.get("attribution"))
print()

places = r.get("places", [])
for p in places:
    live = p.get("live") or {}
    bits = []
    if live.get("rating") is not None:
        bits.append("{}* ({})".format(live["rating"], live.get("userRatingCount")))
    if live.get("priceLevel"):
        bits.append(str(live["priceLevel"]))
    if live.get("businessStatus"):
        bits.append(str(live["businessStatus"]))
    if live.get("regularOpeningHours", {}).get("openNow") is not None:
        bits.append("open" if live["regularOpeningHours"]["openNow"] else "closed")
    print("  {:16} {:34} {}".format(
        p.get("live_status", "?"), p.get("name", "")[:34], "  ".join(bits)))

ok = sum(1 for p in places if p.get("live_status") == "ok")
print()
print("hydrated {}/{}".format(ok, len(places)))
print()
print("live_status meanings:")
print("  ok             hydrated")
print("  unresolved     no Google place_id; render catalog-only. ~27% expected.")
print("  quota_exceeded budget ran out mid-batch")
print("  error          the call failed; see: supabase functions logs places-proxy")
