import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { ReviewCapture, type Tag } from "@/components/ReviewCapture";
import { palettes, ThemeProvider, type ThemeName } from "@/theme/tokens";
import { useAppFonts } from "@/theme/type";

/** Review-capture harness -- NOT a product screen. Real seeded tags. */
const TAGS: Tag[] = [
  { key: "food_great", label: "Food was great", valence: "pos" },
  { key: "drive_worth", label: "Worth the drive", valence: "pos" },
  { key: "patio_good", label: "Good patio", valence: "pos" },
  { key: "quiet_talk", label: "Quiet enough to talk", valence: "pos" },
  { key: "bar_good", label: "Good bar", valence: "pos" },
  { key: "fast", label: "Fast", valence: "pos" },
  { key: "kids_great", label: "Great with kids", valence: "pos" },
  { key: "date_good", label: "Good for a date", valence: "pos" },
  { key: "group_good", label: "Fits a group", valence: "pos" },
  { key: "price_fair", label: "Fair price", valence: "pos" },
  { key: "food_off", label: "Food was off", valence: "neg" },
  { key: "drive_not_worth", label: "Not worth the drive", valence: "neg" },
  { key: "too_loud", label: "Too loud", valence: "neg" },
  { key: "slow", label: "Slow", valence: "neg" },
  { key: "price_over", label: "Overpriced", valence: "neg" },
  { key: "service_poor", label: "Service was indifferent", valence: "neg" },
  { key: "too_crowded", label: "Too crowded", valence: "neg" },
  { key: "wrong_for_kids", label: "Wrong for kids", valence: "neg" },
  { key: "felt_dirty", label: "Felt dirty", valence: "neg" },
  { key: "menu_nothing", label: "Nothing for me on the menu", valence: "neg" },
];

function Block({ themeName }: { themeName: ThemeName }) {
  return (
    <ThemeProvider force={themeName}>
      <View style={{ height: 820 }}>
        <ReviewCapture
          subject={{ placeId: "1", name: "Middlebrooks Bar & Grill" }}
          tags={TAGS}
          onSubmit={() => {}}
          onDidNotGo={() => {}}
          onDismiss={() => {}}
        />
      </View>
    </ThemeProvider>
  );
}

export default function ReviewHarness() {
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
