import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type } from "@/theme/type";

/**
 * The filter sheet (design spec §6).
 *
 * Four rules, none of them cosmetic:
 *
 * 1. **Only cuisine groups actually present, each with its count.** Fifteen
 *    groups in a twelve-place town is a screen of dead ends, and a filter
 *    that returns nothing teaches people not to filter. Counts come from
 *    `catalog_cuisine_counts`, server-side, so they are the real numbers and
 *    not a count of the capped pool.
 *
 * 2. **No star floor.** It contradicts the card -- which sets a rating as one
 *    quiet numeral precisely because it is an attribute and not a verdict --
 *    and it promotes well-documented chains over the independents the product
 *    exists to surface. Roughly 30% of the catalog has no rating at all, and
 *    a floor silently deletes all of them.
 *
 * 3. **Uncategorised is never silently swallowed.** A cuisine filter excludes
 *    the rows with no cuisine, which is honest, but it is never offered as a
 *    group to filter *on*, because "Uncategorised" is not a thing anybody
 *    wants to eat.
 *
 * 4. **The sheet commits ONCE, on dismissal.** No live re-render as toggles
 *    change. It is cheaper, and it is the only version usable in a moving
 *    vehicle -- a list reflowing under a thumb at 60mph is not a control.
 *
 * Nothing here is a platform component. The pills and the toggle are drawn.
 */

export interface CuisineGroup {
  slug: string;
  label: string;
  place_count: number;
}

/** A tag the user has actually used. Mood filters are yours, and free. */
export interface MoodTag {
  key: string;
  label: string;
  used: number;
}

export interface Filters {
  cuisines: string[];
  moodTags: string[];
  openNow: boolean;
}

export const DEFAULT_FILTERS: Filters = { cuisines: [], moodTags: [], openNow: false };

export interface FilterSheetProps {
  groups: CuisineGroup[];
  moods: MoodTag[];
  initial: Filters;
  /** Called once, on dismissal, with the final state. */
  onCommit: (next: Filters) => void;
  onCancel: () => void;
}

export function FilterSheet({ groups, moods, initial, onCommit, onCancel }: FilterSheetProps) {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();

  // Local until dismissal. This is what "commits once" means in practice --
  // the parent's filters do not change while the sheet is open, so nothing
  // behind it can reflow.
  const [draft, setDraft] = useState<Filters>(initial);

  const toggleIn = useCallback((list: string[], value: string) => {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }, []);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.grip} />
      <View style={s.head}>
        <Text style={s.title}>Narrow it down</Text>
        <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={12}>
          <Text style={s.quiet}>Cancel</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {groups.length > 0 ? (
          <View style={s.group}>
            <Text style={s.lab}>What sort of thing</Text>
            <View style={s.pills}>
              {groups.map((g) => {
                const on = draft.cuisines.includes(g.slug);
                return (
                  <Pressable
                    key={g.slug}
                    onPress={() => setDraft((d) => ({ ...d, cuisines: toggleIn(d.cuisines, g.slug) }))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [s.pill, on && s.pillOn, pressed && !on && s.pressed]}
                  >
                    <Text style={[s.pillLabel, on && s.pillLabelOn]}>{g.label}</Text>
                    <Text style={[s.pillCount, on && s.pillCountOn]}>{g.place_count}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {/*
          Mood filters are built from tags the user has actually applied, so
          the section simply does not exist until there is history. An empty
          "Mood" heading with nothing under it would advertise a feature that
          cannot work yet -- omitting beats filling, here as on the card.
        */}
        {moods.length > 0 ? (
          <View style={s.group}>
            <Text style={s.lab}>Somewhere that&apos;s…</Text>
            <View style={s.pills}>
              {moods.map((m) => {
                const on = draft.moodTags.includes(m.key);
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => setDraft((d) => ({ ...d, moodTags: toggleIn(d.moodTags, m.key) }))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [s.pill, s.pillBrass, on && s.pillBrassOn, pressed && !on && s.pressed]}
                  >
                    <Text style={[s.pillLabel, on && s.pillLabelBrassOn]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <View style={s.switchRow}>
          <View style={s.switchText}>
            <Text style={s.switchLabel}>Open right now</Text>
            {/* §6: label anything that costs a lookup as costing one. */}
            <Text style={s.switchHint}>Checks Google. Uses part of tonight&apos;s allowance.</Text>
          </View>
          <Pressable
            onPress={() => setDraft((d) => ({ ...d, openNow: !d.openNow }))}
            accessibilityRole="switch"
            accessibilityState={{ checked: draft.openNow }}
            style={[s.toggle, draft.openNow && s.toggleOn]}
          >
            <View style={[s.knob, draft.openNow && s.knobOn]} />
          </Pressable>
        </View>
      </ScrollView>

      <View style={[s.actbar, { paddingBottom: insets.bottom + theme.space.lg }]}>
        <Pressable
          onPress={() => onCommit(draft)}
          accessibilityRole="button"
          style={({ pressed }) => [s.btn, pressed && s.pressed]}
        >
          <Text style={s.btnLabel}>Show me</Text>
        </Pressable>
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
    screen: { flex: 1, backgroundColor: c.surface },
    grip: {
      width: 34, height: 4, borderRadius: radius.pill,
      backgroundColor: c.ruleStrong, alignSelf: "center", marginTop: 9,
    },
    head: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      paddingHorizontal: 18, paddingTop: space.lg, paddingBottom: space.md,
    },
    title: { ...type.sheetHead, color: c.ink },
    quiet: { ...type.meta, color: c.inkMuted },
    body: { paddingHorizontal: 18, paddingBottom: space.xl },
    group: { marginBottom: space.xl },
    lab: { ...type.label, color: c.inkFaint, marginBottom: 9 },
    pills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
    pill: {
      flexDirection: "row", alignItems: "center", columnGap: 5,
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: radius.pill,
      paddingVertical: 7, paddingHorizontal: space.md,
    },
    pillOn: { backgroundColor: c.ink, borderColor: c.ink },
    pillBrass: { borderColor: c.brass },
    pillBrassOn: { backgroundColor: c.brass, borderColor: c.brass },
    pillLabel: { ...type.meta, color: c.ink },
    pillLabelOn: { color: c.ground },
    pillLabelBrassOn: { color: c.brassInk },
    pillCount: { ...type.tileMeta, color: c.inkFaint },
    pillCountOn: { color: c.ground, opacity: 0.82 },
    switchRow: {
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      columnGap: space.lg, paddingVertical: 13,
      borderTopWidth: hairline, borderTopColor: c.rule,
    },
    switchText: { flexShrink: 1, rowGap: 2 },
    switchLabel: { ...type.body, color: c.ink },
    switchHint: { ...type.tileMeta, color: c.inkMuted },
    toggle: {
      width: 42, height: 25, borderRadius: radius.pill, borderWidth: hairline,
      borderColor: c.ruleStrong, backgroundColor: c.surface2, justifyContent: "center",
    },
    toggleOn: { backgroundColor: c.brass, borderColor: c.brass },
    knob: {
      width: 17, height: 17, borderRadius: 9, backgroundColor: c.inkFaint, marginLeft: 3,
    },
    knobOn: { backgroundColor: c.brassInk, marginLeft: 22 },
    actbar: {
      borderTopWidth: hairline, borderTopColor: c.rule,
      paddingHorizontal: 18, paddingTop: space.lg,
    },
    btn: {
      backgroundColor: c.brass, borderRadius: radius.button,
      paddingVertical: 15, alignItems: "center",
    },
    btnLabel: { ...type.button, color: c.brassInk },
    pressed: { opacity: 0.6 },
  });
