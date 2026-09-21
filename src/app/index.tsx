// Home — "Where to tonight?"
//
// The Phase 1 shortlist. Two queries, deliberately separate:
//
//   1. catalog_search   Layer 1 + Layer 3, over RPC. Free, fast, no Google.
//   2. places-proxy     Layer 2. Costs money, can be slow, can fail.
//
// The list renders from (1) the moment it arrives and is enriched by (2) when
// it lands. Blocking the list on hydration would spend the 90-second decision
// window (spec §3) waiting on the slowest and least reliable part.
//
// Queries live in the screen, per CLAUDE.md: screens own their own queries.

import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  DEFAULT_FILTERS, FilterSheet, Filters,
} from "@/components/FilterSheet";
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
  /** Overture's locality is uncorroborated; hide it rather than print a town
   *  261 miles away. See migration 0013. */
  locality_suspect: boolean;
  last_visited_at: string | null;
  visit_count: number;
}

/** Google-derived. Request-scoped, never stored. */
interface LiveFields {
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  regularOpeningHours?: { openNow?: boolean };
}

interface HydratedPlace {
  place_id: string;
  live: LiveFields | null;
  live_status: "ok" | "unresolved" | "quota_exceeded" | "error";
}

interface HydrateResponse {
  quota: { granted: number; degraded: boolean };
  places: HydratedPlace[];
}

const MILES = 1609.344;

// Hydrate exactly what is shown. The spec's 25-candidate pool exists so that
// Layer 2 filters (rating floor, open now, price) can cut it to ~10 — until
// the filter sheet exists there is nothing to cut with, so fetching 25 would
// buy 15 Google calls for cards nobody sees.
const SHORTLIST = 10;

const PRICE: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

type Permission = "unknown" | "explaining" | "granted" | "denied";

export default function Home() {
  const [permission, setPermission] = useState<Permission>("unknown");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  // One id per app run, so calls-per-session is measurable (spec §5).
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sessionId] = useState(
    () => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  useEffect(() => {
    ensureSession()
      .then(() => setSessionReady(true))
      .catch((e: unknown) =>
        setSessionError(e instanceof Error ? e.message : String(e))
      );
  }, []);

  // Spec §9: a clear in-context rationale BEFORE the OS prompt. The prompt can
  // only be spent once, and spending it before the user understands why is how
  // apps end up permanently denied.
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

  const catalog = useQuery({
    queryKey: ["catalog_search", coords?.lat, coords?.lon, filters],
    enabled: sessionReady && coords !== null,
    queryFn: async (): Promise<CatalogPlace[]> => {
      const { data, error } = await supabase.rpc("catalog_search", {
        p_lat: coords!.lat,
        p_lon: coords!.lon,
        p_radius_meters: filters.radiusMiles * MILES,
        // Empty means no cuisine filter at all. Sending an empty array would
        // make catalog_search raise, since a slug list that matches nothing is
        // a caller bug there.
        p_cuisines: filters.cuisines.length ? filters.cuisines : null,
        p_limit: SHORTLIST,
      });
      if (error) throw error;
      return (data ?? []) as CatalogPlace[];
    },
  });

  const ids = catalog.data?.map((p) => p.place_id) ?? [];

  // Hydration is cached PER PLACE, not per query.
  //
  // Keying on the whole id list meant every filter change was a total cache
  // miss: measured at 42 Google calls in 62 seconds of filter browsing, about
  // 70% of the daily quota, re-fetching places that had been hydrated seconds
  // earlier. Filtering from "everything" to "barbecue" re-bought every
  // barbecue place.
  //
  // Accumulating by place id means a filter change only pays for places it has
  // not seen. That matters because the filter sheet actively invites the
  // browsing that triggered it.
  const [liveById, setLiveById] = useState<Map<string, HydratedPlace>>(
    () => new Map(),
  );

  const missing = ids.filter((id) => !liveById.has(id));

  const hydration = useQuery({
    // join() rather than the array: a fresh array with identical contents is a
    // different key by reference, which would re-fetch on every render.
    queryKey: ["hydrate", missing.join(",")],
    enabled: missing.length > 0,
    gcTime: 10 * 60 * 1000,
    queryFn: async (): Promise<HydrateResponse> => {
      const { data, error } = await supabase.functions.invoke("places-proxy", {
        body: { action: "hydrate", place_ids: missing, session_id: sessionId },
      });
      if (error) throw error;
      return data as HydrateResponse;
    },
  });

  useEffect(() => {
    if (!hydration.data) return;
    setLiveById((prev) => {
      const next = new Map(prev);
      for (const p of hydration.data.places) {
        // Only cache outcomes that will not change within a session. `ok` and
        // `unresolved` are settled facts -- a place either has a Google
        // listing or does not. `error` and `quota_exceeded` are transient, and
        // caching them would make one bad moment permanent for the session.
        if (p.live_status === "ok" || p.live_status === "unresolved") {
          next.set(p.place_id, p);
        }
      }
      return next;
    });
  }, [hydration.data]);

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

  if (!sessionReady || catalog.isPending || !coords) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.bodyQuiet}>Finding places near you…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (catalog.error) {
    return <Message title="Search failed" body={catalog.error.message} />;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Where to tonight?</Text>
          <Pressable
            onPress={() => setFiltersOpen(true)}
            style={styles.filterButton}
            hitSlop={10}
          >
            <Text style={styles.filterButtonText}>
              Filter{filters.cuisines.length ? ` (${filters.cuisines.length})` : ""}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.bodyQuiet}>
          {catalog.data.length === 0
            ? `Nothing within ${filters.radiusMiles} miles`
            : `Nearest ${catalog.data.length} within ${filters.radiusMiles} miles`}
          {missing.length > 0 && hydration.isFetching
            ? " · checking ratings…"
            : ""}
        </Text>
        {hydration.data?.quota.degraded && (
          <Text style={styles.warn}>
            Daily rating limit reached — showing what we have.
          </Text>
        )}
      </View>
      <FlatList
        data={catalog.data}
        keyExtractor={(p) => p.place_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Card place={item} hydrated={liveById.get(item.place_id)} />
        )}
        ListEmptyComponent={
          <Text style={styles.body}>
            Nothing matched. Try a wider radius or fewer cuisines.
          </Text>
        }
      />
      <FilterSheet
        visible={filtersOpen}
        filters={filters}
        onApply={setFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </SafeAreaView>
  );
}

function Card(
  { place, hydrated }: { place: CatalogPlace; hydrated?: HydratedPlace },
) {
  const live = hydrated?.live;
  const open = live?.regularOpeningHours?.openNow;

  // About one place in four will never have live data (docs/measurements.md),
  // so a card with no rating is a normal card, not a broken one. No skeleton,
  // no "unavailable" — the catalog line stands on its own and the live line
  // is additive.
  return (
    <View style={styles.card}>
      <Text style={styles.cardName}>{place.name}</Text>
      <Text style={styles.cardMeta}>
        {(place.distance_meters / MILES).toFixed(1)} mi
        {place.locality && !place.locality_suspect ? ` · ${place.locality}` : ""}
      </Text>
      {place.cuisines.length > 0 && (
        <Text style={styles.cardCuisine}>{place.cuisines.join(" · ")}</Text>
      )}
      {live && (
        <View style={styles.liveRow}>
          {live.rating !== undefined && (
            <Text style={styles.rating}>
              ★ {live.rating.toFixed(1)}
              {live.userRatingCount ? ` (${live.userRatingCount})` : ""}
            </Text>
          )}
          {live.priceLevel && PRICE[live.priceLevel] && (
            <Text style={styles.chip}>{PRICE[live.priceLevel]}</Text>
          )}
          {open !== undefined && (
            <Text style={open ? styles.open : styles.closed}>
              {open ? "Open" : "Closed"}
            </Text>
          )}
        </View>
      )}
    </View>
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
  headerTop: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
  },
  filterButton: {
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 18,
    backgroundColor: "#f0f0f0",
  },
  filterButtonText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5 },
  body: { fontSize: 16, lineHeight: 23 },
  bodyQuiet: { fontSize: 14, color: "#6b6b6b", lineHeight: 20 },
  warn: { fontSize: 13, color: "#a6642a" },
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
  liveRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 5 },
  rating: { fontSize: 14, fontWeight: "600" },
  chip: { fontSize: 14, color: "#6b6b6b" },
  open: { fontSize: 14, color: "#1b7a3d", fontWeight: "600" },
  closed: { fontSize: 14, color: "#8a8a8a" },
});
