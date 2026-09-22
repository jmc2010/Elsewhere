import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme, type Theme, type ThemeName } from "@/theme/tokens";
import { type } from "@/theme/type";

/**
 * The cold-start recognition grid (design spec §8).
 *
 * "Which of these do you already know?" -- a grid of nearby places, tapped.
 *
 * The point is recognition, not recall. A taste questionnaire asks people to
 * introspect and they are bad at it; a grid of names they can either place or
 * not takes seconds and is answered accurately. And what novelty actually
 * needs is not a list of what someone likes -- it is a list of what they
 * already know, which is a different and much easier question.
 *
 * Every tap becomes a `known` verdict: been here at some point, no opinion,
 * date unknown. That is why `known` exists as a distinct verdict and is not a
 * weaker `fine` -- it carries no date, so no recency window can apply to it,
 * but it does mean the place is emphatically not new to you. Six taps is
 * enough to stop the first shortlist ranking on nothing.
 *
 * Nothing here is a platform-standard control; the tiles are drawn.
 */

export interface RecognitionPlace {
  placeId: string;
  /** Already cleaned -- this is `display_name` from catalog_search. */
  name: string;
  /** First cuisine slug, humanised by the caller. Optional: 5.3% have none. */
  cuisine?: string | null;
}

export interface RecognitionGridProps {
  places: RecognitionPlace[];
  selected: ReadonlySet<string>;
  onToggle: (placeId: string) => void;
}

export function RecognitionGrid({ places, selected, onToggle }: RecognitionGridProps) {
  const theme = useTheme();
  const s = styles(theme);

  return (
    <View style={s.grid}>
      {places.map((p) => (
        <Tile
          key={p.placeId}
          place={p}
          isSelected={selected.has(p.placeId)}
          onToggle={onToggle}
          theme={theme}
        />
      ))}
    </View>
  );
}

function Tile({
  place,
  isSelected,
  onToggle,
  theme,
}: {
  place: RecognitionPlace;
  isSelected: boolean;
  onToggle: (placeId: string) => void;
  theme: Theme;
}) {
  const s = styles(theme);
  const handlePress = useCallback(() => onToggle(place.placeId), [onToggle, place.placeId]);

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={
        place.cuisine ? `${place.name}, ${place.cuisine}` : place.name
      }
      style={({ pressed }) => [
        s.tile,
        isSelected && s.tileOn,
        pressed && !isSelected && s.tilePressed,
      ]}
    >
      {/*
        Two lines then ellipsis. The tile is a fixed height so the grid does
        not go ragged -- but the name is the only thing on it that matters, so
        it gets the space and the cuisine is dropped first if anything has to
        give.
      */}
      <Text
        style={[s.tileName, isSelected && s.tileNameOn]}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {place.name}
      </Text>
      {place.cuisine ? (
        <Text style={[s.tileCuisine, isSelected && s.tileCuisineOn]} numberOfLines={1}>
          {place.cuisine}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Two themes only, so build each sheet once. */
const sheets = new Map<ThemeName, ReturnType<typeof build>>();

function styles(theme: Theme): ReturnType<typeof build> {
  let sheet = sheets.get(theme.name);
  if (!sheet) {
    sheet = build(theme);
    sheets.set(theme.name, sheet);
  }
  return sheet;
}

const build = ({ colours: c, space, radius, hairline }: Theme) =>
  StyleSheet.create({
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: space.sm,
    },
    tile: {
      // Two per row, accounting for the gap. flexBasis rather than width so a
      // tile can still shrink if the container is narrower than expected.
      flexGrow: 1,
      flexBasis: "47%",
      minHeight: 74,
      justifyContent: "center",
      rowGap: 3,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      borderRadius: radius.tile,
      borderWidth: hairline,
      borderColor: c.rule,
      backgroundColor: c.surface,
    },
    tileOn: {
      backgroundColor: c.brass,
      borderColor: c.brass,
    },
    tilePressed: {
      opacity: 0.6,
    },
    tileName: {
      ...type.recognition,
      color: c.ink,
    },
    tileNameOn: {
      color: c.brassInk,
    },
    tileCuisine: {
      ...type.tileMeta,
      color: c.inkMuted,
    },
    tileCuisineOn: {
      color: c.brassInk,
    },
  });
