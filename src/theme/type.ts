import { useFonts } from "expo-font";
import type { TextStyle } from "react-native";

/**
 * The type scale, from the design spec §1.
 *
 * ----------------------------------------------------------------------------
 * Why these are ten separate font families and not four weights of two
 * ----------------------------------------------------------------------------
 * React Native has no `fontVariationSettings`, on either platform. The entire
 * font surface of TextStyle is fontFamily / fontSize / fontStyle / fontWeight /
 * fontVariant, and `fontVariant` is the OpenType *feature* list (tabular-nums,
 * small-caps, ligatures) -- not the registered variation axes. Verified against
 * react-native 0.86.3: no reference to variation axes anywhere in its JS, iOS
 * or Android sources, and expo-font exposes no axis parameter either.
 *
 * So Fraunces' SOFT and WONK axes are unreachable at runtime, and those two are
 * doing the hand-painted work the whole brand rests on. The spec anticipated
 * this and called the fallback: ship static instances at the five named axis
 * combinations rather than approximate with the nearest weight.
 *
 * `scripts/fonts/build_static_instances.py` cuts them. The axis values live
 * there, in source, so a font update is one command rather than a memory.
 *
 * Two rules follow from this, and both matter:
 *
 *   1. NEVER set `fontWeight` alongside these families. The weight is baked
 *      into the outlines. On Android a fontWeight against a custom family that
 *      has no matching face triggers synthetic emboldening -- it smears the
 *      stroke contrast that the opsz axis was chosen for.
 *   2. NEVER set `fontStyle: "italic"` on Fraunces-Voice or Archivo-Italic.
 *      Those files are true italics. Asking for italic on top produces a
 *      synthetic oblique applied to an already-italic face, which slants twice.
 *
 * Both mistakes render as "slightly off" rather than as an error, which is
 * exactly why they are written down here.
 */

/** Family names. These match the `name` table inside each .ttf -- see the build script. */
export const family = {
  pick: "Fraunces-Pick",
  detail: "Fraunces-Detail",
  screen: "Fraunces-Screen",
  card: "Fraunces-Card",
  voice: "Fraunces-Voice",

  regular: "Archivo-Regular",
  medium: "Archivo-Medium",
  semibold: "Archivo-SemiBold",
  bold: "Archivo-Bold",
  italic: "Archivo-Italic",
} as const;

/**
 * Tabular figures, for every distance, count and rating (spec §1).
 *
 * Confirmed present in Archivo, which is where every figure in the app lives.
 * Fraunces carries no `tnum` feature -- it sets names, not numbers. If a figure
 * ever needs to sit in Fraunces, this will silently do nothing there.
 */
export const tabular = { fontVariant: ["tabular-nums"] } as const satisfies TextStyle;

/**
 * Line heights are absolute in React Native, not multipliers, so the spec's
 * ratios are resolved here rather than at each call site. The ratio is kept in
 * the comment so the two can be checked against each other.
 *
 * Letter spacing is likewise absolute points, converted from the spec's em
 * values at each role's own size.
 */
export const type = {
  /** Reveal. 44 / 1.02, tracking −.015em. */
  pick: {
    fontFamily: family.pick,
    fontSize: 44,
    lineHeight: 44.88,
    letterSpacing: -0.66,
  },
  /** Place detail. 32 / 1.06. */
  detailName: {
    fontFamily: family.detail,
    fontSize: 32,
    lineHeight: 33.92,
  },
  /** Screen head. 25 / 1.14. */
  screenHead: {
    fontFamily: family.screen,
    fontSize: 25,
    lineHeight: 28.5,
  },
  /** Card name -- the hero. 22 / 1.14. */
  cardName: {
    fontFamily: family.card,
    fontSize: 22,
    lineHeight: 25.08,
  },
  /** Voice, Fraunces italic. 17 / 1.40. No fontStyle -- the face is already italic. */
  voice: {
    fontFamily: family.voice,
    fontSize: 17,
    lineHeight: 23.8,
  },
  /** Body. Archivo 15 / 1.50, 400. */
  body: {
    fontFamily: family.regular,
    fontSize: 15,
    lineHeight: 22.5,
  },
  /** Card reason. Archivo italic 13.5 / 1.45, 400. The one line of voice on the card. */
  reason: {
    fontFamily: family.italic,
    fontSize: 13.5,
    lineHeight: 19.58,
  },
  /**
   * Caution reason. Upright, not italic, and a notch smaller (13 / 1.45).
   * From the canvas rather than the spec's type table, which does not list it.
   * The register shift is the point: a conditional veto is information, and
   * setting it in the same italic as curation would make it sound like voice.
   */
  caution: {
    fontFamily: family.regular,
    fontSize: 13,
    lineHeight: 18.85,
  },
  /** The attributed name inside a caution line ("Seth:"). Same metrics, heavier. */
  cautionName: {
    fontFamily: family.semibold,
    fontSize: 13,
    lineHeight: 18.85,
  },
  /** Meta line. Archivo 12.5 / 1.40, 500. */
  meta: {
    fontFamily: family.medium,
    fontSize: 12.5,
    lineHeight: 17.5,
  },
  /**
   * Meta line, emphasised -- used only by `Closed now`, which is the single
   * element on that line carrying a consequence rather than an attribute.
   * Same metrics as `meta` so it cannot shift the line it sits in.
   */
  metaStrong: {
    fontFamily: family.semibold,
    fontSize: 12.5,
    lineHeight: 17.5,
  },
  /**
   * Action pill. 12 / 1, 600. From the canvas; the spec's type table omits
   * controls.
   */
  pill: {
    fontFamily: family.semibold,
    fontSize: 12,
    lineHeight: 12,
  },
  /** Label / tick. Archivo 10.5 / 1.40, 700, tracking .13em, uppercase. */
  label: {
    fontFamily: family.bold,
    fontSize: 10.5,
    lineHeight: 14.7,
    letterSpacing: 1.365,
    textTransform: "uppercase",
  },
} as const satisfies Record<string, TextStyle>;

export type TypeRole = keyof typeof type;

/**
 * Load every instance. Fonts are Metro assets, so new cuts ship over EAS Update
 * without a native rebuild.
 *
 * Note that nothing here calls `allowFontScaling={false}` anywhere downstream:
 * spec §11 requires Dynamic Type be respected, and the card is specified to
 * survive two lines of name at the largest setting.
 */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    [family.pick]: require("@/assets/fonts/Fraunces-Pick.ttf"),
    [family.detail]: require("@/assets/fonts/Fraunces-Detail.ttf"),
    [family.screen]: require("@/assets/fonts/Fraunces-Screen.ttf"),
    [family.card]: require("@/assets/fonts/Fraunces-Card.ttf"),
    [family.voice]: require("@/assets/fonts/Fraunces-Voice.ttf"),
    [family.regular]: require("@/assets/fonts/Archivo-Regular.ttf"),
    [family.medium]: require("@/assets/fonts/Archivo-Medium.ttf"),
    [family.semibold]: require("@/assets/fonts/Archivo-SemiBold.ttf"),
    [family.bold]: require("@/assets/fonts/Archivo-Bold.ttf"),
    [family.italic]: require("@/assets/fonts/Archivo-Italic.ttf"),
  });
}
