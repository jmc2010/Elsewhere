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
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlaceCard, type Action, type PlaceCardProps, type Reason, type Tick } from "@/components/PlaceCard";
import { DEFAULT_FILTERS, FilterSheet, type CuisineGroup, type Filters, type MoodTag } from "@/components/FilterSheet";
import { LocationPicker, type Origin, type Town } from "@/components/LocationPicker";
import { ReviewCapture, type ReviewResult, type Tag } from "@/components/ReviewCapture";
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
  /** The caller's most recent lock-in here, if any. */
  last_locked_at: string | null;
  /** 4 this cycle, 3 earlier 2026, 2 during 2025, 1 pre-2025, 0 unknown. */
  freshness: number;
  /** How many people have recorded any verdict here. Existence, not opinion. */
  confirmations: number;
}

interface RawLockin {
  id: string;
  place_id: string;
  locked_at: string;
  // PostgREST returns an embedded relation as an array even when the foreign
  // key guarantees at most one row. Typing it honestly is cheaper than
  // casting through `unknown` and hoping.
  places: { display_name: string }[] | null;
}

interface RawVerdictTag {
  tag_key: string;
  tags: { label: string }[] | null;
  place_verdicts: { place_id: string }[] | null;
}

interface PendingReview {
  id: string;
  place_id: string;
  display_name: string;
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

/**
 * Why locating fails, when it fails.
 *
 * `denied` and `no_fix` are different problems with different fixes, and
 * conflating them was a real bug: a cold GPS on first open threw, the catch
 * set "denied", and the screen told somebody who had already granted location
 * to go and grant location. It then "fixed itself" on the next open once the
 * GPS had warmed up, which is the worst kind of bug -- intermittent, and
 * blamed on the phone.
 */
type LocateFailure = "no_fix" | null;

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

  /**
   * Adopt a fix only if it MOVES us.
   *
   * The search centre is part of the catalog_search cache key. Setting it
   * twice -- once from the cached fix, once from the fresh one -- changes the
   * key by a few metres, which refetches the pool, reshuffles the shortlist
   * and re-hydrates cards at Google's expense. That is what cost 7 calls on a
   * back-navigation.
   *
   * So the first usable fix anchors the session, and a later one replaces it
   * only if the device has genuinely moved. At a 5-mile gate, 250m is
   * invisible.
   */
  const adoptFix = useCallback((lat: number, lon: number) => {
    setCoords((prev) => {
      if (!prev) return { lat, lon };
      const dLat = (lat - prev.lat) * 111_320;
      const dLon = (lon - prev.lon) * 111_320 * Math.cos((prev.lat * Math.PI) / 180);
      const moved = Math.sqrt(dLat * dLat + dLon * dLon);
      return moved > tuning.location.recentreMeters ? { lat, lon } : prev;
    });
  }, []);
  const [locateFailure, setLocateFailure] = useState<LocateFailure>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [needsColdStart, setNeedsColdStart] = useState<boolean | null>(null);
  // Where the search is centred. `me` is the device; `town` is the escape
  // hatch the exhausted screen offers, and the one thing that screen can do.
  const [origin, setOrigin] = useState<Origin>({ kind: "me" });
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sheet, setSheet] = useState<"none" | "where" | "what">("none");
  // Explicitly number: `tuning` is `as const`, so inference would pin this to
  // the literal 5 and refuse the widened value.
  const [radiusMiles, setRadiusMiles] = useState<number>(tuning.catalog.radiusMiles);

  const [revealOpen, setRevealOpen] = useState(false);
  // Dismissed for this run only. "Later" must not mean "never" -- the prompt
  // is the only way a verdict ever gets recorded.
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);

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

  const locate = useCallback(async () => {
    setLocateFailure(null);

    // Try the cached fix FIRST. It returns immediately, it is accurate to
    // within a few hundred metres, and at a 5-mile gate that is indis-
    // tinguishable from a fresh one. Waiting for a satellite lock to decide
    // which town you are in is precision nobody asked for, paid in the one
    // currency this app cannot spend: the seconds before the first screen.
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
      if (last) {
        adoptFix(last.coords.latitude, last.coords.longitude);
      }
    } catch {
      // No cached fix. Not a failure -- the fresh attempt below is the real one.
    }

    try {
      const fresh = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      adoptFix(fresh.coords.latitude, fresh.coords.longitude);
    } catch {
      // A failed FIX is not a denied PERMISSION. Only report a problem if
      // there is no cached position to fall back on either; otherwise the
      // user has a usable location and does not need to hear about it.
      setCoords((prev) => {
        if (!prev) setLocateFailure("no_fix");
        return prev;
      });
    }
  }, [adoptFix]);

  useEffect(() => {
    if (permission !== "granted") return;
    void locate();
  }, [permission, locate]);

  const requestLocation = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermission(status === "granted" ? "granted" : "denied");
  }, []);

  const centre = origin.kind === "town" ? { lat: origin.lat, lon: origin.lon } : coords;

  const catalog = useQuery({
    queryKey: ["catalog_search", centre?.lat, centre?.lon, radiusMiles, userId, filters.cuisines],
    enabled: centre !== null && userId !== null,
    queryFn: async (): Promise<CatalogPlace[]> => {
      const { data, error } = await supabase.rpc("catalog_search", {
        p_lat: centre!.lat,
        p_lon: centre!.lon,
        p_radius_meters: radiusMiles * MILES,
        p_limit: tuning.catalog.poolLimit,
        p_seed: catalogSeed(userId!),
        p_include_non_destinations: tuning.catalog.includeNonDestinations,
        // Empty means no cuisine filter. An empty array would make
        // catalog_search raise -- a slug list matching nothing is a caller bug
        // there, not a request for everything.
        p_cuisines: filters.cuisines.length > 0 ? filters.cuisines : null,
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

  // Mood filters are the tags the USER has applied -- theirs, and free. The
  // section does not exist until there is history, which is why this returns
  // an empty list rather than the whole vocabulary.
  const myTags = useQuery({
    queryKey: ["my-tags", userId],
    enabled: userId !== null,
    queryFn: async (): Promise<{ moods: MoodTag[]; byPlace: Map<string, Set<string>> }> => {
      const { data, error } = await supabase
        .from("verdict_tags")
        .select("tag_key, tags(label), place_verdicts(place_id)");
      if (error) throw error;
      const rows = (data ?? []) as RawVerdictTag[];
      const counts = new Map<string, MoodTag>();
      const byPlace = new Map<string, Set<string>>();
      for (const r of rows) {
        const label = r.tags?.[0]?.label ?? r.tag_key;
        const existing = counts.get(r.tag_key);
        counts.set(r.tag_key, { key: r.tag_key, label, used: (existing?.used ?? 0) + 1 });
        const pid = r.place_verdicts?.[0]?.place_id;
        if (pid) {
          if (!byPlace.has(pid)) byPlace.set(pid, new Set());
          byPlace.get(pid)!.add(r.tag_key);
        }
      }
      return {
        moods: [...counts.values()].sort((a, b) => b.used - a.used),
        byPlace,
      };
    },
  });

  // `not_again` and non-destinations are both removed server-side now. What
  // remains to filter is the provisional suppression: somewhere locked in
  // within the last few days and not yet resolved by review capture. Without
  // this the app offers tonight's restaurant again tomorrow morning, which is
  // the rut it exists to break.
  const pool = useMemo(() => {
    const cutoff = Date.now() - tuning.recency.unresolvedLockinDays * 24 * 60 * 60 * 1000;
    const tagged = myTags.data?.byPlace;
    return (catalog.data ?? []).filter((p) => {
      if (p.last_locked_at && Date.parse(p.last_locked_at) >= cutoff) return false;
      if (filters.moodTags.length === 0) return true;
      // A mood filter is "somewhere I have called this before". It can only
      // match places with history, which is honest: it is your data, not an
      // inference about places you have never been.
      const mine = tagged?.get(p.place_id);
      return mine ? filters.moodTags.some((t) => mine.has(t)) : false;
    });
  }, [catalog.data, filters.moodTags, myTags.data]);

  // Rural-exhausted is a real, ordinary Tuesday in a 21-place town, not an
  // edge case -- and after six taps in the recognition grid it is reachable
  // immediately. Computed from the pool rather than guessed from its size.
  const unknownToYou = useMemo(() => pool.filter((p) => p.my_verdict === null), [pool]);
  const exhausted = pool.length > 0 && unknownToYou.length === 0;

  /**
   * The ten, selected ONCE and held for the session.
   *
   * Two rules, and the second is a product rule rather than an optimisation.
   *
   * TOTAL ORDER. Every comparator ends in the row's index within the pool,
   * which can never tie -- so two runs over the same pool always produce the
   * same ten in the same order. A sort that leaves equal scores to reorder
   * between renders silently reshuffles the shortlist, and each reshuffle
   * buys hydration for cards the user never asked to see.
   *
   * STABLE UNTIL SOMETHING REAL CHANGES IT. §2 is commitment over
   * optionality: a list that rearranges itself while you glance away invites
   * re-browsing, which is the paralysis this product exists to remove. So the
   * selection is pinned by id and reused, and it is invalidated deliberately
   * -- a new verdict, a new lock-in, a filter or location change -- never
   * incidentally by navigating back to the screen.
   *
   * This is NOT §3's ranking, which needs tag affinity, friend verdicts and
   * confidence weights that do not exist yet. It is the smallest ordering
   * that is honestly better than arbitrary, and distance is deliberately
   * absent from it.
   */
  const ranked = useMemo(() => {
    const index = new Map(pool.map((p, i) => [p.place_id, i]));
    const score = (p: CatalogPlace) => (p.my_verdict === null ? 0 : 1);
    return [...pool]
      .sort((a, b) =>
        score(a) - score(b) ||
        // The tiebreak that can never tie. Pool order is itself deterministic
        // -- catalog_search seeds it per user per day -- so this makes the
        // whole chain reproducible.
        (index.get(a.place_id)! - index.get(b.place_id)!))
      .slice(0, SHORTLIST);
  }, [pool]);

  // Pinned by id. Null means "not chosen yet this session".
  const [pinnedIds, setPinnedIds] = useState<string[] | null>(null);

  // Deliberate invalidation only. Note what is NOT here: navigation, focus,
  // a refetch, or the arrival of a fresher GPS fix.
  useEffect(() => {
    setPinnedIds(null);
  }, [filters, origin, radiusMiles]);

  useEffect(() => {
    if (pinnedIds === null && ranked.length > 0) {
      setPinnedIds(ranked.map((p) => p.place_id));
    }
  }, [pinnedIds, ranked]);

  const shortlist = useMemo(() => {
    if (!pinnedIds) return ranked;
    const byId = new Map(pool.map((p) => [p.place_id, p]));
    // Drop anything that has left the pool -- vetoed, corrected away, or now
    // suppressed. Do not backfill: silently swapping in a replacement is the
    // reshuffle this exists to prevent.
    const kept = pinnedIds.map((id) => byId.get(id)).filter((p): p is CatalogPlace => !!p);
    return kept.length > 0 ? kept : ranked;
  }, [pinnedIds, pool, ranked]);

  // ONLY the displayed shortlist is hydrated -- never `pool`, which is 200
  // rows of Layer 1 that exist so ranking has something to choose from. Spec
  // §7 says "hydrate the pool once", and that wording predates the pool being
  // 200: hydrating it per shortlist would spend a day's quota in an
  // afternoon. The chain is 200 candidates -> rank -> 10 displayed -> hydrate
  // those 10 -> the reveal draws its 4 from the same 10.
  const activeFilterCount =
    filters.cuisines.length + filters.moodTags.length + (filters.openNow ? 1 : 0);

  const ids = shortlist.map((p) => p.place_id);

  // Hydration is cached PER PLACE, not per query. Keying on the whole id list
  // meant every change was a total cache miss: measured at 42 Google calls in
  // 62 seconds, about 70% of the daily quota.
  const [liveById, setLiveById] = useState<Map<string, HydratedPlace>>(() => new Map());
  const missing = ids.filter((id) => !liveById.has(id));

  if (__DEV__ && missing.length > SHORTLIST) {
    // A guard rather than a comment, because the failure is silent and
    // expensive: nothing breaks, the quota just empties.
    throw new Error(
      `Hydration asked for ${missing.length} places; the cap is ${SHORTLIST}. ` +
        "Something is hydrating the candidate pool instead of the shortlist.",
    );
  }

  const cuisineGroups = useQuery({
    queryKey: ["cuisine-counts", centre?.lat, centre?.lon, radiusMiles],
    enabled: centre !== null,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<CuisineGroup[]> => {
      const { data, error } = await supabase.rpc("catalog_cuisine_counts", {
        p_lat: centre!.lat,
        p_lon: centre!.lon,
        p_radius_meters: radiusMiles * MILES,
        p_include_non_destinations: tuning.catalog.includeNonDestinations,
      });
      if (error) throw error;
      return (data ?? []) as CuisineGroup[];
    },
  });

  // The oldest unresolved lock-in, with the place's name. A few hours' delay
  // so somebody is not asked how dinner was while they are still eating it.
  const pendingReview = useQuery({
    queryKey: ["pending-review", userId],
    enabled: userId !== null,
    queryFn: async (): Promise<PendingReview | null> => {
      const { data, error } = await supabase
        .from("place_lockins")
        .select("id, place_id, locked_at, places(display_name)")
        .is("resolved_at", null)
        .lt("locked_at", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order("locked_at", { ascending: true })
        .limit(1);
      if (error) throw error;
      const row = data?.[0] as RawLockin | undefined;
      if (!row) return null;
      return {
        id: row.id,
        place_id: row.place_id,
        display_name: row.places?.[0]?.display_name ?? "that place",
      };
    },
  });

  // Fixed vocabulary, 20 rows, effectively immutable.
  const tagList = useQuery({
    queryKey: ["tags"],
    enabled: userId !== null,
    staleTime: Infinity,
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await supabase
        .from("tags")
        .select("key,label,valence")
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Tag[];
    },
  });

  const resolveLockin = useCallback(
    async (lockinId: string, didGo: boolean, result: ReviewResult | null, placeId?: string) => {
      setReviewBusy(true);
      try {
        if (didGo && result && placeId && userId) {
          // One current verdict per user per place -- changing your mind
          // replaces it rather than appending a second.
          const { data: verdict, error } = await supabase
            .from("place_verdicts")
            .upsert(
              {
                user_id: userId,
                place_id: placeId,
                verdict: result.verdict,
                note: result.note,
                visited_on: new Date().toISOString().slice(0, 10),
              },
              { onConflict: "user_id,place_id" },
            )
            .select("id")
            .single();
          if (error) throw error;

          // Tags are replaced wholesale: a re-review should move the tags, not
          // accumulate the old ones alongside the new.
          await supabase.from("verdict_tags").delete().eq("verdict_id", verdict.id);
          if (result.tagKeys.length > 0) {
            await supabase.from("verdict_tags").insert(
              result.tagKeys.map((tag_key) => ({ verdict_id: verdict.id, tag_key })),
            );
          }
        }
        await supabase
          .from("place_lockins")
          .update({ resolved_at: new Date().toISOString(), did_go: didGo })
          .eq("id", lockinId);
      } catch (e) {
        console.warn("review not saved:", e instanceof Error ? e.message : String(e));
      } finally {
        setReviewBusy(false);
        setReviewDismissed(true);
        setPinnedIds(null); // a verdict changes the ranking inputs.
        void pendingReview.refetch();
        void catalog.refetch();
      }
    },
    [userId, pendingReview, catalog],
  );

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
      lat: p.lat,
      lon: p.lon,
      why: whyFor(p),
    };
  });

  if (sessionError) {
    return <Notice head="Couldn't connect" body={sessionError} />;
  }

  // Review capture is an interstitial, never a destination (§13). It appears
  // on the next cold open after a lock-in and takes precedence over the
  // shortlist: answering it is what makes the shortlist better, and a prompt
  // behind a list is a prompt nobody answers.
  const pending = pendingReview.data;
  if (!reviewDismissed && pending && tagList.data) {
    return (
      <ReviewCapture
        subject={{ placeId: pending.place_id, name: pending.display_name, lockinId: pending.id }}
        tags={tagList.data}
        busy={reviewBusy}
        onDismiss={() => setReviewDismissed(true)}
        onDidNotGo={() => void resolveLockin(pending.id, false, null)}
        onSubmit={(r) => void resolveLockin(pending.id, true, r, pending.place_id)}
      />
    );
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
  // Permission granted, no position. Different problem, different words --
  // telling somebody to enable a setting they already enabled is how an app
  // teaches people not to read its messages.
  if (locateFailure === "no_fix" && !coords) {
    return (
      <Notice
        head="Can't get a fix."
        body="Location's on, but your phone hasn't found itself yet. That's usually indoors or a cold start."
        action={{ label: "Try again", onPress: () => void locate() }}
      />
    );
  }
  if (catalog.isPending || !coords) return <Spinner />;
  if (catalog.isError) {
    return <Notice head="Search failed" body={(catalog.error as Error).message} />;
  }

  if (sheet === "where") {
    return (
      <LocationPicker
        towns={(towns.data ?? []) as Town[]}
        origin={origin}
        radiusMiles={radiusMiles}
        localCount={pool.length}
        onCancel={() => setSheet("none")}
        onPick={(next, miles) => {
          setOrigin(next);
          setRadiusMiles(miles);
          setSheet("none");
        }}
      />
    );
  }

  if (sheet === "what") {
    return (
      <FilterSheet
        groups={cuisineGroups.data ?? []}
        moods={myTags.data?.moods ?? []}
        initial={filters}
        onCancel={() => setSheet("none")}
        // Committed ONCE, here, on dismissal. Nothing behind the sheet
        // reflows while it is open (§6).
        onCommit={(next) => {
          setFilters(next);
          setSheet("none");
        }}
      />
    );
  }

  if (revealOpen && revealCandidates.length > 0) {
    return (
      <SurpriseReveal
        candidates={revealCandidates}
        onClose={() => setRevealOpen(false)}
        onCommit={(c) => {
          // A lock-in, not a visit and not a verdict. It drives provisional
          // recency suppression and gives review capture its trigger; review
          // capture then resolves it into a verdict or into "didn't go".
            setPinnedIds(null); // a lock-in is a real change; re-choose.
          void supabase
            .from("place_lockins")
            .insert({ user_id: userId, place_id: c.placeId })
            .then(({ error }) => {
              // Deliberately not surfaced. The user has decided where they are
              // going and is about to put the phone down; an error toast at
              // that moment interrupts the one thing the app exists to finish.
              // The cost of a lost lock-in is one redundant suggestion.
              if (error) console.warn("lock-in not recorded:", error.message);
            });
        }}
      />
    );
  }

  return (
    <View style={s.screen}>
      {/*
        Android runs edge-to-edge, so the ScrollView really does extend under
        the status bar -- and with nothing painted there, the list scrolls
        visibly behind the clock and the battery icon. Padding the content by
        insets.top moves the content down but paints nothing, which is why the
        first card still passed under the icons.
        This is the missing half: an opaque strip in the ground colour, drawn
        AFTER the ScrollView so it sits above it.
      */}
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.lg,
          // Clears the floating action, so the last card is never trapped
          // underneath it.
          paddingBottom: insets.bottom + 76,
          paddingHorizontal: 18,
        }}
      >
        <View style={s.topRow}>
          <Text style={s.eyebrow}>Tonight</Text>
          {/* §13: header right, ONE affordance, opening the shelf. */}
          <Pressable
            onPress={() => router.push("/shelf")}
            accessibilityRole="button"
            hitSlop={12}
          >
            <Text style={s.shelfLink}>Yours</Text>
          </Pressable>
        </View>
        <View style={s.chips}>
          <Pressable
            onPress={() => setSheet("where")}
            accessibilityRole="button"
            style={({ pressed }) => [s.chip, pressed && s.chipPressed]}
          >
            <Text style={s.chipLabel}>
              {origin.kind === "town" ? origin.name : "Where I am"}
            </Text>
            <Text style={s.chipCount}>{radiusMiles} mi</Text>
          </Pressable>
          <Pressable
            onPress={() => setSheet("what")}
            accessibilityRole="button"
            style={({ pressed }) => [
              s.chip, activeFilterCount > 0 && s.chipOn, pressed && s.chipPressed,
            ]}
          >
            <Text style={[s.chipLabel, activeFilterCount > 0 && s.chipLabelOn]}>
              {activeFilterCount > 0 ? `${activeFilterCount} filters` : "Anything"}
            </Text>
            <Text style={[s.chipCount, activeFilterCount > 0 && s.chipCountOn]}>
              {pool.length}
            </Text>
          </Pressable>
        </View>
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
                <PlaceCard
                  key={p.place_id}
                  {...toCard(p, liveById.get(p.place_id), () =>
                    // Via detail, not straight to the sheet: the address is
                    // what tells the user WHICH record they are reporting.
                    // See design spec §13.
                    router.push(`/place/${p.place_id}?correct=1`),
                  )}
                  isFirst={i === 0}
                  // §13: card tap pushes detail. The whole row is the target.
                  onPress={() => router.push(`/place/${p.place_id}`)}
                />
              ))}
            </View>

            {/* Licence obligation (§7): shown whenever Google data is on screen. */}
            {liveById.size > 0 ? (
              <Text style={s.attrib}>Ratings and hours from Google · Powered by Google</Text>
            ) : null}
          </>
        )}
      </ScrollView>

      {/*
        Android runs edge-to-edge, so the ScrollView really does extend under
        the status bar -- and with nothing painted there, the list scrolls
        visibly behind the clock and the battery icon. Padding the content by
        insets.top moves content down but paints nothing, which is why the
        first card still passed under the icons.
        Drawn after the ScrollView so it sits above it.
      */}
      <View style={[s.statusScrim, { height: insets.top }]} pointerEvents="none" />

      {!exhausted && shortlist.length > 0 ? (
        /*
          A floating pill rather than a full-width bar.
          The bar was about 100pt of a phone screen given to one button, on the
          screen whose whole job is showing a list. Floating it hands that back
          to the cards while keeping the action exactly where the thumb is.
          It is still the only primary action on the screen, and still pinned
          (§13) -- what changed is how much room it takes to say so.
          Brass on the ground has enough contrast to read over a scrolling
          card without a scrim; the shadow is platform-split because iOS and
          Android disagree about how to draw one.
        */
        <View
          style={[s.floatWrap, { bottom: insets.bottom + theme.space.md }]}
          pointerEvents="box-none"
        >
          <Pressable
            onPress={() => setRevealOpen(true)}
            accessibilityRole="button"
            style={({ pressed }) => [s.float, pressed && s.btnPressed]}
          >
            <Text style={s.floatLabel}>You pick.</Text>
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
function toCard(
  p: CatalogPlace,
  hydrated: HydratedPlace | undefined,
  onCorrect?: () => void,
): PlaceCardProps {
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
    action = { label: "Still there?", tone: "plain", onPress: onCorrect };
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

/**
 * The one line of voice on the reveal.
 *
 * Two honest sources exist today and neither needs a verdict -- both are §5
 * confidence states, read straight off the catalog:
 *
 *   nobody has confirmed it      -> "Nobody's said a word about this one."
 *   untouched upstream pre-2025  -> "This one may have changed hands."
 *
 * When neither applies the line is NULL and the reveal omits it. Omitting
 * still beats filling: a why-line that says something true of every place is
 * not voice, it is decoration that teaches people to stop reading it.
 */
function whyFor(p: CatalogPlace): string | null {
  if (p.freshness === 1) return "This one may have changed hands.";
  if (p.confirmations === 0) return "Nobody's said a word about this one.";
  return null;
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
    topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    shelfLink: { ...type.label, color: c.inkMuted },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.md },
    chip: {
      flexDirection: "row", alignItems: "center", columnGap: 6,
      borderWidth: hairline, borderColor: c.rule, backgroundColor: c.surface,
      borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 13,
    },
    chipOn: { backgroundColor: c.ink, borderColor: c.ink },
    chipPressed: { opacity: 0.6 },
    chipLabel: { ...type.meta, color: c.ink },
    chipLabelOn: { color: c.ground },
    chipCount: { ...type.tileMeta, color: c.inkFaint },
    chipCountOn: { color: c.ground, opacity: 0.82 },
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
    btnWide: { paddingHorizontal: 0, marginTop: 0, paddingVertical: 13 },
    floatWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
    float: {
      backgroundColor: c.brass,
      borderRadius: radius.pill,
      paddingVertical: 13,
      paddingHorizontal: 30,
      // Platform-split on purpose: shadowColor is ignored on Android and
      // elevation is ignored on iOS.
      shadowColor: c.ground,
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    floatLabel: { ...type.button, color: c.brassInk },
    statusScrim: {
      position: "absolute", top: 0, left: 0, right: 0,
      backgroundColor: c.ground,
    },
    // Slimmed. It was paddingTop 16 + button 15/15 + bottom inset + 16, about
    // 100pt of a phone screen given over to one button on the screen whose
    // entire job is showing you a list. The rule is gone too: against the
    // ground colour it drew a line under the content for no reason, since the
    // bar already separates itself by sitting still while the list moves.
    actbar: {
      backgroundColor: c.ground,
      paddingHorizontal: 18,
      paddingTop: space.md,
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
