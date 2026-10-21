import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { tabular, type } from "@/theme/type";

/**
 * Find a place by name.
 *
 * Added 2026-10-20. Towns have been searchable since 0020; places never were,
 * so the only way to reach a restaurant was for the shortlist to offer it --
 * 15 of 750 in Denton. "I ended up coming up with a different idea that I went
 * with and enjoyed. I wasn't able to find those though."
 *
 * Layer 1 only. catalog_find_by_name is Postgres and PostGIS, no Google call
 * at any point, so typing is free however much of it you do. The results are
 * catalog rows: name, cuisine, town, distance. Anything Google knows costs
 * money and is fetched only if you open the place.
 *
 * No radius. You are naming somewhere, not browsing near somewhere, and the
 * function sorts by distance so the near ones arrive first anyway.
 */
const MILES = 1609.344;

interface Hit {
  place_id: string;
  display_name: string;
  locality: string | null;
  cuisines: string[];
  distance_meters: number;
  my_verdict: string | null;
}

export default function Find() {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();
  const { lat, lon } = useLocalSearchParams<{ lat?: string; lon?: string }>();

  const [text, setText] = useState("");
  // Debounced separately from `text` so the field stays immediate while the
  // query does not fire per keystroke. 250ms is below the point where typing
  // feels laggy and above the point where every letter is a round trip.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 250);
    return () => clearTimeout(t);
  }, [text]);

  const centre = {
    lat: lat ? Number(lat) : null,
    lon: lon ? Number(lon) : null,
  };

  const hits = useQuery({
    queryKey: ["find", query, centre.lat, centre.lon],
    enabled: query.trim().length >= 2 && centre.lat !== null && centre.lon !== null,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Hit[]> => {
      const { data, error } = await supabase.rpc("catalog_find_by_name", {
        p_lat: centre.lat!,
        p_lon: centre.lon!,
        p_query: query.trim(),
        p_limit: 20,
      });
      if (error) throw error;
      return (data ?? []) as Hit[];
    },
  });

  const typed = text.trim().length;
  const results = hits.data ?? [];

  return (
    <View style={s.screen}>
      <View style={[s.top, { paddingTop: insets.top + theme.space.lg }]}>
        <Text style={s.title}>Where did you go?</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={s.cancel}>Cancel</Text>
        </Pressable>
      </View>

      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Search any restaurant…"
        placeholderTextColor={theme.colours.inkFaint}
        autoFocus
        autoCorrect={false}
        returnKeyType="search"
        style={s.input}
        accessibilityLabel="Search for a restaurant by name"
      />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + theme.space.xxxl }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Four states, and none of them is a spinner over an empty list.
            The absence of a result is information. */}
        {typed === 0 ? (
          <Text style={s.hint}>
            Type a name. Anywhere in the catalog, however far away — this is for
            telling me where you actually ended up.
          </Text>
        ) : typed < 2 ? (
          <Text style={s.hint}>Keep going — two letters at least.</Text>
        ) : hits.isPending ? (
          <Text style={s.hint}>Looking…</Text>
        ) : hits.isError ? (
          <Text style={s.hint}>That search didn&apos;t work. Try again?</Text>
        ) : results.length === 0 ? (
          <Text style={s.hint}>
            Nothing called that. The catalog is Overture and Foursquare open
            data, so somewhere very new may simply not be in it yet.
          </Text>
        ) : (
          results.map((h) => (
            <Pressable
              key={h.place_id}
              onPress={() => router.push(`/place/${h.place_id}`)}
              accessibilityRole="button"
              style={({ pressed }) => [s.row, pressed && s.pressed]}
            >
              <View style={s.rowText}>
                <Text style={s.name}>{h.display_name}</Text>
                <Text style={s.meta} numberOfLines={1}>
                  {[h.locality, h.cuisines[0]].filter(Boolean).join(" · ")}
                </Text>
              </View>
              <Text style={[s.dist, tabular]}>
                {(h.distance_meters / MILES).toFixed(1)} mi
              </Text>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = (t: Theme) => build(t, t.name);
const build = ({ colours: c, space, hairline }: Theme, _n: ThemeName) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.ground, paddingHorizontal: 18 },
    top: {
      flexDirection: "row", alignItems: "baseline",
      justifyContent: "space-between", marginBottom: space.lg,
    },
    title: { ...type.sheetHead, color: c.ink },
    cancel: { ...type.meta, color: c.inkMuted },
    input: {
      ...type.body, color: c.ink,
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: 12,
      paddingVertical: 12, paddingHorizontal: 14, marginBottom: space.lg,
    },
    hint: { ...type.reason, color: c.inkMuted, marginTop: space.md },
    row: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      paddingVertical: space.md, borderBottomWidth: hairline, borderBottomColor: c.rule,
      columnGap: space.md,
    },
    pressed: { opacity: 0.6 },
    rowText: { flexShrink: 1 },
    name: { ...type.cardName, color: c.ink },
    meta: { ...type.meta, color: c.inkMuted },
    dist: { ...type.meta, color: c.inkFaint },
  });
