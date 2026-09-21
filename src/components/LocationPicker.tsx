// Choose where the search starts from.
//
// Spec §5.1 measures distance from your location or a saved anchor. This is
// the more useful generalisation: searching somewhere you are not yet. "We
// are driving to Gainesville, where should we eat when we get there" is a
// decision rather than a search, and it is where owning the catalog beats
// renting an API -- Google is near-me first.
//
// The towns come from the catalog. No geocoding service, no map SDK, so this
// ships over the air with no rebuild.

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text,
  TextInput, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";

/** Where distances are measured from. */
export type Origin =
  | { kind: "me" }
  | { kind: "town"; locality: string; lat: number; lon: number };

interface Locality {
  locality: string;
  lat: number;
  lon: number;
  place_count: number;
  distance_meters: number;
}

const MILES = 1609.344;

export function LocationPicker(
  { visible, origin, deviceCoords, onPick, onClose }: {
    visible: boolean;
    origin: Origin;
    /** Always the device's real position, so the list is sorted by where the
     *  user actually is even while browsing another town. */
    deviceCoords: { lat: number; lon: number } | null;
    onPick: (o: Origin) => void;
    onClose: () => void;
  },
) {
  const [search, setSearch] = useState("");

  const towns = useQuery({
    queryKey: ["localities", deviceCoords?.lat, deviceCoords?.lon],
    enabled: visible && deviceCoords !== null,
    // The town list changes only when the catalog is reingested.
    staleTime: Infinity,
    queryFn: async (): Promise<Locality[]> => {
      const { data, error } = await supabase.rpc("catalog_localities", {
        p_lat: deviceCoords!.lat,
        p_lon: deviceCoords!.lon,
        p_limit: 200,
      });
      if (error) throw error;
      return (data ?? []) as Locality[];
    },
  });

  const filtered = useMemo(() => {
    const all = towns.data ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((t) => t.locality.toLowerCase().includes(q)) : all;
  }, [towns.data, search]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.headerAction}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Start from</Text>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.searchWrap}>
          <Text style={styles.label}>Search towns</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Gainesville, Denton, Krum…"
            placeholderTextColor="#a5a5a5"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        <View style={styles.meWrap}>
          <Pressable
            onPress={() => {
              onPick({ kind: "me" });
              onClose();
            }}
            style={[styles.meButton, origin.kind === "me" && styles.meOn]}
          >
            <Text style={styles.meText}>Near me</Text>
            <Text style={styles.meHint}>Your location</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>
          {search ? "Matching towns" : "Nearby towns"}
        </Text>

        {towns.isPending
          ? <ActivityIndicator style={styles.loading} />
          : (
            <FlatList
              data={filtered}
              keyExtractor={(t) => t.locality}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const on = origin.kind === "town" &&
                  origin.locality === item.locality;
                return (
                  <Pressable
                    onPress={() => {
                      onPick({
                        kind: "town",
                        locality: item.locality,
                        lat: item.lat,
                        lon: item.lon,
                      });
                      onClose();
                    }}
                    style={styles.row}
                  >
                    <Text style={[styles.rowName, on && styles.rowNameOn]}>
                      {item.locality}
                    </Text>
                    <Text style={styles.rowCount}>
                      {item.place_count} places
                    </Text>
                    <Text style={styles.rowMiles}>
                      {(item.distance_meters / MILES).toFixed(0)} mi
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.empty}>
                  No town matches “{search}”. The catalog only covers North
                  Texas so far.
                </Text>
              }
            />
          )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ececec",
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerAction: { fontSize: 16, color: "#2a6fd6" },
  headerSpacer: { width: 48 },
  searchWrap: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10 },
  label: { fontSize: 13, color: "#8a8a8a", marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: "#dcdcdc", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: "#111",
  },
  meWrap: { paddingHorizontal: 20, paddingTop: 6 },
  meButton: {
    flexDirection: "row", alignItems: "center", gap: 11,
    paddingVertical: 15, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: "#dcdcdc",
  },
  meOn: { borderWidth: 2, borderColor: "#111" },
  meText: { flexGrow: 1, fontSize: 16, fontWeight: "600", color: "#111" },
  meHint: { fontSize: 14, color: "#6b6b6b" },
  sectionLabel: {
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, fontSize: 13,
    fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase",
    color: "#8a8a8a",
  },
  loading: { marginTop: 24 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  row: {
    flexDirection: "row", alignItems: "baseline", gap: 10,
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#f0f0f0",
  },
  rowName: { flexGrow: 1, fontSize: 17, color: "#111" },
  rowNameOn: { fontWeight: "700" },
  rowCount: { fontSize: 14, color: "#8a8a8a" },
  rowMiles: {
    fontSize: 14, fontWeight: "600", color: "#6b6b6b", width: 46,
    textAlign: "right",
  },
  empty: { fontSize: 15, color: "#6b6b6b", lineHeight: 22, paddingTop: 12 },
});
