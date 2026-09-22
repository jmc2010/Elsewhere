import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlaceCard, type PlaceCardProps } from "@/components/PlaceCard";
import { palettes, ThemeProvider, useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type, useAppFonts } from "@/theme/type";

/**
 * Card harness -- NOT a product screen.
 *
 * It exists so the eight card states can be checked against the canvas side by
 * side, in both themes, with the real catalog rows. It is deliberately not
 * reachable from the app: open it with `elsewhere://harness` on a device
 * build, or `/harness` on web.
 *
 * Fonts are loaded here rather than in the root layout on purpose. No product
 * screen uses the theme yet, so keeping the load local means this change cannot
 * affect the running app at all. When the shortlist adopts the theme, font
 * loading moves up to `src/app/_layout.tsx` and comes out of here.
 */

/**
 * The eight states, in canvas order, with the real rows named in spec §2.
 *
 * These are catalog rows, not invented examples, and the awkward ones are the
 * point: `Funky Munky Shaved Ice Valley View` carries its town in its name,
 * `Cousins Maine Lobster — Dallas Fort-Worth, TX` carries franchise territory
 * in its name and is the two-line test, and `Jones Cafe` is the floor.
 */
const STATES: { state: string; card: PlaceCardProps }[] = [
  {
    state: "Yours, past cooldown",
    card: {
      name: "Middlebrooks Bar & Grill",
      tick: { text: "Yours · liked", tone: "yours" },
      meta: { cuisine: "Bar", locality: "Valley View", distanceMiles: 0.4, rating: 4.3 },
      reason: { kind: "curation", text: "You haven't been since March." },
    },
  },
  {
    state: "Frontier (unverified)",
    card: {
      name: "Texas Legacy Distillery",
      tick: { text: "Nobody's been here", tone: "frontier" },
      meta: { cuisine: "Distillery", locality: "Valley View", distanceMiles: 0.4 },
      reason: {
        kind: "frontier",
        text: "New name since the spring. You'd be the first to say anything.",
      },
      action: { label: "Call ahead", tone: "brass" },
    },
  },
  {
    state: "Inferred",
    card: {
      name: "Tia's Tex-Mex",
      meta: { cuisine: "Tex-Mex", locality: "Valley View", distanceMiles: 0.3 },
      reason: {
        kind: "curation",
        text: "You've liked two other Tex-Mex places out this way.",
      },
    },
  },
  {
    state: "Stale identity",
    card: {
      name: "Rider's Smokehouse",
      meta: { cuisine: "Barbecue", locality: "Valley View", distanceMiles: 0.4 },
      reason: {
        kind: "caution",
        text: "Might have changed hands — two people said the building's something else now.",
      },
      action: { label: "Still there?", tone: "plain" },
    },
  },
  {
    state: "Friend-attributed",
    card: {
      name: "Lil Brick Oven Pizza",
      tick: { text: "Dale", tone: "friend" },
      meta: { cuisine: "Pizza", locality: "Valley View", distanceMiles: 0.4, rating: 4.6 },
      reason: { kind: "curation", text: "Dale: worth the drive, good bar." },
    },
  },
  {
    state: "Friend caution + closed",
    card: {
      name: "Funky Munky Shaved Ice Valley View",
      meta: {
        cuisine: "Dessert",
        locality: "Valley View",
        distanceMiles: 0.4,
        closedNow: true,
      },
      reason: { kind: "caution", attributedTo: "Seth", text: "wrong for kids on a Friday." },
    },
  },
  {
    state: "Long / messy name",
    card: {
      // Shown untrimmed on purpose: this is the two-line-then-ellipsis test.
      name: "Cousins Maine Lobster — Dallas Fort-Worth, TX",
      meta: {
        cuisine: "Seafood",
        locality: "Dallas",
        distanceMiles: 0.0,
        rating: 4.1,
        priceLevel: "$$",
      },
      reason: {
        kind: "curation",
        text: "Franchise territory in the name — trimmed on display, kept in the record.",
      },
    },
  },
  {
    state: "Floor",
    card: {
      // Spec §12: name and distance, nothing else. 2,076 rows (5.3%) look like
      // this. If the layout holds here it holds everywhere.
      name: "Jones Cafe",
      meta: { distanceMiles: 6.2 },
    },
  },
];

/**
 * The largest text scale the card is expected to survive.
 *
 * Android's largest font-size setting is about 1.3x, and compounds with
 * Display size to roughly 2x. iOS goes further: the accessibility Dynamic Type
 * sizes reach about 3.1x for body text. 2.0 is therefore a real setting people
 * use rather than a synthetic stress test, and it is the point at which the
 * two-line name plus a wrapped meta line starts fighting the card's rhythm.
 *
 * If the grid holds here but we also want to promise iOS AX5, the answer is a
 * `maxFontSizeMultiplier` cap on the name, not a smaller number here.
 */
const MAX_FONT_SCALE = 2;

/**
 * The case that only breaks at scale: a name that already wraps to two lines,
 * with the text doubled and the card no wider. Everything else on the card can
 * reflow; the name cannot, because it is capped at two lines and then
 * ellipsises. This is where the eight-state grid gives way if it is going to,
 * and it is invisible at the default setting -- which is exactly why it is
 * pinned here rather than left to whoever remembers to change their phone.
 */
const MAX_SCALE_CASE: PlaceCardProps = {
  name: "Cousins Maine Lobster — Dallas Fort-Worth, TX",
  tick: { text: "Nobody's been here", tone: "frontier" },
  meta: { cuisine: "Seafood", locality: "Dallas", distanceMiles: 0.0, rating: 4.1 },
  reason: { kind: "frontier", text: "New name since the spring. You'd be the first to say anything." },
  action: { label: "Call ahead", tone: "brass" },
};

function Block({ themeName }: { themeName: ThemeName }) {
  return (
    <ThemeProvider force={themeName}>
      <BlockBody themeName={themeName} />
    </ThemeProvider>
  );
}

function BlockBody({ themeName }: { themeName: ThemeName }) {
  const theme = useTheme();
  const s = harnessStyles(theme);

  return (
    <View style={s.block}>
      <Text style={s.blockLabel}>
        {themeName === "dark" ? "Dark · primary" : "Light · daylight"}
      </Text>
      <View>
        {STATES.map(({ state, card }, i) => (
          <View key={state}>
            <PlaceCard {...card} isFirst={i === 0} />
            <Text style={s.stateLabel}>{state}</Text>
          </View>
        ))}
      </View>

      <Text style={s.scaleHeading}>
        At {MAX_FONT_SCALE}x text scale
      </Text>
      <ThemeProvider force={themeName} fontScale={MAX_FONT_SCALE}>
        <PlaceCard {...MAX_SCALE_CASE} isFirst />
      </ThemeProvider>
      <Text style={s.stateLabel}>Largest font scale · two-line name</Text>
    </View>
  );
}

export default function Harness() {
  const [loaded, error] = useAppFonts();
  const insets = useSafeAreaInsets();

  if (error) {
    // Say which font failed rather than rendering silently in a fallback face,
    // which is exactly the failure this whole exercise exists to avoid.
    return (
      <View style={fallback.centre}>
        <Text style={fallback.text}>Fonts failed to load: {error.message}</Text>
      </View>
    );
  }
  if (!loaded) return <View style={fallback.blank} />;

  return (
    <ScrollView
      style={fallback.blank}
      contentContainerStyle={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 40,
      }}
    >
      <Block themeName="dark" />
      <Block themeName="light" />
    </ScrollView>
  );
}

const harnessStyles = ({ colours: c, space }: Theme) =>
  StyleSheet.create({
    block: {
      backgroundColor: c.ground,
      paddingHorizontal: 18,
      paddingTop: space.xl,
      paddingBottom: space.xxxl,
    },
    blockLabel: {
      ...type.label,
      color: c.inkFaint,
      marginBottom: space.lg,
    },
    // Harness furniture, not part of the card. Sits under each card so the
    // state being looked at is named while comparing against the canvas.
    scaleHeading: {
      ...type.label,
      color: c.inkFaint,
      marginTop: space.xxl,
      marginBottom: space.sm,
    },
    stateLabel: {
      ...type.label,
      color: c.brass,
      opacity: 0.55,
      marginTop: 2,
      marginBottom: space.xs,
    },
  });

// Pre-theme styles: these render before any ThemeProvider is mounted, so they
// reach the palette directly rather than through useTheme(). They still do not
// contain a colour literal -- that rule has no exceptions.
const fallback = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palettes.dark.ground },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: palettes.dark.ground,
  },
  text: { color: palettes.dark.ink, fontSize: 15 },
});
