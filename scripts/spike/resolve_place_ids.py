#!/usr/bin/env python3
"""Measure how reliably Overture catalog rows resolve to Google place_ids.

The spec's join strategy (§4, "The join problem") is lazy resolution: the
first time a catalog place enters any shortlist, call Text Search with its
name and coordinates, get a place_id, and store that id forever. Resolution
is then paid once per place across the entire user base.

That has never been tested, and the whole Layer 2 design rests on it. If it
resolves at 95% the spec holds as written. If rural North Texas resolves at
60%, places-proxy needs a fallback path and it is far cheaper to know that
before it is built than after.

The sample is stratified rural vs urban deliberately. Rural is where matching
is hardest AND where the catalog's advantage over Google is largest, so a
single blended hit rate would hide the answer that matters.

This script WRITES NOTHING. It is a measurement. Even place_id -- which we are
permitted to store indefinitely -- is only reported, because persisting it is
promote's job and not a spike's.

Usage:
    export ELSEWHERE_PG_URL='...'
    export GOOGLE_MAPS_API_KEY='...'
    ./resolve_place_ids.py --dry-run      # show the calls, spend nothing
    ./resolve_place_ids.py                # 30 calls, well inside the free tier
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

ENDPOINT = "https://places.googleapis.com/v1/places:searchText"

# Only what the match decision needs. The field mask is what selects the
# billing SKU, so adding fields here costs money -- do not add `rating`,
# `priceLevel` or anything else in the Atmosphere set just to look at it.
FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location"

# Rural first: these are the towns where the spec's assumption is most likely
# to break, and where Elsewhere's catalog beats Google by the widest margin.
RURAL = ("Valley View", "Sanger", "Krum", "Collinsville", "Pilot Point",
         "Gainesville", "Aubrey", "Ponder", "Muenster", "Era")
URBAN = ("Dallas", "Fort Worth", "Plano", "Arlington", "Denton", "Frisco")

# Distance and name are NOT co-equal evidence, and treating them as such was
# wrong in the first run. At a few metres there is no other building, so the
# coordinates settle it and a name disagreement just means the two sources
# disagree about the trading name -- "Bayer's Kolonialwaren" vs "Bayers
# Bakery" in Muenster, 5m apart, is one shop.
#
# Further out the reverse holds: "Tortilleria Mexico" resolved to "Ibarra's
# Tortilleria" 830m away with half its tokens shared. Same kind of business,
# different business. That is the dangerous case, because the wrong place_id
# would be stored permanently and silently.
# Hard search bound. Generous enough to absorb the coordinate disagreement
# between Overture and Google, tight enough that another branch of the same
# chain cannot be inside it.
RESTRICT_M = 2000.0

SAME_BUILDING_M  = 30.0    # coordinates alone settle it
MATCH_DISTANCE_M = 250.0   # beyond this it is a different building
MATCH_NAME_RATIO = 0.55    # token overlap, see name_similarity


def psql(url: str, sql: str) -> list[list[str]]:
    out = subprocess.run(
        ["psql", url, "-tAF", "\x1f", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line.split("\x1f") for line in out.splitlines() if line.strip()]


def sample(url: str, bucket: tuple[str, ...], n: int) -> list[dict]:
    localities = ",".join("'" + b.replace("'", "''") + "'" for b in bucket)
    rows = psql(url, f"""
        select p.name, p.locality, st_y(p.location::geometry),
               st_x(p.location::geometry), coalesce(p.address_line, '')
        from places p
        where p.locality in ({localities})
          and not p.permanently_closed
          and not p.delivery_only
        order by md5(p.id::text)     -- deterministic, not order-of-insert
        limit {int(n)}
    """)
    return [{"name": r[0], "locality": r[1], "lat": float(r[2]),
             "lon": float(r[3]), "address": r[4]} for r in rows]


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def tokens(s: str) -> set[str]:
    # Same spirit as norm_place_name() in the database: strip punctuation,
    # fold case, drop the noise words that differ between data sources.
    noise = {"the", "a", "of", "and", "restaurant", "cafe", "bar", "grill",
             "co", "inc", "llc", "shop", "kitchen"}
    words = re.sub(r"[^a-z0-9]+", " ", s.lower()).split()
    return {w for w in words if w and w not in noise} or set(words)


def name_similarity(a: str, b: str) -> float:
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / min(len(ta), len(tb))


def bounding_rect(lat: float, lon: float, metres: float) -> dict:
    dlat = metres / 111_320.0
    dlon = metres / (111_320.0 * max(math.cos(math.radians(lat)), 0.01))
    return {"rectangle": {
        "low":  {"latitude": lat - dlat, "longitude": lon - dlon},
        "high": {"latitude": lat + dlat, "longitude": lon + dlon},
    }}


DEBUG = False


def text_search(key: str, place: dict, timeout: float = 10.0) -> dict | None:
    query = place["name"]
    if place["locality"]:
        query = f"{query}, {place['locality']}, TX"
    body = json.dumps({
        "textQuery": query,
        "maxResultCount": 1,
        # locationBias, NOT locationRestriction -- measured, see
        # docs/measurements.md. Bias is advisory and will return results far
        # outside the circle, so the returned coordinates must be validated
        # client-side in classify(). But the restriction was tried and is
        # worse: it lost four correct matches (Bless That Jerk and Chester's
        # Chicken went to no_result; Stiletto Kitchen and Stiff Peaks were
        # replaced by different businesses inside the box) and still needed
        # the same validation, because it also returned wrong businesses
        # within 2km. 22/30 with bias + validation against 20/30 with the
        # restriction.
        "locationBias": {"circle": {
            "center": {"latitude": place["lat"], "longitude": place["lon"]},
            "radius": RESTRICT_M,
        }},
    }).encode()
    if DEBUG:
        print("\n--- REQUEST ---")
        print(json.dumps(json.loads(body), indent=2))
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": FIELD_MASK,
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        return {"_error": f"HTTP {e.code}: {detail}"}
    except Exception as e:                                  # noqa: BLE001
        return {"_error": f"{type(e).__name__}: {e}"}
    if DEBUG:
        print("--- RESPONSE ---")
        print(json.dumps(payload, indent=2))
    hits = payload.get("places") or []
    return hits[0] if hits else None


def classify(place: dict, hit: dict | None) -> tuple[str, str]:
    if hit is None:
        return "no_result", "Google returned nothing"
    if "_error" in hit:
        return "error", hit["_error"]
    loc = hit.get("location") or {}
    dist = haversine_m(place["lat"], place["lon"],
                       loc.get("latitude", 0.0), loc.get("longitude", 0.0))
    gname = (hit.get("displayName") or {}).get("text", "")
    sim = name_similarity(place["name"], gname)
    detail = f"{dist:6.0f}m  name~{sim:.2f}  → {gname}"
    if dist <= SAME_BUILDING_M:
        # Same building. Report the name divergence so it can be eyeballed,
        # but this is a resolution, not a failure.
        return ("match" if sim >= MATCH_NAME_RATIO else "match_name_differs"), detail
    if dist <= MATCH_DISTANCE_M and sim >= MATCH_NAME_RATIO:
        return "match", detail
    if dist <= MATCH_DISTANCE_M:
        return "same_place_different_name", detail
    if sim >= MATCH_NAME_RATIO:
        return "same_name_different_place", detail
    return "mismatch", detail


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--rural", type=int, default=20)
    ap.add_argument("--urban", type=int, default=10)
    ap.add_argument("--only", metavar="SUBSTR",
                    help="restrict the sample to places whose name contains this")
    ap.add_argument("--debug", action="store_true",
                    help="dump the raw request and response for each call")
    ap.add_argument("--dry-run", action="store_true",
                    help="list the calls that would be made; spend nothing")
    args = ap.parse_args()

    total = args.rural + args.urban
    if total > 200:
        print(f"refusing {total} calls: the free tier is 1,000/SKU/month and a "
              f"spike should not eat it", file=sys.stderr)
        return 2

    pg = os.environ.get("ELSEWHERE_PG_URL")
    if not pg:
        print("set ELSEWHERE_PG_URL", file=sys.stderr)
        return 2
    key = os.environ.get("GOOGLE_MAPS_API_KEY")
    if not key and not args.dry_run:
        print("set GOOGLE_MAPS_API_KEY (or pass --dry-run)", file=sys.stderr)
        return 2

    global DEBUG
    DEBUG = args.debug

    buckets = [("rural", sample(pg, RURAL, args.rural)),
               ("urban", sample(pg, URBAN, args.urban))]
    if args.only:
        needle = args.only.lower()
        buckets = [(lbl, [p for p in ps if needle in p["name"].lower()])
                   for lbl, ps in buckets]

    if args.dry_run:
        for label, places in buckets:
            print(f"\n{label}: {len(places)} calls")
            for p in places:
                print(f"  {p['name']!r} near {p['locality']} "
                      f"({p['lat']:.4f}, {p['lon']:.4f})")
        print(f"\ntotal calls that WOULD be made: "
              f"{sum(len(p) for _, p in buckets)}")
        return 0

    overall: dict[str, int] = {}
    for label, places in buckets:
        counts: dict[str, int] = {}
        print(f"\n=== {label} ({len(places)}) " + "=" * 40)
        for p in places:
            verdict, detail = classify(p, text_search(key, p))
            counts[verdict] = counts.get(verdict, 0) + 1
            overall[verdict] = overall.get(verdict, 0) + 1
            flag = " " if verdict == "match" else "!"
            print(f" {flag} {verdict:26} {p['name'][:34]:34} {detail}")
        hits = counts.get("match", 0) + counts.get("match_name_differs", 0)
        print(f" --> {label} hit rate: {hits}/{len(places)} "
              f"({100.0 * hits / max(len(places), 1):.0f}%)")

    n = sum(overall.values())
    print("\n" + "=" * 60)
    for k, v in sorted(overall.items(), key=lambda kv: -kv[1]):
        print(f"  {k:28} {v:4}  ({100.0 * v / max(n, 1):.0f}%)")
    hit = overall.get("match", 0) + overall.get("match_name_differs", 0)
    print(f"\nOVERALL RESOLUTION RATE: {hit}/{n} "
          f"({100.0 * hit / max(n, 1):.0f}%)")
    print("\nspec §4 assumes this is high enough that unresolvable places are a")
    print("flagged edge case. Below ~85% and places-proxy needs a real fallback.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
