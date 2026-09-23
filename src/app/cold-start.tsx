import { useMutation, useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecognitionGrid, type RecognitionPlace } from "@/components/RecognitionGrid";
import { tuning } from "@/config/tuning";
import { markColdStartSkipped } from "@/lib/coldStart";
import { catalogSeed } from "@/lib/seed";
import { ensureSession, supabase } from "@/lib/supabase";
import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type } from "@/theme/type";

/**
 * Cold start (design spec §8).
 *
 * One screen, once, before the first shortlist. No taste questionnaire, no
 * account, no contacts scrape -- it asks for location and then asks which of
 * these places you already know.
 *
 * Every tap writes `verdict = 'known'`: been here at some point, no opinion,
 * no date. That is the whole purpose. Without it the first shortlist has zero
 * rows in Layer 3 and nothing to rank on, and a shortlist with nothing to
 * rank on falls back to distance -- which §3 says is a gate and not a sort
 * key, and which in Valley View would be sorting twelve places that span 0.2
 * miles.
 *
 * Skippable, and never shown again either way.
 */

/** Fetched once and reused; 108 rows that effectively never change. */
interface CuisineRow { slug: string; label: string }

export default function ColdStart() {
  return <ColdStartBody />;
}

function ColdStartBody() {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  // Location, session, and the pool. One query: each step needs the previous
  // one's result, and splitting them would only add loading states nobody
  // benefits from seeing.
  const pool = useQuery({
    queryKey: ["cold-start-pool"],
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        // §10: "I don't know where you are." Not an error state -- a fact,
        // and one the user chose.
        return { denied: true as const };
      }

      // Cached fix first, fresh one only if there isn't one. Same reasoning
      // as the shortlist: at a 5-mile gate a few hundred metres of drift is
      // invisible, and a cold GPS lock on the very first screen somebody ever
      // sees is seconds spent buying nothing. A thrown fix here would have
      // shown "That didn't work" to a user whose location is perfectly fine.
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: 10 * 60 * 1000,
      }).catch(() => null);
      const position = cached ?? (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }));
      const userId = await ensureSession();

      const [places, cuisines] = await Promise.all([
        supabase.rpc("catalog_search", {
          p_lat: position.coords.latitude,
          p_lon: position.coords.longitude,
          p_radius_meters: tuning.catalog.radiusMeters,
          p_limit: tuning.catalog.poolLimit,
          p_seed: catalogSeed(userId),
        }),
        supabase.from("cuisines").select("slug,label"),
      ]);

      if (places.error) throw places.error;
      if (cuisines.error) throw cuisines.error;

      const labels = new Map<string, string>(
        (cuisines.data as CuisineRow[]).map((c) => [c.slug, c.label]),
      );

      // What makes a good tile is recognisability, and the closest proxy the
      // catalog has is: it is a real destination, and somebody classified it.
      // A grid asking "do you know Dmya Investments, Llc?" teaches the user
      // that this app does not know what it is talking about, on the first
      // screen they ever see.
      const candidates = (places.data as PoolRow[]).filter(
        (p) => !p.non_destination_suspect && p.cuisines.length > 0,
      );

      return {
        denied: false as const,
        userId,
        places: candidates.slice(0, tuning.coldStart.tileCount).map((p): RecognitionPlace => ({
          placeId: p.place_id,
          name: p.display_name,
          cuisine: labels.get(p.cuisines[0]) ?? null,
        })),
      };
    },
  });

  const finish = useMutation({
    mutationFn: async (placeIds: string[]) => {
      if (placeIds.length > 0) {
        const userId = pool.data && !pool.data.denied ? pool.data.userId : await ensureSession();
        // `known` and nothing else: no date, no tags, no opinion. visited_on
        // stays null deliberately -- these places were visited at some
        // unremembered point, and a made-up date would drive recency
        // suppression that has no basis.
        const { error } = await supabase.from("place_verdicts").upsert(
          placeIds.map((place_id) => ({ user_id: userId, place_id, verdict: "known" })),
          { onConflict: "user_id,place_id" },
        );
        if (error) throw error;
      } else {
        // Nothing tapped. A skip leaves no server-side trace, so it is the one
        // outcome that needs a device-local flag.
        await markColdStartSkipped();
      }
    },
    onSuccess: () => router.replace("/"),
  });

  const toggle = useCallback((placeId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }, []);

  const chosen = useMemo(() => Array.from(selected), [selected]);

  if (pool.isPending) {
    return (
      <View style={s.centre}>
        <ActivityIndicator color={theme.colours.brass} />
      </View>
    );
  }

  if (pool.isError) {
    return (
      <View style={s.centre}>
        <Text style={s.head}>That didn&apos;t work.</Text>
        <Text style={s.sub}>{(pool.error as Error).message}</Text>
        <Drawn label="Skip for now" onPress={() => finish.mutate([])} tone="quiet" />
      </View>
    );
  }

  if (pool.data.denied) {
    return (
      <View style={s.centre}>
        <Text style={s.head}>I don&apos;t know where you are.</Text>
        <Text style={s.sub}>
          Turn location on and I can show you what&apos;s around. Until then
          there&apos;s nothing I can usefully ask.
        </Text>
        <Drawn label="Carry on without it" onPress={() => finish.mutate([])} tone="quiet" />
      </View>
    );
  }

  const count = chosen.length;

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.xl,
          paddingBottom: theme.space.xxxl,
          paddingHorizontal: 18,
        }}
      >
        <Text style={s.eyebrow}>First things first</Text>
        <Text style={s.head}>Which of these do you already know?</Text>
        <Text style={s.sub}>
          Tap every one you&apos;ve been to. I&apos;m not asking what you liked
          — just what you&apos;ve already seen, so I don&apos;t send you
          somewhere you go every week.
        </Text>

        <View style={s.gridWrap}>
          <RecognitionGrid places={pool.data.places} selected={selected} onToggle={toggle} />
        </View>
      </ScrollView>
      <View style={[s.statusScrim, { height: insets.top }]} pointerEvents="none" />

      <View style={[s.actbar, { paddingBottom: insets.bottom + theme.space.lg }]}>
        <Drawn
          label={count === 0 ? "None of these" : `That's ${count}`}
          onPress={() => finish.mutate(chosen)}
          tone={count === 0 ? "quiet" : "primary"}
          busy={finish.isPending}
        />
        {finish.isError ? (
          <Text style={s.error}>Couldn&apos;t save that: {(finish.error as Error).message}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** Mirrors catalog_search()'s RETURNS TABLE, for the columns used here. */
interface PoolRow {
  place_id: string;
  display_name: string;
  cuisines: string[];
  non_destination_suspect: boolean;
}

/** Drawn, not a platform Button -- spec stack notes. */
function Drawn({
  label,
  onPress,
  tone,
  busy,
}: {
  label: string;
  onPress: () => void;
  tone: "primary" | "quiet";
  busy?: boolean;
}) {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        tone === "primary" ? s.btnPrimary : s.btnQuiet,
        pressed && s.btnPressed,
      ]}
    >
      <Text style={[s.btnLabel, tone === "primary" ? s.btnLabelPrimary : s.btnLabelQuiet]}>
        {busy ? "…" : label}
      </Text>
    </Pressable>
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
    screen: { flex: 1, backgroundColor: c.ground },
    statusScrim: { position: "absolute", top: 0, left: 0, right: 0, backgroundColor: c.ground },
    centre: {
      flex: 1, backgroundColor: c.ground, alignItems: "center",
      justifyContent: "center", padding: space.xxl, rowGap: space.md,
    },
    eyebrow: { ...type.label, color: c.brass, marginBottom: 7 },
    head: { ...type.screenHead, color: c.ink, marginBottom: space.xs },
    sub: { ...type.body, color: c.inkMuted },
    gridWrap: { marginTop: space.xl },
    actbar: {
      backgroundColor: c.ground,
      borderTopWidth: hairline,
      borderTopColor: c.rule,
      paddingHorizontal: 18,
      paddingTop: space.lg,
      rowGap: space.sm,
    },
    btn: {
      borderRadius: radius.button,
      paddingVertical: 15,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimary: { backgroundColor: c.brass },
    // No backgroundColor: a View is transparent by default, and "transparent"
    // is a colour literal as far as the guard is concerned -- rightly, since
    // exempting one string is how the exemptions start.
    btnQuiet: { borderWidth: hairline, borderColor: c.ruleStrong },
    btnPressed: { opacity: 0.7 },
    btnLabel: { ...type.button },
    btnLabelPrimary: { color: c.brassInk },
    btnLabelQuiet: { color: c.inkMuted },
    error: { ...type.caution, color: c.oxblood, textAlign: "center" },
  });

