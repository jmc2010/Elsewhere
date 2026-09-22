import { ScrollView, StyleSheet, Text, View } from "react-native";

import { SurpriseReveal, type RevealCandidate } from "@/components/SurpriseReveal";
import { palettes, ThemeProvider, type ThemeName } from "@/theme/tokens";
import { useAppFonts } from "@/theme/type";

/** Reveal harness -- NOT a product screen. Real Valley View rows. */
const CANDIDATES: RevealCandidate[] = [
  {
    placeId: "1",
    name: "Texas Legacy Distillery",
    cuisine: "Distillery",
    locality: "Valley View",
    distanceMiles: 0.2,
    why: "New name since the spring. You'd be the first to say anything.",
  },
  { placeId: "2", name: "Tia's Tex-Mex", cuisine: "Tex-Mex", locality: "Valley View", distanceMiles: 0.1, rating: 4.4 },
  { placeId: "3", name: "Middlebrooks Bar & Grill", cuisine: "Bar", locality: "Valley View", distanceMiles: 0.2, rating: 4.3 },
  { placeId: "4", name: "THE 1845 Bar & Lounge", cuisine: "Cocktail Bar", locality: "Valley View", distanceMiles: 0.2 },
];

function Block({ themeName }: { themeName: ThemeName }) {
  return (
    <ThemeProvider force={themeName}>
      <View style={{ height: 720 }}>
        <SurpriseReveal candidates={CANDIDATES} onClose={() => {}} onCommit={() => {}} />
      </View>
    </ThemeProvider>
  );
}

export default function RevealHarness() {
  const [loaded, error] = useAppFonts();
  if (error) return <View style={bare.centre}><Text style={bare.text}>{error.message}</Text></View>;
  if (!loaded) return <View style={bare.blank} />;
  return (
    <ScrollView style={bare.blank}>
      <Block themeName="dark" />
      <Block themeName="light" />
    </ScrollView>
  );
}

const bare = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palettes.dark.ground },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: palettes.dark.ground },
  text: { color: palettes.dark.ink, fontSize: 15 },
});
