import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tuning } from "@/config/tuning";
import { supabase } from "@/lib/supabase";
import { palettes, ThemeProvider, useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type, useAppFonts } from "@/theme/type";

/**
 * The shelf (design spec §13).
 *
 * ONE sheet, not a section of the app. Everything you might return to
 * deliberately lives behind a single tap, and nothing else competes with the
 * primary action.
 *
 * This is why there is no tab bar. A tab bar is a standing invitation to
 * browse, and this product exists to end a decision in ninety seconds — it
 * would also put "Your usuals" permanently on screen, which contradicts §3
 * directly: a favourite carries no information, because you already know it
 * is there. Usuals are reached deliberately or they are not working as
 * designed.
 *
 * THE VETO LIST IS READABLE AND REVERSIBLE. §4 is explicit: a permanent
 * decision made in a bad mood should not be permanent. Removing a veto is one
 * tap and takes effect immediately.
 */

interface ShelfRow {
  place_id: string;
  verdict: "again" | "fine" | "known" | "not_again";
  updated_at: string;
  places: { display_name: string; locality: string | null }[] | null;
}

interface ShelfPlace {
  placeId: string;
  name: string;
  locality: string | null;
  updatedAt: string;
}

export default function ShelfRoute() {
  const [loaded, error] = useAppFonts();
  if (error) {
    return <View style={bare.centre}><Text style={bare.text}>{error.message}</Text></View>;
  }
  if (!loaded) return <View style={bare.blank} />;
  return (
    <ThemeProvider>
      <Shelf />
    </ThemeProvider>
  );
}

function Shelf() {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const rows = useQuery({
    queryKey: ["shelf"],
    queryFn: async () => {
      // RLS scopes place_verdicts to the caller, so this is theirs.
      const { data, error } = await supabase
        .from("place_verdicts")
        .select("place_id, verdict, updated_at, places(display_name, locality)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const all = (data ?? []) as ShelfRow[];
      const shape = (r: ShelfRow): ShelfPlace => ({
        placeId: r.place_id,
        name: r.places?.[0]?.display_name ?? "Somewhere",
        locality: r.places?.[0]?.locality ?? null,
        updatedAt: r.updated_at,
      });
      return {
        usuals: all.filter((r) => r.verdict === "again").map(shape),
        vetoes: all.filter((r) => r.verdict === "not_again").map(shape),
        known: all.filter((r) => r.verdict === "known" || r.verdict === "fine").map(shape),
      };
    },
  });

  // Reversing a veto deletes the verdict outright rather than downgrading it
  // to `fine`. "I take that back" is not the same claim as "it was fine", and
  // recording the weaker claim would invent an opinion nobody expressed.
  const unveto = useMutation({
    mutationFn: async (placeId: string) => {
      const { error } = await supabase.from("place_verdicts").delete().eq("place_id", placeId);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shelf"] });
      void qc.invalidateQueries({ queryKey: ["catalog_search"] });
    },
  });

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.grip} />
      <View style={s.head}>
        <Text style={s.title}>Yours</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={s.quiet}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: insets.bottom + theme.space.xxxl }}>
        {rows.isPending ? (
          <ActivityIndicator color={theme.colours.brass} style={{ marginTop: theme.space.xxl }} />
        ) : rows.isError ? (
          <Text style={s.body}>{(rows.error as Error).message}</Text>
        ) : (
          <>
            <Section
              title="Your usuals"
              hint="Places you said you'd go back to. They stay off the shortlist until they've been out of rotation long enough to be news again."
              empty="Nothing here yet. Say 'Again' to something and it'll land here."
              items={rows.data.usuals}
            />

            <Section
              title="Been there"
              hint="Everywhere you've told me you know. This is what stops the app offering you somewhere you go every week as a discovery."
              empty="Nothing yet."
              items={rows.data.known}
            />

            {/* §4: visible and editable. A permanent decision made in a bad
                mood should not be permanent. */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Never again</Text>
              <Text style={s.hint}>
                Removed from everything. Tap to put one back — you&apos;re allowed
                to change your mind.
              </Text>
              {rows.data.vetoes.length === 0 ? (
                <Text style={s.empty}>Nothing vetoed.</Text>
              ) : (
                rows.data.vetoes.map((p) => (
                  <View key={p.placeId} style={s.row}>
                    <View style={s.rowText}>
                      <Text style={s.rowName}>{p.name}</Text>
                      {p.locality ? <Text style={s.rowMeta}>{p.locality}</Text> : null}
                    </View>
                    <Pressable
                      onPress={() => unveto.mutate(p.placeId)}
                      disabled={unveto.isPending}
                      accessibilityRole="button"
                      hitSlop={8}
                      style={({ pressed }) => [s.undo, pressed && s.pressed]}
                    >
                      <Text style={s.undoLabel}>Put it back</Text>
                    </Pressable>
                  </View>
                ))
              )}
            </View>

            <View style={s.section}>
              <Text style={s.sectionTitle}>Settings</Text>
              <Text style={s.hint}>
                No account yet, and that&apos;s deliberate — Elsewhere asks for
                one only when there&apos;s something worth protecting.
              </Text>
              <Text style={s.empty}>
                Searching {tuning.catalog.radiusMiles} miles out, {tuning.catalog.poolLimit} places
                considered.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  hint,
  empty,
  items,
}: {
  title: string;
  hint: string;
  empty: string;
  items: ShelfPlace[];
}) {
  const s = styles(useTheme());
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.hint}>{hint}</Text>
      {items.length === 0 ? (
        <Text style={s.empty}>{empty}</Text>
      ) : (
        items.map((p) => (
          <Pressable
            key={p.placeId}
            onPress={() => router.push(`/place/${p.placeId}`)}
            accessibilityRole="button"
            style={({ pressed }) => [s.row, pressed && s.pressed]}
          >
            <View style={s.rowText}>
              <Text style={s.rowName}>{p.name}</Text>
              {p.locality ? <Text style={s.rowMeta}>{p.locality}</Text> : null}
            </View>
          </Pressable>
        ))
      )}
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
    grip: { width: 34, height: 4, borderRadius: radius.pill, backgroundColor: c.ruleStrong, alignSelf: "center", marginTop: 9 },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingTop: space.lg, paddingBottom: space.md },
    title: { ...type.sheetHead, color: c.ink },
    quiet: { ...type.meta, color: c.inkMuted },
    body: { ...type.body, color: c.inkMuted, marginTop: space.xl },

    section: { marginTop: space.xxl },
    sectionTitle: { ...type.label, color: c.inkFaint, marginBottom: 6 },
    hint: { ...type.tileMeta, color: c.inkMuted, marginBottom: space.md },
    empty: { ...type.meta, color: c.inkFaint },

    row: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      columnGap: space.md, paddingVertical: 13,
      borderTopWidth: hairline, borderTopColor: c.rule,
    },
    rowText: { flexShrink: 1, rowGap: 2 },
    rowName: { ...type.sheetHead, color: c.ink },
    rowMeta: { ...type.tileMeta, color: c.inkMuted },
    undo: { borderWidth: hairline, borderColor: c.brass, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: space.md },
    undoLabel: { ...type.tileMeta, color: c.brass },
    pressed: { opacity: 0.6 },
  });

const bare = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palettes.dark.ground },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: palettes.dark.ground },
  text: { color: palettes.dark.ink, fontSize: 15 },
});
