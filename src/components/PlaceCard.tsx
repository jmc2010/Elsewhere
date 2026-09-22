import { Fragment, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme, type Palette, type Theme, type ThemeName } from "@/theme/tokens";
import { tabular, type } from "@/theme/type";

/**
 * The shortlist card (design spec §2).
 *
 * One component, eight states, one grid -- and **the grid does not change
 * between states**. That is the whole point of the design, so it is worth
 * being explicit about how it is enforced here: every optional element is
 * omitted entirely rather than rendered empty, reserved, or filled with a
 * placeholder. Nothing holds a slot open.
 *
 *     [ tick   ]   optional, 10.5 uppercase
 *       Name       Fraunces 22, max 2 lines, then ellipsis
 *       meta · meta · meta
 *       reason     omitted when there is no honest one
 *     [ pill    ]  at most one
 *
 * Three rules from the spec are load-bearing and are not style preferences:
 *
 *   1. The rating is one numeral and a glyph, inline, at meta weight, in muted
 *      ink. Never a five-star row, never a badge, never coloured. Its absence
 *      shortens the meta line and must not leave a gap -- which is why the
 *      meta line is built by collecting the elements that exist and joining
 *      them, rather than by rendering a fixed set of slots.
 *   2. The reason line is omitted when there is no honest reason. Never filler.
 *   3. Nothing here is a platform-standard control. The action pill is drawn.
 *
 * Why it matters that this holds: about 30% of the catalog has no rating, and
 * 2,076 rows (5.3%) have neither cuisine nor website. A layout where the rating
 * carries the hierarchy has a hole in it three times out of ten, and the holes
 * land on the independents the product exists to surface. Here the *name*
 * carries it, so a card with nothing but a name is a complete card.
 */

/** U+2605, drawn into Archivo by scripts/fonts/build_static_instances.py. */
const STAR = "★";

/**
 * Provenance marker above the name. Tone is the meaning, not the colour --
 * the colour mapping lives in one place, below.
 */
export type TickTone = "frontier" | "yours" | "friend";

export interface Tick {
  text: string;
  tone: TickTone;
}

/**
 * The one line of voice on the card.
 *
 * `curation` and `frontier` are set in italic -- they are the app speaking.
 * `caution` is upright and muted, because a conditional veto is information,
 * not voice, and it must never read as a red badge: Seth meant *not with the
 * four-year-old*, he did not mean danger.
 */
export type Reason =
  | { kind: "curation"; text: string }
  | { kind: "frontier"; text: string }
  | { kind: "caution"; text: string; attributedTo?: string };

/** At most one per card (spec §2). */
export interface Action {
  label: string;
  /** `brass` is the only action colour; `plain` is the quieter boundary. */
  tone: "brass" | "plain";
  onPress?: () => void;
}

export interface PlaceMeta {
  /** Ours, free, from the catalog. */
  cuisine?: string | null;
  locality?: string | null;
  distanceMiles?: number | null;
  /** Google, request-scoped. Never stored -- see CLAUDE.md. */
  rating?: number | null;
  priceLevel?: string | null;
  closedNow?: boolean;
}

export interface PlaceCardProps {
  /** Display name: locality and legal suffixes already stripped (§2). */
  name: string;
  meta?: PlaceMeta;
  tick?: Tick | null;
  reason?: Reason | null;
  action?: Action | null;
  onPress?: () => void;
  /** The first card in a list draws no top rule. */
  isFirst?: boolean;
}

function tickColour(tone: TickTone, c: Palette): string {
  switch (tone) {
    case "frontier":
      return c.brass;
    case "yours":
    case "friend":
      return c.green;
  }
}

/** One decimal, always -- "0.0 mi" is honest about downtown, "0" would not be. */
function formatMiles(miles: number): string {
  return `${miles.toFixed(1)} mi`;
}

export function PlaceCard({
  name,
  meta,
  tick,
  reason,
  action,
  onPress,
  isFirst = false,
}: PlaceCardProps) {
  const theme = useTheme();
  const s = styles(theme);
  const c = theme.colours;

  // Collect only the meta elements that exist. An absent element contributes
  // nothing at all -- no slot, no separator, no reserved width.
  const metaParts: ReactNode[] = [];
  if (meta?.cuisine) metaParts.push(<Text style={s.meta}>{meta.cuisine}</Text>);
  if (meta?.locality) metaParts.push(<Text style={s.meta}>{meta.locality}</Text>);
  if (meta?.distanceMiles != null) {
    metaParts.push(
      <Text style={[s.meta, tabular]}>{formatMiles(meta.distanceMiles)}</Text>,
    );
  }
  if (meta?.rating != null) {
    // Star and numeral share one Text so they can never wrap apart. The star's
    // trailing gap is baked into its advance width, not added here.
    metaParts.push(
      <Text style={[s.meta, tabular]}>
        {STAR}
        {meta.rating.toFixed(1)}
      </Text>,
    );
  }
  if (meta?.priceLevel) metaParts.push(<Text style={s.meta}>{meta.priceLevel}</Text>);
  if (meta?.closedNow) metaParts.push(<Text style={s.shut}>Closed now</Text>);

  return (
    <Pressable
      onPress={onPress}
      // The card's whole row is the touch target (§11). Everything on it is
      // taller than 44 already, including the floor card.
      style={({ pressed }) => [
        s.card,
        isFirst && s.cardFirst,
        pressed && s.cardPressed,
      ]}
      accessibilityRole={onPress ? "button" : undefined}
    >
      {tick ? (
        <Text style={[s.tick, { color: tickColour(tick.tone, c) }]}>{tick.text}</Text>
      ) : null}

      <Text style={s.name} numberOfLines={2} ellipsizeMode="tail">
        {name}
      </Text>

      {metaParts.length > 0 ? (
        <View style={s.metaRow}>
          {metaParts.map((part, i) => (
            <Fragment key={i}>
              {i > 0 ? <Text style={s.sep}>·</Text> : null}
              {part}
            </Fragment>
          ))}
        </View>
      ) : null}

      {reason ? <ReasonLine reason={reason} theme={theme} /> : null}

      {action ? (
        <View style={s.actions}>
          <Pressable
            onPress={action.onPress}
            // The drawn pill is ~26pt tall. hitSlop takes the *target* to 44
            // without inflating the shape, which is what §11 actually asks for.
            hitSlop={{ top: 9, bottom: 9, left: 8, right: 8 }}
            accessibilityRole="button"
            style={({ pressed }) => [
              s.pill,
              action.tone === "brass" ? s.pillBrass : s.pillPlain,
              pressed && s.pillPressed,
            ]}
          >
            <Text style={[s.pillLabel, action.tone === "brass" && s.pillLabelBrass]}>
              {action.label}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

function ReasonLine({ reason, theme }: { reason: Reason; theme: Theme }) {
  const s = styles(theme);

  if (reason.kind === "caution") {
    return (
      <Text style={s.caution}>
        {reason.attributedTo ? (
          <Text style={s.cautionName}>{reason.attributedTo}: </Text>
        ) : null}
        {reason.text}
      </Text>
    );
  }

  return (
    <Text style={[s.reason, reason.kind === "frontier" && s.reasonFrontier]}>
      {reason.text}
    </Text>
  );
}

/**
 * There are exactly two themes, so the stylesheets are built once each and
 * cached rather than rebuilt on every render. Both ReasonLine and PlaceCard
 * ask for them, and the harness renders sixteen cards at once.
 */
const sheets = new Map<ThemeName, ReturnType<typeof build>>();

function styles(theme: Theme): ReturnType<typeof build> {
  let sheet = sheets.get(theme.name);
  if (!sheet) {
    sheet = build(theme);
    sheets.set(theme.name, sheet);
  }
  return sheet;
}

const build = ({ colours: c, space, radius, hairline }: Theme) =>
  StyleSheet.create({
    card: {
      // The single vertical rhythm every state shares. Changing any of these
      // five numbers changes all eight states at once, which is the point.
      paddingTop: 15,
      paddingBottom: space.lg,
      rowGap: 5,
      borderTopWidth: hairline,
      borderTopColor: c.rule,
    },
    cardFirst: {
      borderTopWidth: 0,
      paddingTop: space.xs,
    },
    cardPressed: {
      // Drawn feedback, not a platform ripple.
      opacity: 0.6,
    },

    tick: {
      ...type.label,
      // Colour is applied at the call site from the tick's tone.
    },

    name: {
      ...type.cardName,
      color: c.ink,
    },

    metaRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: 7,
      rowGap: 0,
    },
    meta: {
      ...type.meta,
      color: c.inkMuted,
    },
    sep: {
      ...type.meta,
      color: c.inkFaint,
    },
    shut: {
      ...type.metaStrong,
      color: c.oxblood,
    },

    reason: {
      ...type.reason,
      color: c.ink,
      opacity: 0.92,
      marginTop: 1,
    },
    reasonFrontier: {
      color: c.brass,
      opacity: 1,
    },
    caution: {
      ...type.caution,
      color: c.inkMuted,
      marginTop: 1,
    },
    cautionName: {
      ...type.cautionName,
      color: c.ink,
    },

    actions: {
      flexDirection: "row",
      columnGap: space.sm,
      marginTop: 7,
    },
    pill: {
      borderWidth: hairline,
      borderRadius: radius.pill,
      paddingVertical: 6,
      paddingHorizontal: space.md,
      alignSelf: "flex-start",
    },
    pillPlain: {
      borderColor: c.ruleStrong,
    },
    pillBrass: {
      borderColor: c.brass,
    },
    pillPressed: {
      opacity: 0.6,
    },
    pillLabel: {
      ...type.pill,
      color: c.ink,
    },
    pillLabelBrass: {
      color: c.brass,
    },
  });
