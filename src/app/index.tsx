// Home — "Where to tonight?"
//
// Proves the Phase 1 spine end to end: location -> catalog_search -> a list of
// real places. No Google call happens anywhere on this screen, and none ever
// should: browse and filter are free, which is the whole reason the
// three-layer split exists (CLAUDE.md, spec §4).
//
// The query lives here rather than behind a repository, per CLAUDE.md:
// screens own their own queries.

import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text,
  View,
} from "react-native";

import { ensureSession, supabase } from "@/lib/supabase";

/** Mirrors catalog_search()'s RETURNS TABLE. */
interface CatalogPlace {
  place_id: string;
  name: string;
  lat: number;
  lon: number;
  distance_meters: number;
  address_line: string | null;
  locality: string | null;
  website: string | null;
  cuisines: string[];
  delivery_only: boolean;
  last_visited_at: string | null;
  visit_count: number;
}

const MILES = 1609.344;
const DEFAULT_RADIUS_MI = 20;

type Permission = "unknown" | "explaining" | "granted" | "denied";

export default function Home() {
  const [permission, setPermission] = useState<Permission>("unknown");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    ensureSession()
      .then(() => setSessionReady(true))
      .catch((e: unknown) =>
        setSessionError(e instanceof Error ? e.message : String(e))
      );
  }, []);

  // Spec §9 requires a clear in-context rationale BEFORE the OS prompt. The
  // OS prompt can only be asked once; spending it before the user understands
  // why is how apps end up permanently denied.
  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      setPermission(status === "granted" ? "granted" : "explaining");
    });
  }, []);

  const requestLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermission(status === "granted" ? "granted" : "denied");
  }, []);

  useEffect(() => {
    if (permission !== "granted") return;
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((pos) =>
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      )
      .catch(() => setPermission("denied"));
  }, [permission]);

  const { data, isPending, error } = useQuery({
    queryKey: ["catalog_search", coords?.lat, coords?.lon],
    enabled: sessionReady && coords !== null,
    queryFn: async (): Promise<CatalogPlace[]> => {
      // Called as an RPC rather than through an edge function: it holds no
      // secrets, and the saved hop matters inside a 90-second decision
      // window. Argument validation lives in the function itself, so it
      // holds for every caller. See docs/STATUS.md.
      const { data, error } = await supabase.rpc("catalog_search", {
        p_lat: coords!.lat,
        p_lon: coords!.lon,
        p_radius_meters: DEFAULT_RADIUS_MI * MILES,
        p_limit: 25,
      });
      if (error) throw error;
      return (data ?? []) as CatalogPlace[];
    },
  });

  if (sessionError) return <Message title="Couldn't connect" body={sessionError} />;

  if (permission === "explaining") {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <Text style={styles.title}>Where to tonight?</Text>
          <Text style={styles.body}>
            Elsewhere needs your location to find places to eat nearby.
            That&apos;s the only thing we ask for — no account, no bank login.
          </Text>
          <Text style={styles.bodyQuiet}>
            Your location stays on your device and is never shared.
          </Text>
          <Pressable style={styles.button} onPress={requestLocation}>
            <Text style={styles.buttonText}>Find places near me</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (permission === "denied") {
    return (
      <Message
        title="Location is off"
        body={
          "Elsewhere needs location to find places near you. You can turn it " +
          "on in Settings. Saved anchors like home and work are coming, so " +
          "this won't always be required."
        }
      />
    );
  }

  if (!sessionReady || isPending || !coords) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.bodyQuiet}>Finding places near you…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return <Message title="Search failed" body={error.message} />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Where to tonight?</Text>
        <Text style={styles.bodyQuiet}>
          {data.length} places within {DEFAULT_RADIUS_MI} miles
        </Text>
      </View>
      <FlatList
        data={data}
        keyExtractor={(p) => p.place_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardMeta}>
              {(item.distance_meters / MILES).toFixed(1)} mi
              {item.locality ? ` · ${item.locality}` : ""}
            </Text>
            {item.cuisines.length > 0 && (
              <Text style={styles.cardCuisine}>{item.cuisines.join(" · ")}</Text>
            )}
            {/* Rating, price and open-now are Layer 2 and are deliberately
                absent until places-proxy hydrates this shortlist. About one
                card in four will never have them (docs/measurements.md), so
                the design has to read well without them rather than treating
                their absence as a loading state. */}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.centered}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  centered: { flex: 1, justifyContent: "center", padding: 28, gap: 14 },
  header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 4 },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  body: { fontSize: 16, lineHeight: 23 },
  bodyQuiet: { fontSize: 14, color: "#6b6b6b", lineHeight: 20 },
  button: {
    marginTop: 10, backgroundColor: "#111", paddingVertical: 15,
    borderRadius: 12, alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  list: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  card: {
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: "#f6f6f6", gap: 3,
  },
  cardName: { fontSize: 17, fontWeight: "600" },
  cardMeta: { fontSize: 14, color: "#6b6b6b" },
  cardCuisine: { fontSize: 13, color: "#8a8a8a" },
});
