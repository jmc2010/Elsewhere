import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tuning } from "@/config/tuning";
import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { tabular, type } from "@/theme/type";

/**
 * Where to search from (design spec §6).
 *
 * **The control changes shape with density, and that is the whole idea.**
 *
 *   Low density  -> a nearest-first TOWN list with real catalog counts.
 *                   Rurally, distance is a cliff rather than a dial: five
 *                   miles is a handful of places and ten miles is a whole
 *                   other town. Asking "how far?" is asking a question the
 *                   user cannot answer; asking "which town?" is asking the
 *                   one they are already thinking in.
 *
 *   High density -> miles, because downtown density really is continuous and
 *                   a town name there means nothing useful.
 *
 * And "somewhere I'm heading" stays in both: searching a town before you
 * arrive is a decision-engine feature that map-first competitors do badly,
 * because they are overwhelmingly near-me first.
 *
 * No geocoding service is involved anywhere here. The catalog already knows
 * every town and where it is.
 */

export interface Town {
  locality: string;
  lat: number;
  lon: number;
  place_count: number;
  distance_meters: number;
}

export type Origin =
  | { kind: "me" }
  | { kind: "town"; name: string; lat: number; lon: number };

export interface LocationPickerProps {
  towns: Town[];
  origin: Origin;
  radiusMiles: number;
  /** How many places are within reach right now. Decides the control's shape. */
  localCount: number;
  onPick: (origin: Origin, radiusMiles: number) => void;
  onCancel: () => void;
}

const MILES = 1609.344;
const RADIUS_CHOICES = [2, 5, 10, 20];

export function LocationPicker({
  towns,
  origin,
  radiusMiles,
  localCount,
  onPick,
  onCancel,
}: LocationPickerProps) {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();
  const [radius, setRadius] = useState(radiusMiles);
  const [query, setQuery] = useState("");

  /**
   * Nearest-first, or name-matched when searching.
   *
   * The list is nearest-first because that is what you usually want. But
   * "somewhere I'm heading" is the case that makes owning the catalog worth
   * anything -- deciding where to eat in a town before you get there is a
   * decision a map-first competitor handles badly, because they are
   * overwhelmingly near-me first. A list capped at the nearest few towns
   * quietly removes exactly that, so typing searches the WHOLE catalog of
   * towns, at any distance.
   */
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return towns;
    return towns
      .filter((t) => t.locality.toLowerCase().includes(q))
      // When searching, the nearest match is rarely the point -- somebody
      // typing "Denton" wants Denton. Rank by how early the match lands, then
      // by how many places are there.
      .sort((a, b) =>
        a.locality.toLowerCase().indexOf(q) - b.locality.toLowerCase().indexOf(q) ||
        b.place_count - a.place_count);
  }, [towns, query]);

  // The shape switch. Below the threshold the town list is the useful
  // control; above it, miles are.
  const dense = localCount >= tuning.location.denseThreshold;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.grip} />
      <View style={s.head}>
        <Text style={s.title}>Where from?</Text>
        <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={12}>
          <Text style={s.quiet}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Pressable
          onPress={() => onPick({ kind: "me" }, radius)}
          accessibilityRole="button"
          style={({ pressed }) => [s.me, origin.kind === "me" && s.meOn, pressed && s.pressed]}
        >
          <Text style={[s.meLabel, origin.kind === "me" && s.meLabelOn]}>Where I am</Text>
          <Text style={s.meHint}>{localCount} within {radius} miles</Text>
        </Pressable>

        {dense ? (
          <View style={s.group}>
            <Text style={s.lab}>How far</Text>
            <View style={s.pills}>
              {RADIUS_CHOICES.map((r) => {
                const on = r === radius;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setRadius(r)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => [s.pill, on && s.pillOn, pressed && !on && s.pressed]}
                  >
                    <Text style={[s.pillLabel, on && s.pillLabelOn, tabular]}>{r} mi</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={s.group}>
          <Text style={s.lab}>
            {dense ? "Somewhere I'm heading" : "Or somewhere I'm heading"}
          </Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search any town…"
            placeholderTextColor={theme.colours.inkFaint}
            style={s.search}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="search"
          />
          <View style={s.towns}>
            {shown.length === 0 ? (
              <Text style={s.none}>
                Nothing called that with somewhere to eat in it.
              </Text>
            ) : null}
            {shown.map((t) => {
              const on = origin.kind === "town" && origin.name === t.locality;
              return (
                <Pressable
                  key={t.locality}
                  onPress={() =>
                    onPick({ kind: "town", name: t.locality, lat: t.lat, lon: t.lon }, radius)
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [s.town, pressed && s.pressed]}
                >
                  <View style={s.townText}>
                    <Text style={[s.townName, on && s.townNameOn]}>{t.locality}</Text>
                    <Text style={[s.townDist, tabular]}>
                      {(t.distance_meters / MILES).toFixed(1)} mi away
                    </Text>
                  </View>
                  {/* The real catalog count, not an estimate. It is the whole
                      reason this list beats a distance dial rurally. */}
                  <Text style={[s.townCount, tabular]}>{t.place_count}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[s.actbar, { paddingBottom: insets.bottom + theme.space.lg }]} />
    </View>
  );
}

const sheets = new Map<ThemeName, ReturnType<typeof build>>();
function styles(theme: Theme): ReturnType<typeof build> {
  let sheet = sheets.get(theme.name);
  if (!sheet) { sheet = build(theme); sheets.set(theme.name, sheet); }
  return sheet;
}

const build = ({ colours: c, space, radius, hairline }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.surface },
    grip: {
      width: 34, height: 4, borderRadius: radius.pill,
      backgroundColor: c.ruleStrong, alignSelf: "center", marginTop: 9,
    },
    head: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      paddingHorizontal: 18, paddingTop: space.lg, paddingBottom: space.md,
    },
    title: { ...type.sheetHead, color: c.ink },
    quiet: { ...type.meta, color: c.inkMuted },
    body: { paddingHorizontal: 18, paddingBottom: space.xl },

    me: {
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.button,
      paddingVertical: 14, paddingHorizontal: space.lg, rowGap: 2,
    },
    meOn: { borderColor: c.brass, backgroundColor: c.surface2 },
    meLabel: { ...type.body, color: c.ink },
    meLabelOn: { color: c.brass },
    meHint: { ...type.tileMeta, color: c.inkMuted },

    group: { marginTop: space.xl },
    lab: { ...type.label, color: c.inkFaint, marginBottom: 9 },
    pills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
    pill: {
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.pill,
      paddingVertical: 7, paddingHorizontal: space.md,
    },
    pillOn: { backgroundColor: c.ink, borderColor: c.ink },
    pillLabel: { ...type.meta, color: c.ink },
    pillLabelOn: { color: c.ground },

    search: {
      ...type.body, color: c.ink,
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.field,
      paddingHorizontal: space.md, paddingVertical: space.sm,
      marginBottom: space.sm,
    },
    none: { ...type.meta, color: c.inkFaint, paddingVertical: space.md },
    towns: {},
    town: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "baseline",
      columnGap: space.md, paddingVertical: 14,
      borderTopWidth: hairline, borderTopColor: c.rule,
    },
    townText: { flexShrink: 1, rowGap: 2 },
    townName: { ...type.sheetHead, color: c.ink },
    townNameOn: { color: c.brass },
    townDist: { ...type.tileMeta, color: c.inkMuted },
    townCount: { ...type.meta, color: c.inkFaint },

    actbar: { borderTopWidth: hairline, borderTopColor: c.rule, paddingTop: space.lg },
    pressed: { opacity: 0.6 },
  });
