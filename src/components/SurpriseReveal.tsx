import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
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
 *
 * ----------------------------------------------------------------------------
 * GOING BACK (added 2026-09-24, from a week of use)
 * ----------------------------------------------------------------------------
 * "Letting you pick and me saying next shouldn't make you drop that pick. I
 * should be able to swipe back through them."
 *
 * Correct, and it was never a budget question -- every member of `sequence` is
 * already hydrated, so moving backwards through it is as free as moving
 * forwards. The forward-only design was charging a real cost (losing a place
 * you liked) to enforce a commitment that the reroll cap already enforces.
 *
 * The rule, and it is the whole of the change:
 *
 *   `index`    is where you are and moves in both directions, freely.
 *   `furthest` is how far you have ever gone, and only ever increases.
 *
 * A reroll is spent by advancing PAST `furthest` -- reaching somewhere new.
 * Returning to a place you have already seen costs nothing and is never
 * refused, including after the cap is exhausted, which is exactly the trap
 * this fixes: three rerolls spent, wanting the second one back, no way there.
 *
 * So the cap still binds. You may still only ever meet four places. You simply
 * are no longer punished for looking at them in order.
 *
 * Motion is the honest inverse: forward dismisses UPWARD and enters from
 * below, backward dismisses DOWNWARD and enters from above. Going back should
 * not look like going forward, or the direction stops meaning anything.
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
  /**
   * How far through `sequence` you have ever been. Only increases.
   *
   * This, not `index`, is what a reroll is spent on -- see the header. Keeping
   * them separate is what lets you walk back and forth through what you have
   * already seen without the pips moving.
   */
  const [furthest, setFurthest] = useState(0);
  /**
   * The pending reroll timer.
   *
   * Held in a ref so it can actually be cancelled. It used to be a local
   * `const t` with `return () => clearTimeout(t)` at the end of the callback
   * -- which looks like a cleanup but is not one: React calls an event
   * handler and discards its return value, so that clearTimeout never ran.
   * Closing the reveal within 180ms of a reroll left a timer that fired into
   * a screen the user had already left.
   */
  const rerollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A real cleanup, in a real effect.
  useEffect(() => {
    return () => {
      if (rerollTimer.current) clearTimeout(rerollTimer.current);
    };
  }, []);
  const [committed, setCommitted] = useState(false);
  const pick = sequence[index];

  const nameOpacity = useSharedValue(0);
  const nameShift = useSharedValue(8);
  const ruleWidth = useSharedValue(0);
  const whyOpacity = useSharedValue(0);

  const play = useCallback(
    (fromBelow: boolean) => {
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
      // Enter from BELOW when moving forward, from ABOVE when moving back.
      // This used to be `entering ? 8 : 8` -- both branches the same, so the
      // parameter did nothing. It means something now.
      nameShift.value = fromBelow ? 8 : -8;
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

  /**
   * Move through the sequence. `+1` forward, `-1` back.
   *
   * Refuses only three things: falling off either end, and advancing past
   * `furthest` once the cap is spent. Note what is NOT refused -- going back
   * is always allowed, including when `rerollsLeft` is zero.
   */
  const step = useCallback(
    (delta: 1 | -1) => {
      const target = index + delta;
      if (target < 0 || target >= sequence.length) return;
      // Reaching somewhere NEW is what costs. Returning never does.
      if (target > furthest && furthest >= MAX_REROLLS) return;

      const forward = delta === 1;

      if (reduced) {
        setIndex(target);
        setFurthest((f) => Math.max(f, target));
        play(forward);
        return;
      }

      // 1. Pip first -- handled by `furthest` advancing after the exit, so the
      //    pip state change is scheduled immediately while the name is here.
      // 2. Old name exits (180ms) in the direction of travel: UPWARD when
      //    moving forward, DOWNWARD when moving back.
      // 3. The new one enters from the opposite side.
      nameOpacity.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.cubic) });
      nameShift.value = withTiming(forward ? -8 : 8, {
        duration: 180,
        easing: Easing.in(Easing.cubic),
      });
      ruleWidth.value = withTiming(0, { duration: 120 });
      whyOpacity.value = withTiming(0, { duration: 120 });

      if (rerollTimer.current) clearTimeout(rerollTimer.current);
      rerollTimer.current = setTimeout(() => {
        rerollTimer.current = null;
        setIndex(target);
        setFurthest((f) => Math.max(f, target));
        // play() sets the entry offset itself, from the direction.
        play(forward);
      }, 180);
    },
    [index, furthest, sequence.length, reduced, play, nameOpacity, nameShift, ruleWidth, whyOpacity],
  );

  /**
   * A stable door into `step` for the gesture worklet.
   *
   * `step` changes identity every time `index` moves, and a Pan gesture
   * rebuilt on every render loses an in-flight touch. The ref keeps the
   * gesture object constant while still calling the current `step`.
   */
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  const invokeStep = useCallback((d: 1 | -1) => stepRef.current(d), []);

  /**
   * Swipe, as asked for: right goes back, left goes forward.
   *
   * activeOffsetX keeps it from stealing vertical scrolls, and the 60px
   * threshold keeps a lazy tap-drag from counting as a decision. This is an
   * addition to the buttons, never a replacement -- §11 forbids a gesture
   * being the only way to reach anything, and this screen is explicitly meant
   * to work in a car.
   */
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-20, 20])
        .onEnd((e) => {
          "worklet";
          if (e.translationX > 60) runOnJS(invokeStep)(-1);
          else if (e.translationX < -60) runOnJS(invokeStep)(1);
        }),
    [invokeStep],
  );

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

  // From `furthest`, not `index`. Counting from `index` would REFUND a reroll
  // every time you stepped back, turning the cap into an infinite loop:
  // back, forward, back, forward.
  const rerollsLeft = Math.min(MAX_REROLLS, sequence.length - 1) - furthest;
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

      <GestureDetector gesture={pan}>
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
      </GestureDetector>

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
              <Drawn
                label={rerollsLeft === 1 ? "One more, then you're committing." : "Something else"}
                onPress={() => step(1)}
                tone="quiet"
              />
            ) : null}
            {/* Back sits with the pips rather than beside "Something else":
                it is a recovery action, not an equal alternative, and the
                hierarchy should say so. It survives `rerollsLeft` hitting
                zero -- that is the trap it exists to open. */}
            {index > 0 || rerollsLeft > 0 ? (
              <View style={s.stepRow}>
                {index > 0 ? (
                  <Pressable
                    onPress={() => step(-1)}
                    accessibilityRole="button"
                    accessibilityLabel={`Back to ${sequence[index - 1]?.name ?? "the previous place"}`}
                    hitSlop={12}
                  >
                    <Text style={s.backStep}>The one before</Text>
                  </Pressable>
                ) : (
                  <View />
                )}
                {rerollsLeft > 0 ? <Pips total={MAX_REROLLS} spent={furthest} /> : null}
              </View>
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
    /* Back and the pips share a line: recovery on the left, cost on the
       right. `pips` carries its own marginTop, so `backStep` matches it
       rather than the row setting one for both. */
    stepRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    backStep: { ...type.label, color: c.inkMuted, marginTop: space.md },
    signoff: { ...type.pick, color: c.ink },
    after: { ...type.body, color: c.inkMuted },
  });
