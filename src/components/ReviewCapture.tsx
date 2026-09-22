import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type } from "@/theme/type";

/**
 * Review capture (design spec §4).
 *
 * One screen, one thumb, about four seconds. It is the moat: the verdicts and
 * tags collected here are the only data the product has that nobody else can
 * buy, scrape or infer from a card statement.
 *
 * ----------------------------------------------------------------------------
 * THREE VERDICTS, NEVER STARS
 * ----------------------------------------------------------------------------
 *   Again      eligible, boosted once the cooldown clears
 *   It was fine eligible, no boost, normal recency
 *   Not again  removed from the pool -- a real veto
 *
 * A five-point scale cannot carry WHY, and why is the entire point. "3 stars"
 * cannot distinguish "the food was fine but it was deafening" from "the food
 * was poor but it was quiet", and those two produce opposite recommendations
 * for a Tuesday date and a Saturday with kids.
 *
 * ----------------------------------------------------------------------------
 * THE VERDICT DECIDES WHICH TAG LIST IS SHOWN
 * ----------------------------------------------------------------------------
 * Same dimensions, wording flipped. Nobody is asked to rate ten axes; they
 * pick a verdict and then tap the two or three things that were true. The
 * lists come from the `tags` table, so the vocabulary is fixed and comparable
 * across people -- free text that means the same thing five ways cannot drive
 * an engine, which is what `note` is for instead.
 *
 * ----------------------------------------------------------------------------
 * A VETO WITH NO TAG DOES NOT TRAVEL
 * ----------------------------------------------------------------------------
 * If you will not say why, it stays yours (§4). That is enforced at the point
 * of sharing, not here -- but it is why the tag step is offered on `Not again`
 * as prominently as on `Again`, rather than being treated as the unhappy path.
 */

export type VerdictKind = "again" | "fine" | "not_again";

export interface Tag {
  key: string;
  label: string;
  valence: "pos" | "neg";
}

export interface ReviewSubject {
  placeId: string;
  name: string;
  /** Null when the prompt is speculative rather than from a lock-in. */
  lockinId?: string | null;
}

export interface ReviewResult {
  verdict: VerdictKind;
  tagKeys: string[];
  note: string | null;
}

export interface ReviewCaptureProps {
  subject: ReviewSubject;
  tags: Tag[];
  onSubmit: (result: ReviewResult) => void;
  /** "We didn't end up going" -- resolves the lock-in without a verdict. */
  onDidNotGo: () => void;
  onDismiss: () => void;
  busy?: boolean;
}

const VERDICTS: { kind: VerdictKind; label: string; detail: string }[] = [
  { kind: "again", label: "Again", detail: "I'd go back" },
  { kind: "fine", label: "It was fine", detail: "No complaints, no pull" },
  { kind: "not_again", label: "Not again", detail: "Take it off my list" },
];

export function ReviewCapture({
  subject,
  tags,
  onSubmit,
  onDidNotGo,
  onDismiss,
  busy,
}: ReviewCaptureProps) {
  const theme = useTheme();
  const s = styles(theme);

  const [verdict, setVerdict] = useState<VerdictKind | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [note, setNote] = useState("");
  // `fine` shows nothing until asked. See `shown` below.
  const [expanded, setExpanded] = useState(false);

  /**
   * Which tags to offer, if any.
   *
   *   again      the positive list
   *   not_again  the negative list
   *   fine       NOTHING, until asked
   *
   * `fine` is a complete answer on its own. The positive list would ask
   * somebody to praise a place they were lukewarm about; the negative list is
   * worse -- a column of complaints shown to someone who said "fine" is a
   * leading question that reframes a neutral evening as a bad one. Tapping
   * "Anything worth noting?" reveals BOTH lists, for the "fine, but too loud"
   * case where there genuinely is something to say.
   *
   * Effort ends up proportional to information: the two verdicts that carry
   * signal earn a tag step, the one that does not costs one tap.
   */
  const shown = useMemo(() => {
    if (verdict === "again") return tags.filter((t) => t.valence === "pos");
    if (verdict === "not_again") return tags.filter((t) => t.valence === "neg");
    if (verdict === "fine" && expanded) return tags;
    return [];
  }, [tags, verdict, expanded]);

  const choose = useCallback((kind: VerdictKind) => {
    setVerdict(kind);
    setExpanded(false);
    // Tags are verdict-specific; keeping them across a change would attach
    // "Food was great" to a "Not again".
    setPicked(new Set());
  }, []);

  const toggle = useCallback((key: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.eyebrow}>Last night</Text>
        <Text style={s.head}>How was {subject.name}?</Text>

        <View style={s.verdicts}>
          {VERDICTS.map((v) => {
            const on = verdict === v.kind;
            return (
              <Pressable
                key={v.kind}
                onPress={() => choose(v.kind)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                style={({ pressed }) => [s.verdict, on && s.verdictOn, pressed && !on && s.pressed]}
              >
                <Text style={[s.verdictLabel, on && s.verdictLabelOn]}>{v.label}</Text>
                <Text style={s.verdictDetail}>{v.detail}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* No star row anywhere on this screen, by design. */}
        {verdict === "fine" && !expanded ? (
          <Pressable onPress={() => setExpanded(true)} accessibilityRole="button" hitSlop={8}>
            <Text style={s.expand}>Anything worth noting?</Text>
          </Pressable>
        ) : null}

        {verdict ? (
          <>
            {shown.length > 0 ? (
              <Text style={s.lab}>
                {verdict === "again"
                  ? "What was good?"
                  : verdict === "not_again"
                    ? "What was wrong?"
                    : "What stood out?"}
              </Text>
            ) : null}
            <View style={s.pills}>
              {shown.map((t) => {
                const on = picked.has(t.key);
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => toggle(t.key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [s.pill, on && s.pillOn, pressed && !on && s.pressed]}
                  >
                    <Text style={[s.pillLabel, on && s.pillLabelOn]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Visibly optional, and for the user's own memory -- "ask for the
                corner booth". Not an engine input. */}
            <Text style={s.lab}>Anything for next time? Optional.</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Ask for the corner booth…"
              placeholderTextColor={theme.colours.inkFaint}
              style={s.note}
              multiline
            />
          </>
        ) : null}
      </ScrollView>

      <View style={s.actbar}>
        <Pressable
          onPress={() =>
            verdict && onSubmit({ verdict, tagKeys: Array.from(picked), note: note.trim() || null })
          }
          disabled={!verdict || busy}
          accessibilityRole="button"
          style={({ pressed }) => [
            s.btn, verdict ? s.btnOn : s.btnOff, pressed && s.pressed,
          ]}
        >
          <Text style={[s.btnLabel, verdict ? s.btnLabelOn : s.btnLabelOff]}>
            {busy ? "…" : "Done"}
          </Text>
        </Pressable>

        <View style={s.row}>
          {/* A lock-in is a choice, not a visit. People commit and then don't
              go, and recording that honestly is better than leaving a
              phantom visit in the history. */}
          <Pressable onPress={onDidNotGo} accessibilityRole="button" hitSlop={8}>
            <Text style={s.quiet}>We didn&apos;t go</Text>
          </Pressable>
          <Pressable onPress={onDismiss} accessibilityRole="button" hitSlop={8}>
            <Text style={s.quiet}>Later</Text>
          </Pressable>
        </View>
      </View>
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
    body: { paddingHorizontal: 18, paddingTop: space.xxl, paddingBottom: space.xxl },
    eyebrow: { ...type.label, color: c.brass, marginBottom: 7 },
    head: { ...type.screenHead, color: c.ink, marginBottom: space.xl },

    verdicts: { rowGap: space.sm },
    verdict: {
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.button,
      paddingVertical: 15, paddingHorizontal: space.lg, rowGap: 2,
    },
    verdictOn: { borderColor: c.brass, backgroundColor: c.surface },
    verdictLabel: { ...type.button, color: c.ink },
    verdictLabelOn: { color: c.brass },
    verdictDetail: { ...type.tileMeta, color: c.inkMuted },

    lab: { ...type.label, color: c.inkFaint, marginTop: space.xxl, marginBottom: space.sm },
    expand: { ...type.meta, color: c.brass, marginTop: space.lg },
    pills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
    pill: {
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.pill,
      paddingVertical: 7, paddingHorizontal: space.md,
    },
    pillOn: { backgroundColor: c.ink, borderColor: c.ink },
    pillLabel: { ...type.meta, color: c.ink },
    pillLabelOn: { color: c.ground },

    note: {
      ...type.body, color: c.ink, borderWidth: hairline, borderColor: c.ruleStrong,
      borderRadius: radius.field, padding: space.md, minHeight: 72,
      textAlignVertical: "top",
    },

    actbar: {
      borderTopWidth: hairline, borderTopColor: c.rule,
      paddingHorizontal: 18, paddingVertical: space.lg, rowGap: space.md,
    },
    btn: { borderRadius: radius.button, paddingVertical: 15, alignItems: "center" },
    btnOn: { backgroundColor: c.brass },
    btnOff: { borderWidth: hairline, borderColor: c.rule },
    btnLabel: { ...type.button },
    btnLabelOn: { color: c.brassInk },
    btnLabelOff: { color: c.inkFaint },
    row: { flexDirection: "row", justifyContent: "space-between" },
    quiet: { ...type.meta, color: c.inkMuted },
    pressed: { opacity: 0.6 },
  });
