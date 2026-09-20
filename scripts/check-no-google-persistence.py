#!/usr/bin/env python3
"""Fail if a migration adds a column that would persist Google Places content.

Storing Google Places content beyond `place_id` (indefinite) and coordinates
(30 days) violates the Google Maps Platform Terms. The `places` catalog table
is the one place such a column would plausibly be added by accident, so this
check scopes to it rather than banning the words outright -- our own
`place_ratings.rating` is legitimate Layer 3 data and must keep working.

See CLAUDE.md. Do not weaken this to make a migration pass.
"""
import pathlib
import re
import sys

FORBIDDEN = {
    "rating", "ratings", "user_rating_count", "user_ratings_total",
    "price_level", "price_range", "opening_hours", "regular_opening_hours",
    "hours", "review", "reviews", "review_text", "editorial_summary",
    "generative_summary", "review_summary", "business_status",
    "formatted_address", "google_name", "google_rating",
}

MIGRATIONS = pathlib.Path(__file__).resolve().parent.parent / "supabase" / "migrations"

CREATE_PLACES = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?places\s*\((.*?)\n\);",
    re.IGNORECASE | re.DOTALL,
)
ALTER_PLACES = re.compile(
    r"alter\s+table\s+places\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)",
    re.IGNORECASE,
)


def strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)


def column_names(block: str):
    for line in block.splitlines():
        line = line.strip()
        if not line or line.startswith(("constraint", "primary", "unique", "check", "foreign")):
            continue
        m = re.match(r"(\w+)\s", line)
        if m:
            yield m.group(1)


def main() -> int:
    failures = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = strip_comments(path.read_text())

        for block in CREATE_PLACES.findall(sql):
            for col in column_names(block):
                if col.lower() in FORBIDDEN:
                    failures.append(f"{path.name}: places.{col}")

        for col in ALTER_PLACES.findall(sql):
            if col.lower() in FORBIDDEN:
                failures.append(f"{path.name}: places.{col} (added via ALTER)")

    if failures:
        print("Google Places content may not be persisted. Offending columns:\n")
        for f in failures:
            print(f"  - {f}")
        print(
            "\nOnly google_place_id (indefinite) and coordinates (30 days) may be\n"
            "stored. Everything else from the Places API is request-scoped.\n"
            "See CLAUDE.md."
        )
        return 1

    print("OK: no Google Places content persisted in the catalog schema.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
