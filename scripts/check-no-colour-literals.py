#!/usr/bin/env python3
"""Fail if a colour literal appears anywhere under src/ except the palettes.

The design spec §1 puts it plainly: never hard-code a colour in a component.
That is not tidiness. Two themes are only maintainable if there is exactly one
place where a colour is written down, and the moment a second place exists the
light theme starts drifting from the dark one in ways nobody notices until a
screen is unreadable in daylight.

This is the same reasoning as scripts/check-no-google-persistence.py: a rule
that depends on remembering it is not a rule.

Only src/theme/tokens.ts may contain colour literals.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src"

# The one file where a colour may be written down.
ALLOWED = {"theme/tokens.ts"}

# Screens built during Phase 1, before the design existed. They are unstyled
# scaffolding in system defaults and every one of them is due to be rebuilt
# against the theme; each entry comes off this list as its screen is rebuilt,
# and the list is expected to reach empty.
#
# This is an exemption for named files that predate the rule, NOT a way to add
# new ones. If a file you are working on is on this list, the fix is to rebuild
# it against useTheme(), not to leave it here.
LEGACY_PRE_DESIGN = {
    "app/index.tsx",
    "components/FilterSheet.tsx",
    "components/LocationPicker.tsx",
    "components/SurpriseReveal.tsx",
}

PATTERNS = [
    # #fff, #ffffff, #ffffffff
    (re.compile(r"#[0-9a-fA-F]{3,8}\b"), "hex colour"),
    # rgb(...) / rgba(...) / hsl(...) / hsla(...)
    (re.compile(r"\b(?:rgba?|hsla?)\s*\("), "functional colour"),
]

# CSS named colours that turn up in practice. Matched only where a style value
# is actually being assigned, so prose in a comment does not trip the check.
NAMED = re.compile(
    r"\b(?:color|Color|backgroundColor|borderColor|borderTopColor|borderBottomColor|"
    r"borderLeftColor|borderRightColor|shadowColor|tintColor|textShadowColor|"
    r"placeholderTextColor)\s*[:=]\s*[\"'](?!#)"
    r"(white|black|red|green|blue|grey|gray|yellow|orange|purple|pink|brown|"
    r"transparent|silver|gold|navy|teal|olive|maroon|lime|aqua|fuchsia)[\"']"
)


def strip_comments(line: str) -> str:
    """Drop // comments so a hex value discussed in prose is not a failure."""
    idx = line.find("//")
    return line[:idx] if idx != -1 else line


def main() -> int:
    failures: list[str] = []

    for path in sorted(SRC.rglob("*")):
        if path.suffix not in {".ts", ".tsx"} or not path.is_file():
            continue
        rel = path.relative_to(SRC).as_posix()
        if rel in ALLOWED or rel in LEGACY_PRE_DESIGN:
            continue

        in_block_comment = False
        for n, raw in enumerate(path.read_text().splitlines(), 1):
            line = raw
            # Crude block-comment tracking, good enough to spare the long
            # explanatory headers these files carry.
            if in_block_comment:
                if "*/" in line:
                    line = line.split("*/", 1)[1]
                    in_block_comment = False
                else:
                    continue
            while "/*" in line:
                before, rest = line.split("/*", 1)
                if "*/" in rest:
                    line = before + rest.split("*/", 1)[1]
                else:
                    line = before
                    in_block_comment = True
                    break

            line = strip_comments(line)
            if not line.strip():
                continue

            for pattern, what in PATTERNS:
                if pattern.search(line):
                    failures.append(f"src/{rel}:{n}: {what} -- {raw.strip()}")
            if NAMED.search(line):
                failures.append(f"src/{rel}:{n}: named colour -- {raw.strip()}")

    stale = sorted(
        f for f in LEGACY_PRE_DESIGN if not (SRC / f).exists()
    )
    if stale:
        # A rebuilt or deleted screen must leave the list, or the exemption
        # silently starts covering a file somebody adds back later.
        print(
            "These files are exempted but no longer exist. Remove them from"
            f" LEGACY_PRE_DESIGN:\n  " + "\n  ".join(stale),
            file=sys.stderr,
        )
        return 1

    if failures:
        print("Colour literals found outside src/theme/tokens.ts:\n", file=sys.stderr)
        for f in failures:
            print(f"  {f}", file=sys.stderr)
        print(
            "\nEvery colour goes through useTheme(). See design spec §1 -- the two"
            "\nthemes are the reason, and they only stay in step if there is one"
            "\nplace a colour is written down.",
            file=sys.stderr,
        )
        return 1

    remaining = len(LEGACY_PRE_DESIGN)
    print("No colour literals outside src/theme/tokens.ts.")
    if remaining:
        print(f"({remaining} pre-design screens still exempt -- see LEGACY_PRE_DESIGN.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
