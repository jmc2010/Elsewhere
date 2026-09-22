import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type } from "@/theme/type";

/**
 * The correction sheet (design spec §5) — the existence oracle.
 *
 * Three corrections, mapping to three failures observed by driving around
 * Valley View rather than imagined at a desk:
 *
 *   gone         Rider's Smokehouse, shut for years, listed as open.
 *   renamed      Dairy Queen -> Tia's Tex-Mex, 42.6m apart.
 *   not_a_place  Jbm Specialties, Llc — a listing, not a destination.
 *
 * THE RENAME GETS THE PROMINENT TREATMENT and it is not decoration: it
 * repairs the row AND unlocks the Google match from then on, because the
 * search that could never find "Dairy Queen" finds "Tia's Tex-Mex". It is the
 * single highest-value thing a user can do in this app.
 *
 * A CORRECTION IS NOT A VETO. "It's gone" is a claim about the world; "Not
 * again" is a verdict about you. Nothing here writes to place_verdicts —
 * reporting a closure must not silently record that you disliked somewhere,
 * poison your own novelty signal, or travel to other people as an opinion you
 * never held.
 *
 * And the copy says MAY HAVE CHANGED HANDS, never "may not exist". Every
 * record observed so far pointed at something real. The problem is identity
 * drift, not fabrication, and telling someone a place they can see from the
 * road does not exist is how you teach them the app is wrong.
 */

export type CorrectionKind = "gone" | "renamed" | "not_a_place";

export interface CorrectionResult {
  kind: CorrectionKind;
  newName: string | null;
}

export interface CorrectionSheetProps {
  placeName: string;
  busy?: boolean;
  onSubmit: (result: CorrectionResult) => void;
  onCancel: () => void;
}

export function CorrectionSheet({ placeName, busy, onSubmit, onCancel }: CorrectionSheetProps) {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();

  const [kind, setKind] = useState<CorrectionKind | null>(null);
  const [newName, setNewName] = useState("");

  const canSubmit =
    kind === "gone" ||
    kind === "not_a_place" ||
    (kind === "renamed" && newName.trim().length > 1);

  return (
    <View style={s.screen}>
      <View style={s.grip} />
      <View style={s.head}>
        <Text style={s.title}>What&apos;s changed?</Text>
        <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={12}>
          <Text style={s.quiet}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        <Text style={s.sub}>
          About {placeName}. This goes to the catalog, not to your own list —
          it won&apos;t change what I think you like.
        </Text>

        {/* The rename first and largest. It is the one that repairs the row
            permanently and unlocks the Google match. */}
        <Pressable
          onPress={() => setKind("renamed")}
          accessibilityRole="radio"
          accessibilityState={{ selected: kind === "renamed" }}
          style={({ pressed }) => [
            s.primaryChoice,
            kind === "renamed" && s.primaryChoiceOn,
            pressed && kind !== "renamed" && s.pressed,
          ]}
        >
          <Text style={[s.primaryLabel, kind === "renamed" && s.primaryLabelOn]}>
            It&apos;s called something else now
          </Text>
          <Text style={s.choiceDetail}>
            The most useful thing you can tell me. It fixes the listing for
            everyone and lets me find it again.
          </Text>
        </Pressable>

        {kind === "renamed" ? (
          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="What's it called now?"
            placeholderTextColor={theme.colours.inkFaint}
            style={s.field}
            autoFocus
            autoCapitalize="words"
          />
        ) : null}

        <Choice
          label="It's gone"
          detail="Closed, or moved somewhere else."
          selected={kind === "gone"}
          onPress={() => setKind("gone")}
        />
        <Choice
          label="Not somewhere you eat or drink"
          detail="An office, a plant, a listing that shouldn't be here."
          selected={kind === "not_a_place"}
          onPress={() => setKind("not_a_place")}
        />

        <Text style={s.foot}>
          One report is a note. Two from different people and I&apos;ll stop
          putting it in front of anyone.
        </Text>
      </ScrollView>

      <View style={[s.actbar, { paddingBottom: insets.bottom + theme.space.lg }]}>
        <Pressable
          onPress={() =>
            kind && onSubmit({ kind, newName: kind === "renamed" ? newName.trim() : null })
          }
          disabled={!canSubmit || busy}
          accessibilityRole="button"
          style={({ pressed }) => [s.btn, canSubmit ? s.btnOn : s.btnOff, pressed && s.pressed]}
        >
          <Text style={[s.btnLabel, canSubmit ? s.btnLabelOn : s.btnLabelOff]}>
            {busy ? "…" : "Send it"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Choice({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const s = styles(useTheme());
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={({ pressed }) => [s.choice, selected && s.choiceOn, pressed && !selected && s.pressed]}
    >
      <Text style={[s.choiceLabel, selected && s.choiceLabelOn]}>{label}</Text>
      <Text style={s.choiceDetail}>{detail}</Text>
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
    screen: { flex: 1, backgroundColor: c.surface },
    grip: { width: 34, height: 4, borderRadius: radius.pill, backgroundColor: c.ruleStrong, alignSelf: "center", marginTop: 9 },
    head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 18, paddingTop: space.lg, paddingBottom: space.md },
    title: { ...type.sheetHead, color: c.ink },
    quiet: { ...type.meta, color: c.inkMuted },
    body: { paddingHorizontal: 18, paddingBottom: space.xl, rowGap: space.sm },
    sub: { ...type.body, color: c.inkMuted, marginBottom: space.md },

    primaryChoice: {
      borderWidth: hairline, borderColor: c.brass, borderRadius: radius.button,
      paddingVertical: space.lg, paddingHorizontal: space.lg, rowGap: 4,
    },
    primaryChoiceOn: { backgroundColor: c.surface2 },
    primaryLabel: { ...type.sheetHead, color: c.brass },
    primaryLabelOn: { color: c.brass },

    field: {
      ...type.body, color: c.ink, borderWidth: hairline, borderColor: c.ruleStrong,
      borderRadius: radius.field, paddingHorizontal: space.md, paddingVertical: space.md,
    },

    choice: {
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.button,
      paddingVertical: space.md, paddingHorizontal: space.lg, rowGap: 3,
    },
    choiceOn: { borderColor: c.ink, backgroundColor: c.surface2 },
    choiceLabel: { ...type.body, color: c.ink },
    choiceLabelOn: { color: c.ink },
    choiceDetail: { ...type.tileMeta, color: c.inkMuted },

    foot: { ...type.tileMeta, color: c.inkFaint, marginTop: space.lg },

    actbar: { borderTopWidth: hairline, borderTopColor: c.rule, paddingHorizontal: 18, paddingTop: space.lg },
    btn: { borderRadius: radius.button, paddingVertical: 15, alignItems: "center" },
    btnOn: { backgroundColor: c.brass },
    btnOff: { borderWidth: hairline, borderColor: c.rule },
    btnLabel: { ...type.button },
    btnLabelOn: { color: c.brassInk },
    btnLabelOff: { color: c.inkFaint },
    pressed: { opacity: 0.6 },
  });
