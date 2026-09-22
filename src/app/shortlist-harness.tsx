import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlaceCard, type PlaceCardProps } from "@/components/PlaceCard";
import { tuning } from "@/config/tuning";
import { palettes, ThemeProvider, useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type, useAppFonts } from "@/theme/type";

/**
 * Shortlist harness -- NOT a product screen.
 *
 * Renders what the rebuilt shortlist produces from real catalog rows, in both
 * themes, plus the rural-exhausted state. It exists because the two states
 * that matter most are the hardest to reach on a device: the exhausted screen
 * needs a verdict on every nearby place, and the sparse cards need a user with
 * no history.
 */

// Valley View, as catalog_search actually returns it: freshness band 4 for
// most, band 1 for Pizza Inn (upstream 2023-05-12), no verdicts, no ratings
// until hydration lands.
const CARDS: PlaceCardProps[] = [
  {
    name: "Texas Legacy Distillery",
    tick: { text: "Nobody's been here", tone: "frontier" },
    meta: { cuisine: "Distillery", locality: "Valley View", distanceMiles: 0.2 },
    action: { label: "Call ahead", tone: "brass" },
  },
  {
    name: "Tia's Tex-Mex",
    tick: { text: "Nobody's been here", tone: "frontier" },
    meta: { cuisine: "Tex-Mex", locality: "Valley View", distanceMiles: 0.1, rating: 4.4 },
    action: { label: "Call ahead", tone: "brass" },
  },
  {
    name: "Pizza Inn",
    meta: { cuisine: "Pizza Classic", locality: "Valley View", distanceMiles: 0.2 },
    reason: {
      kind: "caution",
      text: "Might have changed hands — nothing's confirmed it since 2024.",
    },
    action: { label: "Still there?", tone: "plain" },
  },
  {
    name: "Middlebrooks Bar & Grill",
    tick: { text: "Yours · liked", tone: "yours" },
    meta: { cuisine: "Bar", locality: "Valley View", distanceMiles: 0.2, rating: 4.3 },
  },
  {
    name: "THE 1845 Bar & Lounge",
    tick: { text: "Nobody's been here", tone: "frontier" },
    meta: { cuisine: "Cocktail Bar", locality: "Valley View", distanceMiles: 0.2 },
  },
  {
    name: "Jbm Specialties, Llc",
    meta: { distanceMiles: 0.2 },
  },
];

function Block({ themeName, exhausted }: { themeName: ThemeName; exhausted: boolean }) {
  return (
    <ThemeProvider force={themeName}>
      <BlockBody themeName={themeName} exhausted={exhausted} />
    </ThemeProvider>
  );
}

function BlockBody({ themeName, exhausted }: { themeName: ThemeName; exhausted: boolean }) {
  const theme = useTheme();
  const s = styles(theme);

  return (
    <View style={s.block}>
      <Text style={s.blockLabel}>
        {themeName === "dark" ? "Dark · primary" : "Light · daylight"}
        {exhausted ? " · rural exhausted" : " · shortlist"}
      </Text>
      <Text style={s.eyebrow}>Tonight</Text>
      {exhausted ? (
        <View style={s.exhausted}>
          <View style={s.mark} />
          <Text style={s.head}>You&apos;ve been to all twenty.</Text>
          <Text style={s.sub}>
            Nothing new inside {tuning.catalog.radiusMiles} miles. That&apos;s
            not a failure — it&apos;s a small town, and you&apos;ve done the
            rounds.
          </Text>
          <View style={s.exhaustedBtn}>
            <Text style={s.floatLabel}>Open it up to Sanger · 55</Text>
          </View>
        </View>
      ) : (
        <>
          <Text style={s.head}>Six I&apos;d actually send you to</Text>
          <Text style={s.sub}>Out of 21 within {tuning.catalog.radiusMiles} miles.</Text>
          <View style={s.list}>
            {CARDS.map((c, i) => (
              <PlaceCard key={c.name} {...c} isFirst={i === 0} />
            ))}
          </View>
          <Text style={s.attrib}>Ratings and hours from Google · Powered by Google</Text>
          <View style={s.floatWrap}>
            <View style={s.float}><Text style={s.floatLabel}>You pick.</Text></View>
          </View>
        </>
      )}
    </View>
  );
}

export default function ShortlistHarness() {
  const [loaded, error] = useAppFonts();
  const insets = useSafeAreaInsets();
  if (error) {
    return (
      <View style={bare.centre}>
        <Text style={bare.text}>Fonts failed to load: {error.message}</Text>
      </View>
    );
  }
  if (!loaded) return <View style={bare.blank} />;
  return (
    <ScrollView
      style={bare.blank}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 40 }}
    >
      <Block themeName="dark" exhausted={false} />
      <Block themeName="light" exhausted={false} />
      <Block themeName="dark" exhausted />
    </ScrollView>
  );
}

const sheets = new Map<string, ReturnType<typeof build>>();
function styles(theme: Theme): ReturnType<typeof build> {
  let sheet = sheets.get(theme.name);
  if (!sheet) { sheet = build(theme); sheets.set(theme.name, sheet); }
  return sheet;
}

const build = ({ colours: c, space }: Theme) =>
  StyleSheet.create({
    block: {
      backgroundColor: c.ground, paddingHorizontal: 18,
      paddingTop: space.xl, paddingBottom: space.xxxl,
    },
    blockLabel: { ...type.label, color: c.inkFaint, marginBottom: space.lg },
    eyebrow: { ...type.label, color: c.brass, marginBottom: 7 },
    head: { ...type.screenHead, color: c.ink, marginBottom: space.xs },
    sub: { ...type.body, color: c.inkMuted },
    list: { marginTop: space.lg },
    attrib: { ...type.tileMeta, color: c.inkFaint, textAlign: "center", marginTop: space.lg },
    floatWrap: { alignItems: "center", marginTop: space.lg },
    float: { backgroundColor: c.brass, borderRadius: 999, paddingVertical: 13, paddingHorizontal: 30 },
    floatLabel: { ...type.button, color: c.brassInk },
    exhausted: { paddingTop: space.xxl, rowGap: space.sm },
    exhaustedBtn: {
      marginTop: space.sm, borderRadius: 12, backgroundColor: c.brass,
      paddingVertical: 15, paddingHorizontal: space.xxl, alignSelf: "flex-start",
    },

    mark: { width: 30, height: 2, backgroundColor: c.brass, marginBottom: space.xs },
  });

const bare = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palettes.dark.ground },
  centre: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: 24, backgroundColor: palettes.dark.ground,
  },
  text: { color: palettes.dark.ink, fontSize: 15 },
});
