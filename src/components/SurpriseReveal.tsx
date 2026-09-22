import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { tuning } from "@/config/tuning";
import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { tabular, type } from "@/theme/type";

/**
 * The reveal (design spec §14).
 *
 * ----------------------------------------------------------------------------
 * COST: rerolls are free, and that is structural rather than a promise
 * ----------------------------------------------------------------------------
 * §7 requires the pool to be hydrated ONCE and rerolls to draw from the
 * already-hydrated set. This component never fetches anything. It is handed
 * `candidates` that the shortlist has already hydrated into its per-place
 * cache, and a reroll picks a different member of that same array. There is no
 * code path here that can issue a Google call, so the cap of three is a
 * commitment device rather than a budget -- which is what lets the copy say so
 * honestly.
 *
 * ----------------------------------------------------------------------------
 * MOTION: the failure mode is a slot machine
 * ----------------------------------------------------------------------------
 * Do not cycle names, do not spin, do not stagger characters. A person with
 * taste pauses and then tells you; the name arrives whole.
 *
 * The reroll ORDER is the part that carries the meaning:
 *
 *   1. The pip extinguishes FIRST (120ms).
 *   2. The old name exits UPWARD and fades (180ms) -- dismissed, not shuffled.
 *   3. The new name enters from below (320ms).
 *
 * You see the cost before you see the reward. Reversed, it reads as a reward
 * with a price attached, which is a slot machine. Nothing here exceeds the
 * 600ms budget, and reduced motion collapses all of it to a 120ms crossfade.
 */

export interface RevealCandidate {
  placeId: string;
  name: string;
  cuisine?: string | null;
  locality?: string | null;
  distanceMiles?: number | null;
  rating?: number | null;
  priceLevel?: string | null;
  phone?: string | null;
  lat?: number | null;
  lon?: number | null;
  /** The one line of voice. Omitted when there is no honest one. */
  why?: string | null;
}

export interface SurpriseRevealProps {
  candidates: RevealCandidate[];
  onClose: () => void;
  onCommit: (candidate: RevealCandidate) => void;
}

/**
 * Open the platform's own maps app, falling back to the web.
 *
 * Not a feature -- a URL scheme per platform. iOS and Android disagree on the
 * shape, and both can fail (no maps app installed, scheme blocked), so the
 * https fallback is not optional: a "Directions" button that does nothing is
 * worse than one that opens a browser.
 *
 * The Android form carries the name in parentheses so the pin is labelled
 * rather than being an anonymous dot at a coordinate.
 */
async function openDirections(lat: number, lon: number, name: string): Promise<void> {
  const web = `https://maps.google.com/?q=${lat},${lon}`;
  const native =
    Platform.OS === "ios"
      ? `maps://?daddr=${lat},${lon}`
      : `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(name)})`;
  try {
    if (await Linking.canOpenURL(native)) {
      await Linking.openURL(native);
      return;
    }
  } catch {
    // Fall through. canOpenURL can throw on a scheme the OS will not even
    // answer questions about, which is not a reason to give up on the button.
  }
  await Linking.openURL(web).catch(() => {});
}

/** §7: the cap is about commitment, not budget. Rerolls cost nothing. */
const MAX_REROLLS = 3;

const STAR = "★";

export function SurpriseReveal({ candidates, onClose, onCommit }: SurpriseRevealProps) {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  // Draw from the top of the pool, not the whole of it (§15). Order is fixed
  // once so a reroll is a step through a decided sequence rather than a fresh
  // random draw that can repeat itself.
  const sequence = useMemo(() => {
    const top = candidates.slice(0, tuning.rerollPool.drawFromTop);
    for (let i = top.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [top[i], top[j]] = [top[j], top[i]];
    }
    return top;
  }, [candidates]);

  const [index, setIndex] = useState(0);
  const [committed, setCommitted] = useState(false);
  const pick = sequence[index];

  const nameOpacity = useSharedValue(0);
  const nameShift = useSharedValue(8);
  const ruleWidth = useSharedValue(0);
  const whyOpacity = useSharedValue(0);

  const play = useCallback(
    (entering: boolean) => {
      if (reduced) {
        // Everything collapses to a crossfade. No state is encoded in motion
        // alone -- the pips carry a ring as well as a fill for this reason.
        nameShift.value = 0;
        nameOpacity.value = withTiming(1, { duration: 120 });
        ruleWidth.value = withTiming(44, { duration: 120 });
        whyOpacity.value = withTiming(1, { duration: 120 });
        return;
      }
      nameOpacity.value = 0;
      nameShift.value = entering ? 8 : 8;
      ruleWidth.value = 0;
      whyOpacity.value = 0;

      nameOpacity.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
      nameShift.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
      ruleWidth.value = withDelay(120, withTiming(44, { duration: 200, easing: Easing.out(Easing.cubic) }));
      whyOpacity.value = withDelay(240, withTiming(1, { duration: 200 }));
    },
    [reduced, nameOpacity, nameShift, ruleWidth, whyOpacity],
  );

  useEffect(() => { play(true); }, [play]);

  const reroll = useCallback(() => {
    if (index >= MAX_REROLLS || index + 1 >= sequence.length) return;

    if (reduced) {
      setIndex((i) => i + 1);
      play(true);
      return;
    }

    // 1. Pip first -- handled by `index` advancing after the exit, so the pip
    //    state change is scheduled immediately while the name is still here.
    // 2. Old name exits UPWARD (180ms), then
    // 3. the new one enters from below.
    nameOpacity.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) });
    nameShift.value = withTiming(-8, { duration: 180, easing: Easing.in(Easing.cubic) });
    ruleWidth.value = withTiming(0, { duration: 120 });
    whyOpacity.value = withTiming(0, { duration: 120 });

    const t = setTimeout(() => {
      setIndex((i) => i + 1);
      nameShift.value = 8;
      play(true);
    }, 180);
    return () => clearTimeout(t);
  }, [index, sequence.length, reduced, play, nameOpacity, nameShift, ruleWidth, whyOpacity]);

  const commit = useCallback(() => {
    setCommitted(true);
    // Small and certain, no celebration: the rule expands to full width and
    // the actions change. 280ms.
    ruleWidth.value = withTiming(999, {
      duration: reduced ? 120 : 280,
      easing: Easing.out(Easing.cubic),
    });
    onCommit(pick);
  }, [pick, onCommit, reduced, ruleWidth]);

  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ translateY: nameShift.value }],
  }));
  const ruleStyle = useAnimatedStyle(() => ({ width: ruleWidth.value }));
  const whyStyle = useAnimatedStyle(() => ({ opacity: whyOpacity.value }));

  if (!pick) return null;

  const rerollsLeft = Math.min(MAX_REROLLS, sequence.length - 1) - index;
  const meta = [
    pick.cuisine,
    pick.locality,
    pick.distanceMiles != null ? `${pick.distanceMiles.toFixed(1)} mi` : null,
    pick.rating != null ? `${STAR}${pick.rating.toFixed(1)}` : null,
    pick.priceLevel,
  ].filter(Boolean) as string[];

  return (
    <View style={[s.screen, { paddingTop: insets.top + theme.space.xxl }]}>
      <View style={s.top}>
        <Text style={s.eyebrow}>{committed ? "Locked in" : "Tonight"}</Text>
        {!committed ? (
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={12}>
            <Text style={s.close}>Back</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={s.body}>
        <Animated.Text style={[s.pick, nameStyle]} numberOfLines={3}>
          {pick.name}
        </Animated.Text>

        <Animated.View style={[s.rule, ruleStyle]} />

        <Animated.View style={whyStyle}>
          {/* Omitted when there is no honest one. Never filled. */}
          {pick.why ? <Text style={s.why}>{pick.why}</Text> : null}
          {meta.length > 0 ? (
            <View style={s.facts}>
              {meta.map((m) => (
                <Text key={m} style={[s.fact, tabular]}>{m}</Text>
              ))}
            </View>
          ) : null}
        </Animated.View>
      </View>

      <View style={[s.acts, { paddingBottom: insets.bottom + theme.space.lg }]}>
        {committed ? (
          <>
            <View style={s.row}>
              {pick.lat != null && pick.lon != null ? (
                <Drawn
                  label="Directions"
                  onPress={() => void openDirections(pick.lat!, pick.lon!, pick.name)}
                  tone="quiet"
                  grow
                />
              ) : null}
              {/* Phone is Layer 1 -- ours, free. Calling to check they are
                  open costs nothing; asking Google for the hours costs money
                  (§7), so this button is the cheap half of that question. */}
              {pick.phone ? (
                <Drawn
                  label="Call"
                  onPress={() => void Linking.openURL(`tel:${pick.phone!.replace(/[^\d+]/g, "")}`)}
                  tone="quiet"
                  grow
                />
              ) : null}
            </View>
            <Text style={s.signoff}>Go eat.</Text>
            <Text style={s.after}>I&apos;ll ask how it went tomorrow.</Text>
          </>
        ) : (
          <>
            <Drawn label="That's the one." onPress={commit} tone="primary" />
            {rerollsLeft > 0 ? (
              <>
                <Drawn
                  label={rerollsLeft === 1 ? "One more, then you're committing." : "Something else"}
                  onPress={reroll}
                  tone="quiet"
                />
                <Pips total={MAX_REROLLS} spent={index} />
              </>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Rerolls render as pips, not a decrementing integer.
 *
 * A number reads as a metered resource -- "2 left" invites you to spend it.
 * Pips read as a decision you are using up. The spent state carries a RING as
 * well as an absence of fill, because §11 forbids encoding state in colour
 * alone.
 */
function Pips({ total, spent }: { total: number; spent: number }) {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <View style={s.pips}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[s.pip, i < total - spent ? s.pipLive : s.pipSpent]} />
      ))}
      <Text style={s.pipLabel}>{total - spent} left</Text>
    </View>
  );
}

function Drawn({
  label,
  onPress,
  tone,
  grow,
}: {
  label: string;
  onPress: () => void;
  tone: "primary" | "quiet";
  grow?: boolean;
}) {
  const theme = useTheme();
  const s = styles(theme);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        s.btn,
        tone === "primary" ? s.btnPrimary : s.btnQuiet,
        grow && s.btnGrow,
        pressed && s.btnPressed,
      ]}
    >
      <Text style={[s.btnLabel, tone === "primary" ? s.btnLabelPrimary : s.btnLabelQuiet]}>
        {label}
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
    screen: { flex: 1, backgroundColor: c.ground, paddingHorizontal: space.xl },
    top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    eyebrow: { ...type.label, color: c.brass },
    close: { ...type.meta, color: c.inkMuted },
    body: { flex: 1, justifyContent: "center" },
    pick: { ...type.pick, color: c.ink },
    rule: { height: 2, backgroundColor: c.brass, marginTop: 18, marginBottom: 14 },
    why: { ...type.voice, color: c.ink, marginBottom: space.lg },
    facts: { flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: 6 },
    fact: { ...type.meta, color: c.inkMuted },
    acts: { rowGap: space.sm },
    btn: { borderRadius: radius.button, paddingVertical: 15, alignItems: "center" },
    btnPrimary: { backgroundColor: c.brass },
    btnQuiet: { borderWidth: hairline, borderColor: c.ruleStrong },
    btnPressed: { opacity: 0.7 },
    btnGrow: { flexGrow: 1, flexBasis: 0 },
    row: { flexDirection: "row", columnGap: space.sm },
    btnLabel: { ...type.button },
    btnLabelPrimary: { color: c.brassInk },
    btnLabelQuiet: { color: c.inkMuted },
    pips: { flexDirection: "row", alignItems: "center", justifyContent: "center", columnGap: 5, marginTop: space.md },
    pip: { width: 7, height: 7, borderRadius: 4 },
    pipLive: { backgroundColor: c.brass },
    pipSpent: { borderWidth: 1.5, borderColor: c.inkFaint },
    pipLabel: { ...type.label, color: c.inkFaint, marginLeft: 6 },
    signoff: { ...type.pick, color: c.ink },
    after: { ...type.body, color: c.inkMuted },
  });
