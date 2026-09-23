import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CorrectionSheet, type CorrectionResult } from "@/components/CorrectionSheet";
import { appTier } from "@/lib/appTier";
import { ensureSession, supabase } from "@/lib/supabase";
import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { tabular, type } from "@/theme/type";

/**
 * Place detail (design spec §7 attribution, §5 corrections).
 *
 * THE HIERARCHY IS THE ARGUMENT. Yours first, then your people, then Google's
 * block visually separated. That order is the product thesis rendered as a
 * layout, not a preference: merging them is the averaging §4 refuses. "4.2
 * from 9 people" is what every competitor has and the reason none of them
 * help. Whose opinion is whose is the whole argument, so the three sources
 * never touch.
 *
 * ATTRIBUTION IS A LICENCE OBLIGATION, not a design decision. "Powered by
 * Google" on any surface showing their live data, and reviews shown
 * UNMODIFIED with the reviewer's name, photo and a link. Not summarised, not
 * truncated, not re-ranked. This is the one part of the screen not open to
 * iteration.
 *
 * Nothing Google returns is written anywhere. It arrives request-scoped from
 * places-proxy and renders from memory.
 */

interface Detail {
  place_id: string;
  display_name: string;
  lat: number;
  lon: number;
  address_line: string | null;
  locality: string | null;
  locality_suspect: boolean;
  website: string | null;
  phone: string | null;
  cuisines: string[];
  freshness: number;
  confirmations: number;
  opening_soon: boolean;
  my_verdict: "again" | "fine" | "known" | "not_again" | null;
  my_note: string | null;
  my_visited_on: string | null;
  my_tags: string[];
}

interface GoogleReview {
  name?: string;
  relativePublishTimeDescription?: string;
  text?: { text?: string };
  authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
}

/** What places-proxy reports back per place. */
type LiveStatus = "ok" | "unresolved" | "quota_exceeded" | "error";

interface GoogleLive {
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: { openNow?: boolean };
  reviews?: GoogleReview[];
}

const PRICE: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

/**
 * One id for the life of this JS bundle instance, so every Atmosphere call
 * made from a detail screen can be counted together:
 *
 *   select sum(call_count) from google_api_usage where session_id like 'detail-%';
 */
const detailSessionId = `detail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const VERDICT_LABEL: Record<string, string> = {
  again: "You'd go again",
  fine: "It was fine",
  known: "You've been",
  not_again: "You said not again",
};

export default function PlaceDetailRoute() {
  return <PlaceDetail />;
}

function PlaceDetail() {
  // `correct=1` means the user arrived by tapping "Still there?" on a card.
  // They came here to report something, so the correction entry is surfaced
  // rather than left to be hunted for at the bottom of the screen.
  const { id, correct: correctParam } =
    useLocalSearchParams<{ id: string; correct?: string }>();
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [correcting, setCorrecting] = useState(false);
  const [showError, setShowError] = useState(false);
  const arrivedToCorrect = correctParam === "1";

  const detail = useQuery({
    queryKey: ["place_detail", id],
    enabled: !!id,
    queryFn: async (): Promise<Detail | null> => {
      const { data, error } = await supabase.rpc("place_detail", { p_place_id: id });
      if (error) throw error;
      return ((data ?? [])[0] as Detail) ?? null;
    },
  });

  // Layer 2, ONE place, opened deliberately -- which is what justifies the
  // Atmosphere SKU here and nowhere else. This is the only screen that asks
  // for reviews and it asks for exactly one place.
  const live = useQuery({
    queryKey: ["place_live", id],
    enabled: !!id,
    // Never refetched within a foreground session. Re-opening the same place
    // must not charge the Atmosphere SKU a second time -- see _layout.tsx for
    // why this is a cache and not storage, and when it is cleared.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async (): Promise<{ live: GoogleLive | null; status: LiveStatus }> => {
      const { data, error } = await supabase.functions.invoke("places-proxy", {
        // session_id makes the call attributable in google_api_usage, which
        // is how "one open, how many calls?" gets answered with a query
        // instead of an assumption.
        body: {
          action: "detail",
          place_ids: [id],
          session_id: detailSessionId,
          app_tier: appTier,
        },
      });
      if (error) throw error;
      const payload = data as {
        places?: { live: GoogleLive | null; live_status?: LiveStatus }[];
      };
      const first = payload?.places?.[0];
      return { live: first?.live ?? null, status: first?.live_status ?? "error" };
    },
  });

  const correct = useMutation({
    mutationFn: async (r: CorrectionResult) => {
      const userId = await ensureSession();
      // Writes to place_corrections and NOWHERE else. A correction is a claim
      // about the world; place_verdicts holds claims about you. Mixing them
      // would record that you disliked somewhere you merely reported closed.
      const { error } = await supabase.from("place_corrections").upsert(
        { user_id: userId, place_id: id, kind: r.kind, new_name: r.newName },
        { onConflict: "user_id,place_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setCorrecting(false);
      void qc.invalidateQueries({ queryKey: ["place_detail", id] });
      void qc.invalidateQueries({ queryKey: ["catalog_search"] });
    },
  });

  if (correcting && detail.data) {
    return (
      <CorrectionSheet
        placeName={detail.data.display_name}
        busy={correct.isPending}
        onCancel={() => setCorrecting(false)}
        onSubmit={(r) => correct.mutate(r)}
      />
    );
  }

  if (detail.isPending) {
    return <View style={s.centre}><ActivityIndicator color={theme.colours.brass} /></View>;
  }
  if (detail.isError || !detail.data) {
    return (
      <View style={s.centre}>
        <Text style={s.head}>Couldn&apos;t load that.</Text>
        <Text style={s.body}>{(detail.error as Error | null)?.message ?? "No such place."}</Text>
      </View>
    );
  }

  const d = detail.data;
  const g = live.data?.live ?? null;
  // Quota exhaustion is an EXPECTED state with designed copy (§10), not an
  // unexpected error. Conflating them would show somebody a stack trace for
  // the one failure the product planned for.
  const quotaSpent = live.data?.status === "quota_exceeded";
  const meta = [d.cuisines[0], d.locality_suspect ? null : d.locality].filter(Boolean) as string[];

  return (
    <View style={s.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + theme.space.md,
          paddingBottom: insets.bottom + theme.space.xxxl,
          paddingHorizontal: 18,
        }}
      >
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <Text style={s.back}>Back</Text>
        </Pressable>

        <Text style={s.name}>{d.display_name}</Text>
        {meta.length > 0 ? <Text style={s.body}>{meta.join(" · ")}</Text> : null}

        <View style={s.actions}>
          {d.phone ? (
            <Act label="Call" onPress={() => void Linking.openURL(`tel:${d.phone!.replace(/[^\d+]/g, "")}`)} />
          ) : null}
          <Act label="Directions" onPress={() => void Linking.openURL(`https://maps.google.com/?q=${d.lat},${d.lon}`)} />
          {d.website ? <Act label="Website" onPress={() => void Linking.openURL(d.website!)} /> : null}
        </View>

        {d.my_verdict ? (
          <Section title="Yours">
            <Text style={s.verdict}>{VERDICT_LABEL[d.my_verdict]}</Text>
            {d.my_tags.length > 0 ? (
              <View style={s.tagRow}>
                {d.my_tags.map((t) => (
                  <View key={t} style={s.tag}><Text style={s.tagLabel}>{t}</Text></View>
                ))}
              </View>
            ) : null}
            {d.my_note ? <Text style={s.note}>{d.my_note}</Text> : null}
            {d.my_visited_on ? <Text style={s.quiet}>Visited {d.my_visited_on}</Text> : null}
          </Section>
        ) : null}

        {/*
          YOUR PEOPLE sits here when it exists. Omitted rather than shown
          empty: there is no connections model yet (§4's one-hop visibility is
          a deliberate future migration), and an empty "Your people" heading
          broadcasts that nobody you know has been anywhere -- which is
          exactly what §8 warns against for the Friends tab.
        */}

        <Section title="What we know">
          <Row label="Address" value={d.address_line ?? "—"} />
          <Row label="Phone" value={d.phone ?? "Not listed"} />
          <Row
            label="Confirmed by"
            value={d.confirmations === 0
              ? "Nobody yet"
              : `${d.confirmations} ${d.confirmations === 1 ? "person" : "people"}`}
          />
          <Row
            label="Listing"
            value={d.freshness === 1
              ? "Not confirmed since 2024"
              : d.freshness >= 4 ? "Confirmed this cycle" : "Confirmed during 2025"}
          />
          {d.opening_soon ? <Row label="Status" value="Not open yet, going by the name" /> : null}
        </Section>

        {/* §5: a rename is the highest-value contribution in the app -- it
            repairs the row AND unlocks the Google match from then on. */}
        <Pressable
          onPress={() => setCorrecting(true)}
          accessibilityRole="button"
          style={({ pressed }) => [
            s.correct,
            arrivedToCorrect && s.correctPrimary,
            pressed && s.pressed,
          ]}
        >
          <Text style={[s.correctLabel, arrivedToCorrect && s.correctLabelPrimary]}>
            Still there?
          </Text>
          <Text style={s.quiet}>Tell me if it&apos;s gone, renamed, or not somewhere you eat.</Text>
        </Pressable>
        {correct.isError ? (
          <Text style={s.quiet}>Couldn&apos;t send that: {(correct.error as Error).message}</Text>
        ) : null}

        {live.isPending ? (
          <View style={s.google}><ActivityIndicator color={theme.colours.inkFaint} /></View>
        ) : quotaSpent ? (
          <View style={s.google}>
            <View style={s.googleHead}>
              <Text style={s.googleLabel}>From Google</Text>
            </View>
            <Text style={s.quotaHead}>I&apos;m out of Google&apos;s ratings for tonight.</Text>
            <Text style={s.fact}>
              Names, distances, your own notes and your friends&apos; all still
              work — which is most of what you came for.
            </Text>
          </View>
        ) : live.isError ? (
          /*
            Voice first, raw string one tap away -- both requirements are
            real and this satisfies both rather than choosing.

            A bare friendly message is not enough: "something went wrong" hid
            a broken edge function for a full round of cost testing, because a
            failure and a cache hit looked identical. But a raw exception
            string is not something to hand a tester either.

            So: name what failed and what still works, in the app's own voice
            (§10 -- "something went wrong" is the chatbot phrasing that copy
            rules out), with the actual error behind a disclosure and a copy
            button. A tester who can send the real message is worth far more
            than one who says it broke.
          */
          <View style={s.google}>
            <View style={s.googleHead}>
              <Text style={s.googleLabel}>From Google</Text>
            </View>
            <Text style={s.quotaHead}>
              I couldn&apos;t pull the live details for this one.
            </Text>
            <Text style={s.fact}>Everything above is still yours.</Text>

            <Pressable
              onPress={() => setShowError((v) => !v)}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={s.disclose}>
                {showError ? "Hide details" : "What happened?"}
              </Text>
            </Pressable>

            {showError ? (
              <View style={s.errorBox}>
                <Text style={s.errorText} selectable>
                  {(live.error as Error).message}
                </Text>
                {/*
                  Long-press to select and copy, rather than a Copy button.
                  expo-clipboard is a NATIVE module: importing it in an
                  over-the-air update would crash every build that does not
                  already have it compiled in -- the same failure that took an
                  evening to find when the production environment was empty.
                  A copy button is not worth a rebuild and a TestFlight
                  resubmission; `selectable` gets the string out with one
                  extra gesture and ships today.
                */}
                <Text style={s.disclose}>Press and hold to copy.</Text>
              </View>
            ) : null}
          </View>
        ) : g ? (
          <View style={s.google}>
            <View style={s.googleHead}>
              <Text style={s.googleLabel}>From Google</Text>
              <Text style={s.googleLabel}>Powered by Google</Text>
            </View>

            <View style={s.facts}>
              {g.rating != null ? (
                <Text style={[s.fact, tabular]}>
                  {g.rating.toFixed(1)}{g.userRatingCount ? ` · ${g.userRatingCount} ratings` : ""}
                </Text>
              ) : null}
              {g.priceLevel ? <Text style={s.fact}>{PRICE[g.priceLevel] ?? ""}</Text> : null}
              {g.regularOpeningHours?.openNow != null ? (
                <Text style={s.fact}>{g.regularOpeningHours.openNow ? "Open now" : "Closed now"}</Text>
              ) : null}
            </View>

            {(g.reviews ?? []).map((r, i) => (
              <View key={r.name ?? i} style={s.review}>
                {r.authorAttribution?.photoUri ? (
                  <Image source={{ uri: r.authorAttribution.photoUri }} style={s.avatar} />
                ) : (
                  <View style={s.avatar} />
                )}
                <View style={s.reviewBody}>
                  <Pressable
                    onPress={() => r.authorAttribution?.uri ? void Linking.openURL(r.authorAttribution.uri) : undefined}
                  >
                    <Text style={s.reviewer}>
                      {r.authorAttribution?.displayName ?? "A Google user"}
                      {r.relativePublishTimeDescription ? ` · ${r.relativePublishTimeDescription}` : ""}
                    </Text>
                  </Pressable>
                  {r.text?.text ? <Text style={s.reviewText}>{r.text.text}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
      {/* Same edge-to-edge strip as the shortlist: padding moves content, it
          does not paint, so without this the name scrolls under the clock. */}
      <View style={[s.statusScrim, { height: insets.top }]} pointerEvents="none" />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const s = styles(useTheme());
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const s = styles(useTheme());
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  );
}

function Act({ label, onPress }: { label: string; onPress: () => void }) {
  const s = styles(useTheme());
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.act, pressed && s.pressed]}>
      <Text style={s.actLabel}>{label}</Text>
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
    centre: { flex: 1, backgroundColor: c.ground, alignItems: "center", justifyContent: "center", padding: space.xxl, rowGap: space.sm },
    head: { ...type.screenHead, color: c.ink },
    back: { ...type.meta, color: c.inkMuted, marginBottom: space.lg },
    name: { ...type.detailName, color: c.ink, marginBottom: space.sm },
    body: { ...type.body, color: c.inkMuted },
    quiet: { ...type.tileMeta, color: c.inkMuted },

    actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.lg },
    act: { borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.pill, paddingVertical: 8, paddingHorizontal: space.lg },
    actLabel: { ...type.meta, color: c.ink },

    section: { marginTop: space.xxl },
    sectionTitle: { ...type.label, color: c.inkFaint, marginBottom: space.md },
    verdict: { ...type.voice, color: c.ink },
    tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: space.sm },
    tag: { borderWidth: hairline, borderColor: c.green, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10 },
    tagLabel: { ...type.tileMeta, color: c.green },
    note: { ...type.reason, color: c.ink, marginTop: space.sm },

    row: { flexDirection: "row", justifyContent: "space-between", columnGap: space.lg, paddingVertical: 11, borderTopWidth: hairline, borderTopColor: c.rule },
    rowLabel: { ...type.meta, color: c.inkMuted },
    rowValue: { ...type.meta, color: c.ink, flexShrink: 1, textAlign: "right" },

    correctPrimary: { borderColor: c.brass, backgroundColor: c.surface },
    correctLabelPrimary: { color: c.brass },
    correct: { marginTop: space.xxl, borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.button, padding: space.lg, rowGap: 3 },
    correctLabel: { ...type.button, color: c.ink },

    // The separation is the point: its own surface, its own rule, its own
    // heading. Google's data never shares a block with yours.
    google: { marginTop: space.xxxl, backgroundColor: c.surface, borderRadius: radius.button, borderWidth: hairline, borderColor: c.rule, padding: space.lg },
    googleHead: { flexDirection: "row", justifyContent: "space-between", marginBottom: space.md },
    googleLabel: { ...type.label, color: c.inkFaint },
    facts: { flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: 6 },
    fact: { ...type.meta, color: c.inkMuted },
    review: { flexDirection: "row", columnGap: space.md, paddingTop: space.md, marginTop: space.md, borderTopWidth: hairline, borderTopColor: c.rule },
    avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.surface2 },
    reviewBody: { flexShrink: 1, rowGap: 3 },
    reviewer: { ...type.tileMeta, color: c.ink },
    quotaHead: { ...type.voice, color: c.ink, marginBottom: space.sm },
    disclose: { ...type.meta, color: c.brass, marginTop: space.md },
    errorBox: {
      marginTop: space.sm, padding: space.md,
      borderWidth: hairline, borderColor: c.rule, borderRadius: radius.field,
      backgroundColor: c.surface2, rowGap: space.sm,
    },
    errorText: { ...type.tileMeta, color: c.inkMuted },
    reviewText: { ...type.meta, color: c.inkMuted },
    pressed: { opacity: 0.6 },
  });

