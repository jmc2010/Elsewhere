import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecognitionGrid, type RecognitionPlace } from "@/components/RecognitionGrid";
import { palettes, ThemeProvider, useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type, useAppFonts } from "@/theme/type";

/**
 * Recognition-grid harness -- NOT a product screen.
 *
 * Same purpose as /harness: check the grid against the canvas in both themes
 * without needing a location fix, a session, or a database. The rows are real
 * catalog rows from the Dallas pool, including the awkward ones -- a long
 * name that must wrap to two lines, and a place with no cuisine.
 */

const PLACES: RecognitionPlace[] = [
  { placeId: "1", name: "Middlebrooks Bar & Grill", cuisine: "Bar" },
  { placeId: "2", name: "Tia's Tex-Mex", cuisine: "Tex-Mex" },
  { placeId: "3", name: "Texas Legacy Distillery", cuisine: "Distillery" },
  { placeId: "4", name: "Lil Brick Oven Pizza", cuisine: "Pizza" },
  { placeId: "5", name: "The Bluebonnet Cafe and Coffee Bar", cuisine: "Coffee" },
  { placeId: "6", name: "Funky Munky Shaved Ice Valley View", cuisine: "Dessert" },
  { placeId: "7", name: "Chapps Cafe", cuisine: "New American" },
  { placeId: "8", name: "Jones Cafe", cuisine: null },
  { placeId: "9", name: "Daily Donuts", cuisine: "Donuts" },
  { placeId: "10", name: "THE 1845 Bar & Lounge", cuisine: "Cocktail Bar" },
  { placeId: "11", name: "Uptown Thai", cuisine: "Thai" },
  { placeId: "12", name: "Café Victoria", cuisine: "Coffee" },
];

function Block({ themeName }: { themeName: ThemeName }) {
  return (
    <ThemeProvider force={themeName}>
      <BlockBody themeName={themeName} />
    </ThemeProvider>
  );
}

function BlockBody({ themeName }: { themeName: ThemeName }) {
  const theme = useTheme();
  const s = styles(theme);
  // Three tapped, so the selected state is visible next to the unselected one.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(["2", "5", "9"]),
  );

  return (
    <View style={s.block}>
      <Text style={s.blockLabel}>
        {themeName === "dark" ? "Dark · primary" : "Light · daylight"}
      </Text>
      <Text style={s.eyebrow}>First things first</Text>
      <Text style={s.head}>Which of these do you already know?</Text>
      <Text style={s.sub}>
        Tap every one you&apos;ve been to. I&apos;m not asking what you liked —
        just what you&apos;ve already seen.
      </Text>
      <View style={s.gridWrap}>
        <RecognitionGrid
          places={PLACES}
          selected={selected}
          onToggle={(id) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })
          }
        />
      </View>
    </View>
  );
}

export default function GridHarness() {
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
      <Block themeName="dark" />
      <Block themeName="light" />
    </ScrollView>
  );
}

const sheets = new Map<ThemeName, ReturnType<typeof build>>();
function styles(theme: Theme): ReturnType<typeof build> {
  let sheet = sheets.get(theme.name);
  if (!sheet) { sheet = build(theme); sheets.set(theme.name, sheet); }
  return sheet;
}

const build = ({ colours: c, space }: Theme) =>
  StyleSheet.create({
    block: {
      backgroundColor: c.ground,
      paddingHorizontal: 18,
      paddingTop: space.xl,
      paddingBottom: space.xxxl,
    },
    blockLabel: { ...type.label, color: c.inkFaint, marginBottom: space.lg },
    eyebrow: { ...type.label, color: c.brass, marginBottom: 7 },
    head: { ...type.screenHead, color: c.ink, marginBottom: space.xs },
    sub: { ...type.body, color: c.inkMuted },
    gridWrap: { marginTop: space.xl },
  });

const bare = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palettes.dark.ground },
  centre: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: 24, backgroundColor: palettes.dark.ground,
  },
  text: { color: palettes.dark.ink, fontSize: 15 },
});
