#!/usr/bin/env python3
"""Explain why places-proxy could not resolve one place.

Replicates the function's exact Text Search request for a single catalog row,
then shows Google's answer and the validation arithmetic that accepted or
rejected it. The proxy deliberately returns only `unresolved` -- it will not
put Google content in a response envelope just to help debugging -- so this
exists to answer the question without loosening that.

    export ELSEWHERE_PG_URL=...
    export GOOGLE_MAPS_API_KEY=...
    ./why_unresolved.py <place-uuid>

Costs exactly one Text Search call.
"""
import json
import math
import os
import re
import subprocess
import sys
import urllib.request

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"
MASK = "places.id,places.displayName,places.location,places.formattedAddress"

# Must mirror places-proxy exactly, or this explains a request nobody makes.
BIAS_RADIUS_M = 2000
SAME_BUILDING_M = 30
MAX_DISTANCE_M = 250
MIN_NAME_SIMILARITY = 0.55
NOISE = {"the", "a", "of", "and", "restaurant", "cafe", "bar", "grill",
         "co", "inc", "llc", "shop", "kitchen"}


def tokens(s):
    words = re.sub(r"[^a-z0-9]+", " ", s.lower()).split()
    kept = [w for w in words if w not in NOISE]
    return set(kept or words)


def similarity(a, b):
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * r * math.asin(math.sqrt(a))


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    place_id = sys.argv[1]
    pg = os.environ["ELSEWHERE_PG_URL"]
    key = os.environ["GOOGLE_MAPS_API_KEY"]

    row = subprocess.run(
        ["psql", pg, "-tAF", "\x1f", "-c", f"""
          select p.name, coalesce(p.locality,''), coalesce(p.region,''),
                 st_y(p.location::geometry), st_x(p.location::geometry),
                 p.colocated_count, coalesce(p.google_place_id,''),
                 p.google_resolution_failed
          from places p where p.id = '{place_id}'
        """], capture_output=True, text=True, check=True).stdout.strip()
    if not row:
        print("no such place")
        return 1
    name, loc, region, lat, lon, colo, gid, failed = row.split("\x1f")
    lat, lon, colo = float(lat), float(lon), int(colo)

    print(f"catalog   {name!r}")
    print(f"          {loc}, {region}  ({lat:.5f}, {lon:.5f})")
    print(f"          colocated_count={colo}  "
          f"google_place_id={gid or '(none)'}  failed={failed}")

    locality = ", ".join(x for x in (loc, region) if x)
    query = f"{name}, {locality}" if locality else name
    print(f"\nquery     {query!r}")

    body = json.dumps({
        "textQuery": query,
        "maxResultCount": 1,
        "locationBias": {"circle": {
            "center": {"latitude": lat, "longitude": lon},
            "radius": float(BIAS_RADIUS_M)}},
    }).encode()
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": MASK,
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        payload = json.load(resp)

    hits = payload.get("places") or []
    if not hits:
        print("\nGoogle returned NOTHING. unresolved is correct: it has no "
              "listing matching that query inside the bias.")
        return 0

    hit = hits[0]
    gname = (hit.get("displayName") or {}).get("text", "")
    gloc = hit.get("location") or {}
    d = haversine_m(lat, lon, gloc.get("latitude", 0), gloc.get("longitude", 0))
    sim = similarity(name, gname)

    print(f"\nGoogle    {gname!r}")
    print(f"          {hit.get('formattedAddress','')}")
    print(f"          {d:.0f}m away, name similarity {sim:.2f}")
    print(f"          tokens {sorted(tokens(name))} vs {sorted(tokens(gname))}")

    print("\nvalidation")
    same_building = d <= SAME_BUILDING_M
    print(f"  distance <= {SAME_BUILDING_M}m           {same_building}")
    print(f"  colocated_count == 0          {colo == 0}")
    if same_building and colo == 0:
        print("  -> ACCEPT (same building, nothing else shares the address)")
        return 0
    if same_building and colo:
        print("  -> name-free pass DENIED: address is shared, so proximity "
              "alone could be a neighbour or a successor")
    if d > MAX_DISTANCE_M:
        print(f"  distance <= {MAX_DISTANCE_M}m          False")
        print("  -> REJECT (too far)")
        return 0
    print(f"  distance <= {MAX_DISTANCE_M}m          True")
    print(f"  name similarity >= {MIN_NAME_SIMILARITY}   {sim >= MIN_NAME_SIMILARITY} ({sim:.2f})")
    print("  -> " + ("ACCEPT" if sim >= MIN_NAME_SIMILARITY else "REJECT (name)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
