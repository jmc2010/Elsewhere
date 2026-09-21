#!/usr/bin/env python3
"""Classify uncategorised place names into the cuisine taxonomy, via Claude.

Spec §8 calls for "a one-time offline Claude pass over the distinct category
set, producing a reviewed mapping table that is version-controlled and applied
at ingest. Not an at-request LLM call." This is that pass, but over NAMES
rather than categories -- the categories are already mapped (0008), and what
remains are ~4,200 places whose Overture category carries no cuisine at all
(`restaurant`, `casual_eatery`, ...) and which are not known chains.

Names carry the signal: "Angels NY Pizza", "Elizandro's Mexican Food",
"Ponder Coffee Company".

WHY A SEPARATE TABLE, NOT brand_cuisine_map
    brand_cuisine_map means "this name is a known chain", and 0016 infers
    closure from membership in it: a chain Google cannot find is probably
    gone, because Google's chain coverage is complete. Adding thousands of
    independents there would make every unresolved independent look closed --
    which is precisely backwards, since Google's rural independent coverage is
    the gap this catalog exists to fill. So these land in name_cuisine_map.

OUTPUT IS REVIEWED BEFORE IT IS APPLIED
    The run writes a TSV. Nothing touches the database. `--emit-sql` turns a
    reviewed TSV into a migration. That ordering is the point.

Requires the Anthropic SDK. Homebrew's Python is externally managed (PEP 668)
so a plain `pip install` is refused; the repo carries a venv:

    python3 -m venv .venv && .venv/bin/pip install anthropic
    .venv/bin/python scripts/ingest/classify_cuisines.py ...

Usage:
    export ELSEWHERE_PG_URL=...
    export ANTHROPIC_API_KEY=...

    ./classify_cuisines.py --dry-run            # counts + cost estimate, no API call
    ./classify_cuisines.py --out cuisines.tsv   # submit batch, poll, write TSV
    ./classify_cuisines.py --emit-sql cuisines.tsv > ../../supabase/migrations/NNNN_name_cuisines.sql
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

MODEL = "claude-opus-5"
# Batch API is 50% of standard pricing and this is the definition of a job
# that does not need to be interactive.
INPUT_PER_MTOK = 5.00
OUTPUT_PER_MTOK = 25.00
BATCH_DISCOUNT = 0.5

# Names per request. Large enough that the cached taxonomy dominates the
# per-name cost, small enough that one bad response loses little.
CHUNK = 60

SYSTEM = """\
You classify US restaurant and food-business names into a fixed cuisine \
taxonomy.

You will be given a list of business names. For each, return the single best \
cuisine slug from the taxonomy below, or null.

Rules:
- Use ONLY slugs from the taxonomy. Never invent one.
- Return null when the name genuinely carries no cuisine signal. "Jbm \
Specialties, Llc", "Food Court", "The Corner Spot" are null. Guessing is worse \
than null here: a wrong cuisine makes a place appear in a filter it does not \
belong in, which is harder for a user to notice than its absence.
- Judge the name only. You have no menu, no reviews, no location.
- Prefer the specific slug over its parent group when the name supports it: \
"Angels NY Pizza" is pizza-classic, not italian-classic.
- A person's name alone ("Elizandro's") is null unless the rest of the name \
says otherwise ("Elizandro's Mexican Food" is mexican).
- Words like Cafe, Grill, Kitchen, Bar and Restaurant are venue words, not \
cuisine. "Main Street Grill" is null, not barbecue.

Taxonomy (slug -- label, grouped by parent):
{taxonomy}

Return JSON only."""


def psql(url: str, sql: str) -> list[list[str]]:
    r = subprocess.run(["psql", url, "-tAF", "\x1f", "-c", sql],
                       capture_output=True, text=True)
    if r.returncode != 0:
        # A traceback ending in CalledProcessError hides the one line that
        # matters, which is Postgres saying what it did not like.
        raise SystemExit("psql failed:\n" + r.stderr.strip())
    return [ln.split("\x1f") for ln in r.stdout.splitlines() if ln.strip()]


def load_taxonomy(url: str) -> tuple[str, set[str]]:
    rows = psql(url, """
        select coalesce(p.label, '(top level)'), c.slug, c.label
        from cuisines c left join cuisines p on p.id = c.parent_id
        where c.parent_id is not null
        order by p.label, c.label
    """)
    lines, slugs, group = [], set(), None
    for parent, slug, label in rows:
        if parent != group:
            group = parent
            lines.append(f"\n{parent}:")
        lines.append(f"  {slug} -- {label}")
        slugs.add(slug)
    return "\n".join(lines), slugs


def load_unclassified(url: str, limit: int | None) -> list[str]:
    """Places with no cuisine link, not a known chain, not already classified."""
    cap = f"limit {int(limit)}" if limit else ""

    # name_cuisine_map does not exist until the first pass has been applied,
    # and a query naming a missing table fails to PARSE -- a runtime guard like
    # to_regclass() cannot save it, because parsing happens first. So the
    # predicate is added only when the table is there.
    exists = psql(url, "select to_regclass('name_cuisine_map') is not null")
    already = ""
    if exists and exists[0][0] == "t":
        already = """
          and not exists (select 1 from name_cuisine_map n
                           where n.name_norm = norm_place_name(p.name))"""

    rows = psql(url, f"""
        select distinct p.name
        from places p
        where not exists (select 1 from place_cuisines pc where pc.place_id = p.id)
          and not p.permanently_closed
          and not p.probably_closed
          and not exists (select 1 from brand_cuisine_map b
                           where b.name_norm = norm_place_name(p.name)){already}
          and length(trim(p.name)) > 1
        order by p.name
        {cap}
    """)
    return [r[0] for r in rows]


def chunks(xs: list[str], n: int):
    for i in range(0, len(xs), n):
        yield xs[i:i + n]


def schema(slugs: set[str]) -> dict:
    # An enum is what actually guarantees a valid slug. Without it the model
    # will occasionally return a plausible-looking slug that does not exist,
    # and that failure is silent at classification time and loud at apply time.
    return {
        "type": "object",
        "properties": {
            "classifications": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "cuisine_slug": {
                            "type": ["string", "null"],
                            "enum": sorted(slugs) + [None],
                        },
                        "confidence": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                        },
                    },
                    "required": ["name", "cuisine_slug", "confidence"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["classifications"],
        "additionalProperties": False,
    }


def estimate(names: list[str], taxonomy: str) -> float:
    # ~4 chars per token is close enough to decide whether to press go.
    sys_tok = len(SYSTEM.format(taxonomy=taxonomy)) / 4
    n_chunks = (len(names) + CHUNK - 1) // CHUNK
    names_tok = sum(len(n) for n in names) / 4
    in_tok = sys_tok * n_chunks + names_tok
    out_tok = len(names) * 25          # one short JSON object per name
    cost = (in_tok / 1e6 * INPUT_PER_MTOK + out_tok / 1e6 * OUTPUT_PER_MTOK)
    return cost * BATCH_DISCOUNT


def emit_sql(tsv_path: str) -> int:
    rows = []
    with open(tsv_path) as fh:
        for line in fh:
            if not line.strip() or line.startswith("#"):
                continue
            name, slug, conf = (line.rstrip("\n").split("\t") + ["", ""])[:3]
            if slug and slug != "null":
                rows.append((name, slug, conf))

    def q(s: str) -> str:
        return "'" + s.replace("'", "''") + "'"

    print(f"""\
-- Cuisines inferred from place names by an offline Claude pass.
--
-- Spec §8: a one-time offline pass producing a reviewed mapping table applied
-- at ingest, never an at-request LLM call. Generated by
-- scripts/ingest/classify_cuisines.py and reviewed before this file was
-- written.
--
-- DELIBERATELY NOT brand_cuisine_map. That table means "this name is a known
-- chain", and 0016 infers closure from membership in it -- a chain Google
-- cannot find is probably gone. Independents classified here must never feed
-- that inference, or Google's thin rural coverage would read as thousands of
-- closures.

create table if not exists name_cuisine_map (
  name_norm   text primary key check (name_norm <> ''),
  cuisine_id  int references cuisines(id) on delete set null,
  confidence  text,
  reviewed    boolean not null default false,
  reviewed_at timestamptz
);

alter table name_cuisine_map enable row level security;

comment on table name_cuisine_map is
  'Cuisine inferred from a place name, for independents whose Overture
   category carries none. Not a chain list -- see 0016 before reusing it.';

insert into name_cuisine_map (name_norm, cuisine_id, confidence)
select v.name_norm, c.id, v.confidence
from (values""")
    vals = [
        f"  (norm_place_name({q(n)}), {q(s)}, {q(c)})" for n, s, c in rows
    ]
    print(",\n".join(vals))
    print("""\
) as v(name_norm, cuisine_slug, confidence)
join cuisines c on c.slug = v.cuisine_slug
on conflict (name_norm) do nothing;""")
    print(f"""
-- Link the places these names belong to. Without this the table is populated
-- and nothing reads it, so the app would be unchanged.
--
-- Scoped to places that currently have NO cuisine at all: a category-derived
-- cuisine came from Overture's own taxonomy and is better evidence than a
-- guess from a name.
insert into place_cuisines (place_id, cuisine_id)
select p.id, n.cuisine_id
from places p
join name_cuisine_map n on n.name_norm = norm_place_name(p.name)
where n.cuisine_id is not null
  and not exists (select 1 from place_cuisines pc where pc.place_id = p.id)
on conflict (place_id, cuisine_id) do nothing;

-- FOLLOW-UP, not done here: promote_overture_staging() does not consult
-- name_cuisine_map, so a monthly reingest will re-create places without these
-- links. Fold it into promote before the next Overture release.

-- {len(rows)} names classified.""")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, help="classify at most this many names")
    ap.add_argument("--out", default="cuisine_names.tsv")
    ap.add_argument("--emit-sql", metavar="TSV",
                    help="turn a reviewed TSV into a migration on stdout")
    args = ap.parse_args()

    if args.emit_sql:
        return emit_sql(args.emit_sql)

    pg = os.environ.get("ELSEWHERE_PG_URL")
    if not pg:
        print("set ELSEWHERE_PG_URL", file=sys.stderr)
        return 2

    taxonomy, slugs = load_taxonomy(pg)
    names = load_unclassified(pg, args.limit)
    print(f"{len(names)} names to classify, {len(slugs)} cuisine slugs, "
          f"{(len(names) + CHUNK - 1) // CHUNK} batch requests")
    print(f"estimated cost: ${estimate(names, taxonomy):.2f} "
          f"(Batch API, 50% of standard)")

    if args.dry_run:
        print("\nfirst 15 names:")
        for n in names[:15]:
            print(f"  {n}")
        return 0
    if not names:
        return 0
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("set ANTHROPIC_API_KEY (or pass --dry-run)", file=sys.stderr)
        return 2

    import anthropic
    from anthropic.types.message_create_params import (
        MessageCreateParamsNonStreaming,
    )
    from anthropic.types.messages.batch_create_params import Request

    client = anthropic.Anthropic()
    system_text = SYSTEM.format(taxonomy=taxonomy)

    requests = []
    for i, group in enumerate(chunks(names, CHUNK)):
        requests.append(Request(
            custom_id=f"chunk-{i:04d}",
            params=MessageCreateParamsNonStreaming(
                model=MODEL,
                max_tokens=8000,
                # The taxonomy is identical across every request; caching it
                # makes the per-name cost essentially just the name.
                system=[{"type": "text", "text": system_text,
                         "cache_control": {"type": "ephemeral"}}],
                output_config={"format": {"type": "json_schema",
                                          "schema": schema(slugs)}},
                messages=[{"role": "user",
                           "content": "\n".join(group)}],
            ),
        ))

    batch = client.messages.batches.create(requests=requests)
    print(f"\nbatch {batch.id} submitted; polling")

    while True:
        b = client.messages.batches.retrieve(batch.id)
        if b.processing_status == "ended":
            break
        print(f"  {b.processing_status}: "
              f"{b.request_counts.succeeded} done, "
              f"{b.request_counts.processing} in flight")
        time.sleep(30)

    print(f"succeeded {b.request_counts.succeeded}, "
          f"errored {b.request_counts.errored}")

    classified, errors = [], 0
    for result in client.messages.batches.results(batch.id):
        if result.result.type != "succeeded":
            errors += 1
            print(f"  {result.custom_id}: {result.result.type}", file=sys.stderr)
            continue
        msg = result.result.message
        text = next((blk.text for blk in msg.content if blk.type == "text"), "")
        try:
            for row in json.loads(text)["classifications"]:
                classified.append(row)
        except Exception as e:                                  # noqa: BLE001
            errors += 1
            print(f"  {result.custom_id}: unparseable ({e})", file=sys.stderr)

    with open(args.out, "w") as fh:
        fh.write("# name\tcuisine_slug\tconfidence\n")
        fh.write("# REVIEW THIS before --emit-sql. Delete or correct any line.\n")
        for row in sorted(classified, key=lambda r: r["name"]):
            slug = row["cuisine_slug"] or "null"
            fh.write(f"{row['name']}\t{slug}\t{row['confidence']}\n")

    got = sum(1 for r in classified if r["cuisine_slug"])
    print(f"\nwrote {args.out}: {len(classified)} names, "
          f"{got} with a cuisine ({100.0 * got / max(len(classified), 1):.0f}%), "
          f"{errors} failed requests")
    print("\nReview it, then:")
    print(f"  ./classify_cuisines.py --emit-sql {args.out} > "
          f"../../supabase/migrations/<timestamp>_name_cuisines.sql")
    return 0


if __name__ == "__main__":
    sys.exit(main())
