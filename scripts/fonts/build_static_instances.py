#!/usr/bin/env python3
"""Cut static font instances from the Fraunces and Archivo variable fonts.

Why this exists: React Native has no `fontVariationSettings`. The whole font
surface of TextStyle is fontFamily/fontSize/fontStyle/fontWeight/fontVariant,
and fontVariant is the OpenType *feature* list (tabular-nums, small-caps), not
the registered variation axes. So Fraunces' SOFT and WONK axes -- which are
doing the hand-painted work the brand rests on -- are unreachable at runtime.

The spec (design spec, s1) anticipates this and calls for static instances at
the five named axis combinations rather than approximating with the nearest
weight. This script produces them, so the values are auditable in source and
regenerating after a font update is one command rather than a memory of what
was clicked.

Each instance gets its own family name, which is also the correct RN idiom:
fontWeight against a single custom family is unreliable on Android, so weights
ship as separate families.

The two source variable fonts are not committed -- only the cut instances are.
Fetch them into a scratch directory first:

    B=https://raw.githubusercontent.com/google/fonts/main/ofl
    curl -sSL "$B/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf"        -o Fraunces-VF.ttf
    curl -sSL "$B/fraunces/Fraunces-Italic%5BSOFT,WONK,opsz,wght%5D.ttf" -o Fraunces-Italic-VF.ttf
    curl -sSL "$B/archivo/Archivo%5Bwdth,wght%5D.ttf"                    -o Archivo-VF.ttf
    curl -sSL "$B/archivo/Archivo-Italic%5Bwdth,wght%5D.ttf"             -o Archivo-Italic-VF.ttf

Both families are SIL Open Font License 1.1; the licence travels with the
redistributed instances in assets/fonts/.

Usage:
    python3 scripts/fonts/build_static_instances.py <dir-with-variable-ttfs>
Writes into assets/fonts/.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.varLib import instancer


# ---------------------------------------------------------------------------
# The rating star
# ---------------------------------------------------------------------------
# Spec §2: the rating is "one numeral plus a 10px glyph", inline, at meta
# weight, in muted ink. Never a five-star row, never a badge, never coloured.
#
# There are three ways to get a 10px mark onto that line and two of them are
# wrong here:
#
#   - `react-native-svg` is a native module. It would force a full EAS rebuild
#     for a 10px shape and break the over-the-air workflow.
#   - The `★` character (U+2605) is in neither Archivo nor Fraunces, so it would
#     fall through to the system font -- SF Pro on iOS, Roboto on Android. That
#     is precisely the "one product looking like two" that §1 bundles fonts to
#     avoid, and the two glyphs differ in weight and size.
#
# So the star is drawn into Archivo itself, at U+2605. It then behaves like any
# other character: it takes the Text's colour, so it follows the theme for free;
# it sits on the baseline; and it scales with Dynamic Type (§11) instead of
# staying 10px while the numeral beside it grows.
#
# Outline transcribed from the canvas SVG (24x24 viewBox, all straight lines).
STAR_SVG_POINTS = [
    (12.0, 2.0), (14.9, 8.3), (21.8, 9.1), (16.8, 13.9), (18.1, 20.7),
    (12.0, 17.4), (5.9, 20.7), (7.2, 13.9), (2.2, 9.1), (9.1, 8.3),
]
STAR_VIEWBOX = 24.0
STAR_CODEPOINT = 0x2605
STAR_GLYPH_NAME = "blackstar"

# The glyph is 0.8em tall in its box, which lands the drawn star at ~10px when
# the meta line is set at 12.5px -- the size §2 asks for, but expressed as a
# ratio so it holds when the user scales text up.
STAR_EM_SIZE = 0.8
# Trailing space before the numeral, matching the canvas's 3px gap at 12.5px.
STAR_RIGHT_BEARING_EM = 0.24
STAR_LEFT_BEARING_EM = 0.04


def _signed_area(points: list[tuple[float, float]]) -> float:
    """Shoelace. Positive is counter-clockwise."""
    n = len(points)
    return sum(
        points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1]
        for i in range(n)
    ) / 2.0


def add_star(font: TTFont) -> None:
    """Draw U+2605 into `font`, positioned to sit optically on the figure line."""
    upem = font["head"].unitsPerEm
    cap = getattr(font["OS/2"], "sCapHeight", None) or int(upem * 0.7)

    scale = STAR_EM_SIZE * upem / STAR_VIEWBOX

    xs = [p[0] for p in STAR_SVG_POINTS]
    ys = [p[1] for p in STAR_SVG_POINTS]
    # Flip y: SVG grows downward, font coordinates grow upward.
    pts = [((x - min(xs)) * scale, (max(ys) - y) * scale) for x, y in STAR_SVG_POINTS]

    # Centre the star on half the cap height, so it optically aligns with the
    # lining figures it sits beside rather than with the baseline.
    height = max(p[1] for p in pts)
    y_shift = cap / 2.0 - height / 2.0
    left = STAR_LEFT_BEARING_EM * upem
    pts = [(x + left, y + y_shift) for x, y in pts]

    # TrueType outer contours wind clockwise in a y-up coordinate system, which
    # is a negative shoelace area. Flipping y above reversed the winding, so
    # correct it rather than assume it -- a backwards contour renders as a hole.
    if _signed_area(pts) > 0:
        pts.reverse()

    pen = TTGlyphPen(None)
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()

    width = max(p[0] for p in pts) + STAR_RIGHT_BEARING_EM * upem

    font["glyf"][STAR_GLYPH_NAME] = pen.glyph()
    font["hmtx"][STAR_GLYPH_NAME] = (int(round(width)), int(round(left)))
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[STAR_CODEPOINT] = STAR_GLYPH_NAME
    font["maxp"].numGlyphs = len(font.getGlyphOrder())


REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "assets" / "fonts"

# (output family name, source variable font, pinned axis values)
#
# The Fraunces rows are the five axis combinations in the spec's type table,
# transcribed exactly. Do not round them to "nearest nice number" -- opsz is an
# optical size axis and 48 vs 60 is a visible difference in stroke contrast at
# the sizes these are used at.
INSTANCES: list[tuple[str, str, dict[str, float]]] = [
    # Fraunces -- names and voice.
    ("Fraunces-Pick",   "Fraunces-VF.ttf",        {"opsz": 144, "wght": 700, "SOFT": 44, "WONK": 1}),
    ("Fraunces-Detail", "Fraunces-VF.ttf",        {"opsz":  96, "wght": 650, "SOFT": 40, "WONK": 1}),
    ("Fraunces-Screen", "Fraunces-VF.ttf",        {"opsz":  60, "wght": 620, "SOFT": 36, "WONK": 1}),
    ("Fraunces-Card",   "Fraunces-VF.ttf",        {"opsz":  48, "wght": 600, "SOFT": 34, "WONK": 1}),
    ("Fraunces-Voice",  "Fraunces-Italic-VF.ttf", {"opsz":  36, "wght": 400, "SOFT": 60, "WONK": 1}),

    # Archivo -- interface, data, labels. wdth stays at 100 throughout; the
    # spec uses no condensed or extended setting.
    ("Archivo-Regular",  "Archivo-VF.ttf",        {"wght": 400, "wdth": 100}),
    ("Archivo-Medium",   "Archivo-VF.ttf",        {"wght": 500, "wdth": 100}),
    ("Archivo-SemiBold", "Archivo-VF.ttf",        {"wght": 600, "wdth": 100}),
    ("Archivo-Bold",     "Archivo-VF.ttf",        {"wght": 700, "wdth": 100}),
    ("Archivo-Italic",   "Archivo-Italic-VF.ttf", {"wght": 400, "wdth": 100}),
]

# Name table IDs we rewrite so the font identifies itself as the instance
# rather than as the variable family it was cut from. Without this both
# platforms see ten fonts all claiming to be "Fraunces" and the last one
# registered wins.
FAMILY, SUBFAMILY, FULL, POSTSCRIPT = 1, 2, 4, 6
TYPO_FAMILY, TYPO_SUBFAMILY = 16, 17


def rename(font: TTFont, family: str) -> None:
    name = font["name"]
    # Drop the typographic family/subfamily pair outright. If it survives it
    # overrides IDs 1/2 on both platforms and the rename silently does nothing.
    name.names = [n for n in name.names if n.nameID not in (TYPO_FAMILY, TYPO_SUBFAMILY)]
    for name_id, value in (
        (FAMILY, family),
        (SUBFAMILY, "Regular"),
        (FULL, family),
        (POSTSCRIPT, family),
    ):
        name.setName(value, name_id, 3, 1, 0x409)  # Windows / Unicode BMP / en-US
        name.setName(value, name_id, 1, 0, 0)      # Macintosh / Roman / en


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    src_dir = Path(sys.argv[1])
    OUT.mkdir(parents=True, exist_ok=True)

    total = 0
    for family, source, axes in INSTANCES:
        src = src_dir / source
        if not src.exists():
            print(f"missing source font: {src}", file=sys.stderr)
            return 1

        font = instancer.instantiateVariableFont(TTFont(src), axes, inplace=False)
        rename(font, family)
        if family.startswith("Archivo"):
            add_star(font)

        dest = OUT / f"{family}.ttf"
        font.save(dest)
        size = dest.stat().st_size
        total += size
        settings = ", ".join(f"{k} {v:g}" for k, v in axes.items())
        print(f"  {family:<17} {size / 1024:6.1f} KB   {settings}")

    print(f"\n  {len(INSTANCES)} instances, {total / 1024 / 1024:.2f} MB total, in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
