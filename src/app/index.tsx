// Home — the shortlist. This IS the app (spec §13: no tab bar, one stack
// rooted here).
//
// Two queries, deliberately separate:
//
//   1. catalog_search   Layer 1 + Layer 3, over RPC. Free, fast, no Google.
//   2. places-proxy     Layer 2. Costs money, can be slow, can fail.
//
// The list renders from (1) the moment it arrives and is enriched by (2) when
// it lands. Blocking the list on hydration would spend the 90-second decision
// window (§3) waiting on the slowest and least reliable part.
//
// Queries live in the screen, per CLAUDE.md: screens own their own queries.

import { useQuery } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Redirect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlaceCard, type Action, type PlaceCardProps, type Reason, type Tick } from "@/components/PlaceCard";
import { SurpriseReveal, type RevealCandidate } from "@/components/SurpriseReveal";
import { tuning } from "@/config/tuning";
import { hasSeenColdStart } from "@/lib/coldStart";
import { catalogSeed } from "@/lib/seed";
import { ensureSession, supabase } from "@/lib/supabase";
import { palettes, ThemeProvider, useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type, useAppFonts } from "@/theme/type";

/** Mirrors catalog_search()'s RETURNS TABLE. */
interface CatalogPlace {
  place_id: string;
  name: string;
  display_name: string;
  phone: string | null;
  update_time: string | null;
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
  non_destination_suspect: boolean;
  opening_soon: boolean;
  last_visited_at: string | null;
  visit_count: number;
  my_verdict: "again" | "fine" | "known" | "not_again" | null;
  /** 4 this cycle, 3 earlier 2026, 2 during 2025, 1 pre-2025, 0 unknown. */
  freshness: number;
}

/** Mirrors catalog_localities()'s RETURNS TABLE. */
interface LocalityRow {
  locality: string;
  lat: number;
  lon: number;
  place_count: number;
  distance_meters: number;
}

/** Google-derived. Request-scoped, never stored. */
interface LiveFields {
  rating?: number;
  priceLevel?: string;
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
  const [fontsLoaded, fontError] = useAppFonts();
  if (fontError) {
    return (
      <View style={bare.centre}>
        <Text style={bare.text}>Fonts failed to load: {fontError.message}</Text>
      </View>
    );
  }
  if (!fontsLoaded) return <View style={bare.blank} />;
  return (
    <ThemeProvider>
      <Shortlist />
    </ThemeProvider>
  );
}

function Shortlist() {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();

  const [permission, setPermission] = useState<Permission>("unknown");
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [needsColdStart, setNeedsColdStart] = useState<boolean | null>(null);
  // Where the search is centred. `me` is the device; `town` is the escape
  // hatch the exhausted screen offers, and the one thing that screen can do.
  const [origin, setOrigin] = useState<
    { kind: "me" } | { kind: "town"; name: string; lat: number; lon: number }
  >({ kind: "me" });
  // Explicitly number: `tuning` is `as const`, so inference would pin this to
  // the literal 5 and refuse the widened value.
  const [radiusMiles, setRadiusMiles] = useState<number>(tuning.catalog.radiusMiles);

  const [revealOpen, setRevealOpen] = useState(false);

  const [sessionId] = useState(
    () => `app-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

  useEffect(() => {
    ensureSession()
      .then(setUserId)
      .catch((e: unknown) => setSessionError(e instanceof Error ? e.message : String(e)));
  }, []);

  // After the session exists, not before: "completed" is answered by asking
  // whether the user has any verdicts, and place_verdicts is behind RLS.
  useEffect(() => {
    if (!userId) return;
    hasSeenColdStart().then((seen) => setNeedsColdStart(!seen));
  }, [userId]);

  useEffect(() => {
    Location.getForegroundPermissionsAsync().then(({ status }) => {
      setPermission(status === "granted" ? "granted" : "explaining");
    });
  }, []);

  useEffect(() => {
    if (permission !== "granted") return;
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      .then((p) => setCoords({ lat: p.coords.latitude, lon: p.coords.longitude }))
      .catch(() => setPermission("denied"));
  }, [permission]);

  const requestLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermission(status === "granted" ? "granted" : "denied");
  }, []);

  const centre = origin.kind === "town" ? { lat: origin.lat, lon: origin.lon } : coords;

  const catalog = useQuery({
    queryKey: ["catalog_search", centre?.lat, centre?.lon, radiusMiles, userId],
    enabled: centre !== null && userId !== null,
    queryFn: async (): Promise<CatalogPlace[]> => {
      const { data, error } = await supabase.rpc("catalog_search", {
        p_lat: centre!.lat,
        p_lon: centre!.lon,
        p_radius_meters: radiusMiles * MILES,
        p_limit: tuning.catalog.poolLimit,
        p_seed: catalogSeed(userId!),
        p_include_non_destinations: tuning.catalog.includeNonDestinations,
      });
      if (error) throw error;
      return (data ?? []) as CatalogPlace[];
    },
  });

  // Only asked for when the town is exhausted, so the ordinary path never
  // pays for it. Free either way -- Layer 1, no Google call.
  const towns = useQuery({
    queryKey: ["catalog_localities", coords?.lat, coords?.lon],
    enabled: coords !== null,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<LocalityRow[]> => {
      const { data, error } = await supabase.rpc("catalog_localities", {
        p_lat: coords!.lat,
        p_lon: coords!.lon,
        p_limit: 25,
      });
      if (error) throw error;
      return (data ?? []) as LocalityRow[];
    },
  });

  // `not_again` and non-destinations are both removed server-side now, so the
  // pool is what came back.
  const pool = useMemo(() => catalog.data ?? [], [catalog.data]);

  // Rural-exhausted is a real, ordinary Tuesday in a 21-place town, not an
  // edge case -- and after six taps in the recognition grid it is reachable
  // immediately. Computed from the pool rather than guessed from its size.
  const unknownToYou = useMemo(() => pool.filter((p) => p.my_verdict === null), [pool]);
  const exhausted = pool.length > 0 && unknownToYou.length === 0;

  // Novelty first, then everything else. This is NOT the ranking from §3 --
  // that needs tag affinity, friend verdicts and confidence weights that do
  // not exist yet. It is the smallest ordering that is honestly better than
  // arbitrary, and distance is deliberately absent from it.
  const shortlist = useMemo(
    () => [...unknownToYou, ...pool.filter((p) => p.my_verdict !== null)].slice(0, SHORTLIST),
    [pool, unknownToYou],
  );

  const ids = shortlist.map((p) => p.place_id);

  // Hydration is cached PER PLACE, not per query. Keying on the whole id list
  // meant every change was a total cache miss: measured at 42 Google calls in
  // 62 seconds, about 70% of the daily quota.
  const [liveById, setLiveById] = useState<Map<string, HydratedPlace>>(() => new Map());
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
        // Only cache settled outcomes. `ok` and `unresolved` are facts -- a
        // place either has a Google listing or does not. `error` and
        // `quota_exceeded` are transient, and caching them would make one bad
        // moment permanent for the session.
        if (p.live_status === "ok" || p.live_status === "unresolved") next.set(p.place_id, p);
      }
      return next;
    });
  }, [hydration.data]);

  // The reveal draws from THIS array, which the block above has already
  // hydrated into `liveById`. Nothing in the reveal fetches, so rerolls cost
  // zero Google calls -- §7's requirement, satisfied by construction rather
  // than by care.
  const revealCandidates: RevealCandidate[] = shortlist.map((p) => {
    const live = liveById.get(p.place_id)?.live ?? null;
    return {
      placeId: p.place_id,
      name: p.display_name,
      cuisine: p.cuisines.length > 0 ? humanise(p.cuisines[0]) : null,
      locality: p.locality_suspect ? null : p.locality,
      distanceMiles: p.distance_meters / MILES,
      rating: live?.rating ?? null,
      priceLevel: live?.priceLevel ? (PRICE[live.priceLevel] ?? null) : null,
      phone: p.phone,
      // No honest reason exists yet for most places, and the reveal omits the
      // line rather than filling it.
      why: null,
    };
  });

  if (sessionError) {
    return <Notice head="Couldn't connect" body={sessionError} />;
  }
  if (needsColdStart === null && userId !== null) {
    return <Spinner />;
  }
  if (needsColdStart) {
    return <Redirect href="/cold-start" />;
  }

  if (permission === "explaining") {
    return (
      <Notice
        head="Where to tonight?"
        body="Elsewhere needs your location to find places to eat nearby. That's the only thing it asks for — no account, no bank login."
        action={{ label: "Find places near me", onPress: requestLocation }}
      />
    );
  }
  if (permission === "denied") {
    return (
      <Notice
        head="I don't know where you are."
        body="Turn location on in Settings and I can show you what's around."
      />
    );
  }
  if (catalog.isPending || !coords) return <Spinner />;
  if (catalog.isError) {
    return <Notice head="Search failed" body={(catalog.error as Error).message} />;
  }

  if (revealOpen && revealCandidates.length > 0) {
    return (
      <SurpriseReveal
        candidates={revealCandidates}
        onClose={() => setRevealOpen(false)}
        onCommit={() => {
          // Commit is currently terminal on this screen: the visit record and
          // the review prompt it should create are review capture's job (§4),
          // which does not exist yet. Recording a visit here with nothing able
          // to read it would look like progress and be none.
        }}
      />
    );
  }

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.lg,
          paddingBottom: theme.space.xxxl,
          paddingHorizontal: 18,
        }}
      >
        <Text style={s.eyebrow}>Tonight</Text>
        {exhausted ? (
          <Exhausted
            count={pool.length}
            here={origin.kind === "town" ? origin.name : null}
            towns={towns.data ?? []}
            remaining={pool.length}
            radiusMiles={radiusMiles}
            onGoTo={(t) => setOrigin({ kind: "town", name: t.locality, lat: t.lat, lon: t.lon })}
            onWiden={() => setRadiusMiles(tuning.exhausted.widenedRadiusMiles)}
            widened={radiusMiles !== tuning.catalog.radiusMiles}
          />
        ) : (
          <>
            <Text style={s.head}>
              {shortlist.length === 1
                ? "One I'd actually send you to"
                : `${spell(shortlist.length)} I'd actually send you to`}
            </Text>
            <Text style={s.sub}>
              Out of {pool.length} within {radiusMiles} miles
              {origin.kind === "town" ? ` of ${origin.name}` : ""}.
            </Text>

            <View style={s.list}>
              {shortlist.map((p, i) => (
                <PlaceCard key={p.place_id} {...toCard(p, liveById.get(p.place_id))} isFirst={i === 0} />
              ))}
            </View>

            {/* Licence obligation (§7): shown whenever Google data is on screen. */}
            {liveById.size > 0 ? (
              <Text style={s.attrib}>Ratings and hours from Google · Powered by Google</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      {!exhausted && shortlist.length > 0 ? (
        <View style={[s.actbar, { paddingBottom: insets.bottom + theme.space.lg }]}>
          <Pressable
            onPress={() => setRevealOpen(true)}
            accessibilityRole="button"
            style={({ pressed }) => [s.btn, s.btnWide, pressed && s.btnPressed]}
          >
            <Text style={s.btnLabel}>You pick.</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Catalog row plus optional live fields -> card props.
 *
 * The rule that matters here: **a card with no honest reason has no reason
 * line.** Nothing is substituted. Distance and rating are meta, never
 * curation, and dressing one up as the other is how a product starts lying
 * quietly. Today almost every card falls through to `reason: null`, because
 * the tag affinity and friend verdicts that produce real reasons do not exist
 * yet. That sparseness is the honest state and it is meant to show.
 */
function toCard(p: CatalogPlace, hydrated: HydratedPlace | undefined): PlaceCardProps {
  const live = hydrated?.live ?? null;

  let tick: Tick | null = null;
  let reason: Reason | null = null;
  let action: Action | null = null;

  if (p.my_verdict === "again") {
    tick = { text: "Yours · liked", tone: "yours" };
  } else if (p.my_verdict === null && p.freshness === 4) {
    // §5's frontier card. The spec's test is "no Google match AND nobody in
    // Elsewhere has reviewed it"; cross-user review counts are not readable
    // under RLS, so this approximates with "fresh upstream and unknown to
    // you". With a single user those coincide. Revisit when there are others.
    tick = { text: "Nobody's been here", tone: "frontier" };
    if (p.phone) action = { label: "Call ahead", tone: "brass" };
  }

  if (p.freshness === 1) {
    // Listed, stale: untouched upstream since 2024. Copy says "may have
    // changed hands", never "may not exist" -- every record observed so far
    // pointed at something real, and the problem is identity drift.
    reason = {
      kind: "caution",
      text: "Might have changed hands — nothing's confirmed it since 2024.",
    };
    action = { label: "Still there?", tone: "plain" };
    tick = null;
  } else if (p.opening_soon) {
    reason = { kind: "frontier", text: "Not open yet, going by the name." };
  }

  return {
    name: p.display_name,
    meta: {
      cuisine: p.cuisines.length > 0 ? humanise(p.cuisines[0]) : null,
      // Suppressed when Overture's locality is uncorroborated (migration
      // 0013): printing a town 261 miles away is worse than printing none.
      locality: p.locality_suspect ? null : p.locality,
      distanceMiles: p.distance_meters / MILES,
      rating: live?.rating ?? null,
      priceLevel: live?.priceLevel ? (PRICE[live.priceLevel] ?? null) : null,
      closedNow: live?.regularOpeningHours?.openNow === false,
    },
    tick,
    reason,
    action,
  };
}

/** Slug -> label, for the one cuisine the card shows. */
function humanise(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function spell(n: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  return words[n] ?? String(n);
}

/**
 * Rural exhausted (§10: "You've been to all four").
 *
 * Not an error and not an empty state -- it is the correct answer, and in a
 * 21-place town it is a normal Tuesday rather than an edge case. Saying so
 * plainly is better than padding the list with places the user has already
 * ruled on.
 */
function Exhausted({
  count,
  here,
  towns,
  remaining,
  radiusMiles,
  onGoTo,
  onWiden,
  widened,
}: {
  count: number;
  here: string | null;
  towns: LocalityRow[];
  remaining: number;
  radiusMiles: number;
  onGoTo: (t: LocalityRow) => void;
  onWiden: () => void;
  widened: boolean;
}) {
  const theme = useTheme();
  const s = styles(theme);

  // The nearest town that actually has more than is left here, within a
  // distance that is an offer rather than a joke. `place_count` already
  // excludes non-destinations (migration 0041), so the number on the button
  // is the number the next screen will show -- a count shown to someone has
  // to be the count they get.
  // Must be OUTSIDE the radius already searched. Without that test the
  // nearest town is the one you are standing in -- Valley View's own centroid
  // is 1.6 miles away with 22 places -- and the screen offers to open things
  // up to where you already are.
  const next = towns.find(
    (t) =>
      t.locality !== here &&
      t.distance_meters / MILES > radiusMiles &&
      t.place_count > remaining &&
      t.distance_meters / MILES <= tuning.exhausted.maxTownMiles,
  );

  return (
    <View style={s.exhausted}>
      <View style={s.mark} />
      <Text style={s.head}>You&apos;ve been to all {spell(count).toLowerCase()}.</Text>
      <Text style={s.sub}>
        Nothing new inside {tuning.catalog.radiusMiles} miles. That&apos;s not a
        failure — it&apos;s a small town, and you&apos;ve done the rounds.
      </Text>

      {/*
        One action, not two. The canvas also offers a forgotten favourite
        ("The Bluebonnet — not since March"), which needs the resurface rule
        and a visit history that does not exist yet. Offering it now would
        mean inventing the date it depends on.
      */}
      {next ? (
        <Pressable
          onPress={() => onGoTo(next)}
          accessibilityRole="button"
          style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
        >
          <Text style={s.btnLabel}>
            Open it up to {next.locality} · {next.place_count}
          </Text>
        </Pressable>
      ) : widened ? (
        <Text style={s.sub}>
          Nowhere within {tuning.exhausted.maxTownMiles} miles has more than
          you&apos;ve already seen. That&apos;s the county, not the app.
        </Text>
      ) : (
        <Pressable
          onPress={onWiden}
          accessibilityRole="button"
          style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
        >
          <Text style={s.btnLabel}>
            Widen to {tuning.exhausted.widenedRadiusMiles} miles
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function Spinner() {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <View style={s.centre}>
      <ActivityIndicator color={theme.colours.brass} />
    </View>
  );
}

function Notice({
  head,
  body,
  action,
}: {
  head: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <View style={s.centre}>
      <Text style={s.head}>{head}</Text>
      <Text style={s.sub}>{body}</Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          style={({ pressed }) => [s.btn, pressed && s.btnPressed]}
        >
          <Text style={s.btnLabel}>{action.label}</Text>
        </Pressable>
      ) : null}
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
    screen: { flex: 1, backgroundColor: c.ground },
    centre: {
      flex: 1, backgroundColor: c.ground, alignItems: "center",
      justifyContent: "center", padding: space.xxl, rowGap: space.md,
    },
    eyebrow: { ...type.label, color: c.brass, marginBottom: 7 },
    head: { ...type.screenHead, color: c.ink, marginBottom: space.xs },
    sub: { ...type.body, color: c.inkMuted },
    list: { marginTop: space.lg },
    attrib: {
      ...type.tileMeta, color: c.inkFaint,
      textAlign: "center", marginTop: space.lg,
    },
    exhausted: { paddingTop: space.xxxl, rowGap: space.sm },
    mark: { width: 30, height: 2, backgroundColor: c.brass, marginBottom: space.xs },
    btn: {
      marginTop: space.sm, borderRadius: radius.button,
      backgroundColor: c.brass, paddingVertical: 15, paddingHorizontal: space.xxl,
    },
    btnPressed: { opacity: 0.7 },
    btnWide: { paddingHorizontal: 0, marginTop: 0 },
    actbar: {
      backgroundColor: c.ground,
      borderTopWidth: hairline,
      borderTopColor: c.rule,
      paddingHorizontal: 18,
      paddingTop: space.lg,
    },
    btnLabel: { ...type.button, color: c.brassInk, textAlign: "center" },
  });

const bare = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palettes.dark.ground },
  centre: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: 24, backgroundColor: palettes.dark.ground,
  },
  text: { color: palettes.dark.ink, fontSize: 15 },
});
