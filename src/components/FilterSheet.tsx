// The filter sheet — spec §5.1's workhorse.
//
// Only Layer 1 and Layer 3 filters live here. Rating, price and open-now are
// Layer 2: we do not hold that data until a shortlist is hydrated, so they
// cannot narrow the query and must be applied after. Putting them in this
// sheet would imply the catalog can answer them, and it cannot.
//
// Cuisine is hierarchical. Selecting a GROUP means all of its leaves
// (per the taxonomy seed), and catalog_search expands group slugs server-side
// so the client sends whichever the user actually tapped.

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";

export interface Filters {
  radiusMiles: number;
  cuisines: string[];
  /** Layer 2. Applied after hydration, not in catalog_search. */
  minRating: number | null;
  /** An unrated place is not a badly-rated one, so it is kept by default. */
  includeUnrated: boolean;
  /** Layer 2, like minRating. A closed restaurant is useless at any rating. */
  openNow: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  radiusMiles: 20,
  cuisines: [],
  minRating: null,
  includeUnrated: true,
  openNow: false,
};

const RATINGS: { label: string; value: number | null }[] = [
  { label: "Any", value: null },
  { label: "3.5+", value: 3.5 },
  { label: "4.0+", value: 4.0 },
  { label: "4.5+", value: 4.5 },
];

// Deliberately coarse. A slider invites fiddling, and the decision window is
// ~90 seconds (spec §3) -- four taps covers the real range from "in town" to
// "worth the drive".
const RADII = [5, 10, 20, 50];

interface CuisineRow {
  id: number;
  slug: string;
  label: string;
  parent_id: number | null;
}

export function FilterSheet(
  { visible, filters, onApply, onClose }: {
    visible: boolean;
    filters: Filters;
    onApply: (f: Filters) => void;
    onClose: () => void;
  },
) {
  const [draft, setDraft] = useState<Filters>(filters);

  const cuisines = useQuery({
    queryKey: ["cuisines"],
    // The taxonomy changes only with a migration, so there is no reason to
    // refetch it during a session.
    staleTime: Infinity,
    // Flat select rather than an embedded parent: PostgREST returns embedded
    // resources as arrays, which supabase-js then types awkwardly, and the
    // parent is only needed to tell groups from leaves.
    queryFn: async (): Promise<CuisineRow[]> => {
      const { data, error } = await supabase
        .from("cuisines")
        .select("id, slug, label, parent_id")
        .order("label");
      if (error) throw error;
      return (data ?? []) as CuisineRow[];
    },
  });

  // parent_id null marks a group; leaves hang off them (taxonomy seed, 0002).
  const groups = (cuisines.data ?? []).filter((c) => c.parent_id === null);

  const toggle = (slug: string) =>
    setDraft((d) => ({
      ...d,
      cuisines: d.cuisines.includes(slug)
        ? d.cuisines.filter((s) => s !== slug)
        : [...d.cuisines, slug],
    }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Filters</Text>
          <Pressable onPress={() => setDraft(DEFAULT_FILTERS)} hitSlop={12}>
            <Text style={styles.headerAction}>Reset</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.section}>How far?</Text>
          <View style={styles.row}>
            {RADII.map((mi) => (
              <Pressable
                key={mi}
                onPress={() => setDraft((d) => ({ ...d, radiusMiles: mi }))}
                style={[
                  styles.pill,
                  draft.radiusMiles === mi && styles.pillOn,
                ]}
              >
                <Text
                  style={[
                    styles.pillText,
                    draft.radiusMiles === mi && styles.pillTextOn,
                  ]}
                >
                  {mi} mi
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.section}>Open now?</Text>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchLabel}>Only places open now</Text>
              <Text style={styles.switchHint}>
                Hours come from Google. Places with no listing are kept —
                they are not known to be closed.
              </Text>
            </View>
            <Switch
              value={draft.openNow}
              onValueChange={(v) => setDraft((d) => ({ ...d, openNow: v }))}
              trackColor={{ true: "#111", false: "#d6d6d6" }}
            />
          </View>

          <Text style={styles.section}>How good?</Text>
          <Text style={styles.hint}>
            Ratings come from Google and are fetched for the shortlist, so a
            rating filter costs a little more than the others.
          </Text>
          <View style={styles.row}>
            {RATINGS.map((r) => {
              const on = draft.minRating === r.value;
              return (
                <Pressable
                  key={r.label}
                  onPress={() => setDraft((d) => ({ ...d, minRating: r.value }))}
                  style={[styles.pill, on && styles.pillOn]}
                >
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>
                    {r.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {draft.minRating !== null && (
            // About one place in four has no Google listing at all, and those
            // skew to rural independents -- the population this catalog exists
            // to surface. Excluding them would quietly narrow the app to
            // "restaurants Google knows well" exactly when someone is being
            // selective, so the default keeps them.
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchLabel}>Include unrated places</Text>
                <Text style={styles.switchHint}>
                  Some places have no Google listing. No rating isn&apos;t a bad
                  rating.
                </Text>
              </View>
              <Switch
                value={draft.includeUnrated}
                onValueChange={(v) =>
                  setDraft((d) => ({ ...d, includeUnrated: v }))}
                trackColor={{ true: "#111", false: "#d6d6d6" }}
              />
            </View>
          )}

          <Text style={styles.section}>What kind?</Text>
          <Text style={styles.hint}>
            Nothing selected means everything.
          </Text>
          {cuisines.isPending
            ? <ActivityIndicator style={styles.loading} />
            : (
              <View style={styles.wrap}>
                {groups.map((g) => {
                  const on = draft.cuisines.includes(g.slug);
                  return (
                    <Pressable
                      key={g.slug}
                      onPress={() => toggle(g.slug)}
                      style={[styles.pill, on && styles.pillOn]}
                    >
                      <Text style={[styles.pillText, on && styles.pillTextOn]}>
                        {g.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={styles.apply}
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          >
            <Text style={styles.applyText}>
              {[
                draft.cuisines.length === 0
                  ? "Show everything"
                  : `Show ${draft.cuisines.length} selected`,
                draft.minRating ? `${draft.minRating}+ stars` : null,
                draft.openNow ? "open now" : null,
                `within ${draft.radiusMiles} mi`,
              ].filter(Boolean).join(" · ")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ddd",
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerAction: { fontSize: 16, color: "#2a6fd6" },
  body: { padding: 20, gap: 10, paddingBottom: 40 },
  section: { fontSize: 20, fontWeight: "700", marginTop: 14 },
  hint: { fontSize: 13, color: "#8a8a8a", marginBottom: 4 },
  row: { flexDirection: "row", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  loading: { marginTop: 16 },
  switchRow: {
    flexDirection: "row", alignItems: "center", gap: 14, marginTop: 6,
    paddingVertical: 10,
  },
  switchText: { flexShrink: 1, gap: 2 },
  switchLabel: { fontSize: 16, color: "#111" },
  switchHint: { fontSize: 13, color: "#8a8a8a", lineHeight: 18 },
  pill: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20,
    backgroundColor: "#f0f0f0",
  },
  pillOn: { backgroundColor: "#111" },
  pillText: { fontSize: 15, color: "#333" },
  pillTextOn: { color: "#fff", fontWeight: "600" },
  footer: {
    padding: 20, borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ddd",
  },
  apply: {
    backgroundColor: "#111", paddingVertical: 15, borderRadius: 12,
    alignItems: "center",
  },
  applyText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
