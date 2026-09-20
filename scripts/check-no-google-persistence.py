#!/usr/bin/env python3
"""Fail if Google Places content could be persisted.

Two checks, because there are two ways to break the rule.

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

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"
FUNCTIONS = ROOT / "supabase" / "functions"

# Supabase client calls that reach the database. A Google-derived value
# appearing inside any of these is the violation.
DB_WRITE = re.compile(r"\.(insert|update|upsert|rpc)\s*\(")

# The response envelope. places-proxy holds Google values in `live`; passing
# that variable into a database call is the mistake this check exists for,
# and it would not be caught by looking for field names alone.
ENVELOPE = re.compile(r"\blive\b")

# The only two Google values that may be written, each with one writer.
PERMITTED_RPC = {"google_place_id_record", "google_business_status_record"}

APP_SRC = ROOT / "src"

# Server-side secrets. CLAUDE.md: "Never ship an API key in the app bundle."
# An EXPO_PUBLIC_ prefix inlines the value into the JS bundle, so anything
# named here appearing in app source is a shipped credential, not a config
# mistake -- and for the Maps key it is a directly billable one.
SERVER_ONLY_SECRETS = ("GOOGLE_MAPS_API_KEY", "ANTHROPIC_API_KEY")

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


def balanced_args(text: str, open_paren: int) -> str:
    """Return the argument text of a call whose '(' is at open_paren."""
    depth, i = 0, open_paren
    while i < len(text):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[open_paren + 1:i]
        i += 1
    return text[open_paren + 1:]


def check_edge_functions() -> list[str]:
    """Google content must never reach a database call from function code."""
    failures = []
    if not FUNCTIONS.exists():
        return failures
    for path in sorted(FUNCTIONS.rglob("*.ts")):
        src = path.read_text()
        # Strip line comments so the explanatory prose above each rule -- which
        # necessarily names the forbidden fields -- does not trip the check.
        code = re.sub(r"//[^\n]*", "", src)
        for m in DB_WRITE.finditer(code):
            args = balanced_args(code, m.end() - 1)
            rel = path.relative_to(ROOT)

            if m.group(1) == "rpc":
                name = re.match(r"\s*[\"']([\w.]+)[\"']", args)
                # A permitted writer takes place_id or a boolean and nothing
                # else; its own signature is the guarantee.
                if name and name.group(1) in PERMITTED_RPC:
                    continue

            for field in FORBIDDEN:
                if re.search(rf"\b{re.escape(field)}\b\s*:", args):
                    failures.append(f"{rel}: {field} passed to .{m.group(1)}()")
            if ENVELOPE.search(args):
                failures.append(
                    f"{rel}: the `live` response envelope passed to "
                    f".{m.group(1)}() -- it holds Google content and has no "
                    f"database writer")
    return failures


def check_app_bundle() -> list[str]:
    """Server-side secrets must never be reachable from app source."""
    failures = []
    if not APP_SRC.exists():
        return failures
    for path in sorted(APP_SRC.rglob("*")):
        if path.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
            continue
        code = re.sub(r"//[^\n]*", "", path.read_text())
        for secret in SERVER_ONLY_SECRETS:
            if secret in code:
                failures.append(
                    f"{path.relative_to(ROOT)}: references {secret}, which is "
                    f"server-side only and would be inlined into the bundle. "
                    f"Call places-proxy instead.")
    return failures


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

    failures.extend(check_edge_functions())
    failures.extend(check_app_bundle())

    if failures:
        print("Google Places content may not be persisted. Offending code:\n")
        for f in failures:
            print(f"  - {f}")
        print(
            "\nOnly google_place_id (indefinite) and coordinates (30 days) may be\n"
            "stored. Everything else from the Places API is request-scoped.\n"
            "See CLAUDE.md."
        )
        return 1

    print("OK: no Google Places content persisted in the catalog schema,")
    print("    no Google-derived value reaches a database call, and no")
    print("    server-side secret is reachable from app source.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
