// Surprise Me — spec §5.2.
//
// "Selection is weighted-random, not argmax. A deterministic best-match
// returns the same answer every time and defeats the purpose."
//
// The spec's weight is:
//   match_score × novelty_boost × recency_penalty × veto_gate
//
// Three of those four need Layer 3, which does not exist yet: there are no
// visits to decay, no ratings to match against, no vetoes to gate. They are
// neutral for now, and this file is where they land when Phase 2 arrives.
//
// What is NOT neutral today is distance. Uniform sampling over a 20-mile
// radius mostly returns somewhere 15 miles away, which is a worse answer than
// the list it replaced. A mild inverse-distance weight keeps the pick
// plausible while staying genuinely random — near places are likelier, not
// certain.
//
// Cost: one Google call per reveal, and none at all when the pool was already
// hydrated for a Layer 2 filter. The spec budgets exactly this — "hydrate the
// winner only (1 Google call)".

import { useCallback, useState } from "react";
import {
  ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";

const MILES = 1609.344;

// "Infinite rerolls recreate the paralysis the app exists to remove."
const MAX_REROLLS = 3;

export interface SurpriseCandidate {
  place_id: string;
  name: string;
  lat: number;
  lon: number;
  distance_meters: number;
  locality: string | null;
  locality_suspect: boolean;
  cuisines: string[];
}

interface Live {
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  businessStatus?: string;
  regularOpeningHours?: { openNow?: boolean };
}

const PRICE: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

/**
 * Sample one candidate, favouring nearer places without ever ruling out the
 * far ones. Square root rather than a plain inverse: 1/(0.5+d) collapses so
 * steeply that a 15-mile place is effectively unreachable, which would make
 * this a nearest-match with extra steps.
 */
function pickWeighted(
  candidates: SurpriseCandidate[],
  excludeId?: string,
): SurpriseCandidate | null {
  const pool = candidates.filter((c) => c.place_id !== excludeId);
  if (pool.length === 0) return null;

  const weights = pool.map((c) => 1 / Math.sqrt(0.5 + c.distance_meters / MILES));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function SurpriseReveal(
  { visible, candidates, sessionId, onClose }: {
    visible: boolean;
    candidates: SurpriseCandidate[];
    sessionId: string;
    onClose: () => void;
  },
) {
  const [pick, setPick] = useState<SurpriseCandidate | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(false);
  const [rerolls, setRerolls] = useState(0);
  const [started, setStarted] = useState(false);

  const roll = useCallback(async (previous?: string) => {
    const chosen = pickWeighted(candidates, previous);
    setPick(chosen);
    setLive(null);
    if (!chosen) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("places-proxy", {
        body: {
          action: "hydrate",
          place_ids: [chosen.place_id],
          session_id: sessionId,
        },
      });
      if (!error) {
        setLive(data?.places?.[0]?.live ?? null);
      }
    } finally {
      setLoading(false);
    }
  }, [candidates, sessionId]);

  // First open rolls once; reopening starts a fresh round.
  if (visible && !started) {
    setStarted(true);
    setRerolls(0);
    void roll();
  }
  if (!visible && started) setStarted(false);

  const close = () => {
    setPick(null);
    setLive(null);
    onClose();
  };

  const directions = () => {
    if (!pick) return;
    // A plain maps URL, not a Places API call. Costs nothing and is not
    // Google content we are holding.
    const q = encodeURIComponent(`${pick.name}, ${pick.locality ?? ""}`);
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${q}` +
        `&query_place_id=&center=${pick.lat},${pick.lon}`,
    );
  };

  const rerollsLeft = MAX_REROLLS - rerolls;
  const open = live?.regularOpeningHours?.openNow;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Pressable onPress={close} hitSlop={12}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>

        {!pick
          ? (
            <View style={styles.centered}>
              <Text style={styles.title}>Nothing to pick from</Text>
              <Text style={styles.body}>
                Widen the radius or loosen the filters, and try again.
              </Text>
            </View>
          )
          : (
            <View style={styles.centered}>
              <Text style={styles.eyebrow}>Tonight, go to</Text>
              <Text style={styles.name}>{pick.name}</Text>

              <Text style={styles.meta}>
                {(pick.distance_meters / MILES).toFixed(1)} miles away
                {pick.locality && !pick.locality_suspect
                  ? ` · ${pick.locality}`
                  : ""}
              </Text>

              {pick.cuisines.length > 0 && (
                <Text style={styles.cuisine}>{pick.cuisines.join(" · ")}</Text>
              )}

              {loading
                ? <ActivityIndicator style={styles.spinner} />
                : live
                ? (
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
                        {open ? "Open now" : "Closed now"}
                      </Text>
                    )}
                  </View>
                )
                : <Text style={styles.noRating}>No rating available</Text>}

              <Pressable style={styles.primary} onPress={directions}>
                <Text style={styles.primaryText}>Lock it in</Text>
              </Pressable>

              {rerollsLeft > 0
                ? (
                  <Pressable
                    style={styles.secondary}
                    onPress={() => {
                      setRerolls((n) => n + 1);
                      void roll(pick.place_id);
                    }}
                  >
                    <Text style={styles.secondaryText}>
                      Something else ({rerollsLeft} left)
                    </Text>
                  </Pressable>
                )
                : (
                  // Deliberate friction, spec §5.2.
                  <Text style={styles.noMore}>
                    That&apos;s the last one. Pick it, or go back to the list.
                  </Text>
                )}
            </View>
          )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  top: { paddingHorizontal: 20, paddingVertical: 14, alignItems: "flex-end" },
  close: { fontSize: 16, color: "#2a6fd6" },
  centered: {
    flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 8,
    paddingBottom: 60,
  },
  eyebrow: {
    fontSize: 14, fontWeight: "600", letterSpacing: 0.6,
    textTransform: "uppercase", color: "#8a8a8a",
  },
  title: { fontSize: 28, fontWeight: "700", color: "#111" },
  name: {
    fontSize: 40, fontWeight: "700", letterSpacing: -1, color: "#111",
    lineHeight: 46,
  },
  meta: { fontSize: 17, color: "#6b6b6b", marginTop: 4 },
  cuisine: { fontSize: 15, color: "#8a8a8a" },
  body: { fontSize: 16, color: "#6b6b6b", lineHeight: 23 },
  spinner: { alignSelf: "flex-start", marginTop: 12 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  rating: { fontSize: 17, fontWeight: "600", color: "#111" },
  chip: { fontSize: 17, color: "#6b6b6b" },
  open: { fontSize: 17, color: "#1b7a3d", fontWeight: "600" },
  closed: { fontSize: 17, color: "#8a8a8a" },
  noRating: { fontSize: 15, color: "#a5a5a5", fontStyle: "italic", marginTop: 10 },
  primary: {
    marginTop: 30, backgroundColor: "#111", paddingVertical: 17,
    borderRadius: 14, alignItems: "center",
  },
  primaryText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondary: { marginTop: 12, paddingVertical: 14, alignItems: "center" },
  secondaryText: { fontSize: 16, color: "#2a6fd6", fontWeight: "600" },
  noMore: {
    marginTop: 16, fontSize: 14, color: "#8a8a8a", textAlign: "center",
    lineHeight: 20,
  },
});
