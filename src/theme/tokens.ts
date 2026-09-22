import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";

/**
 * The two palettes, from the design spec §1.
 *
 * These are the only colour literals in the app. Everything else reaches them
 * through `useTheme()`. That is not tidiness -- it is the only reason two
 * themes are maintainable at all, and `scripts/check-no-colour-literals.py`
 * fails the build if a literal appears anywhere else under src/.
 *
 * The values were contrast-audited (spec §1, §11): 4.5:1 for text and 3:1 for
 * control boundaries against all three grounds. `inkFaint` and `ruleStrong`
 * were deliberately raised from earlier drafts to clear it. Do not darken them
 * back toward the ground because a screen looks busy -- re-audit instead.
 */

export type ColourToken =
  | "ground"
  | "surface"
  | "surface2"
  | "ink"
  | "inkMuted"
  | "inkFaint"
  | "rule"
  | "ruleStrong"
  | "brass"
  | "brassInk"
  | "green"
  | "oxblood"
  | "glow";

export type Palette = Readonly<Record<ColourToken, string>>;

/** Dark is the primary theme, not the alternate (spec §1, §11). */
const dark: Palette = {
  ground: "#14110D", // screen background
  surface: "#1E1A15", // sheets, cards that lift, review blocks
  surface2: "#29231B", // inset controls, avatars
  ink: "#F1EADD", // primary text
  inkMuted: "#A79C8A", // meta line, secondary text
  inkFaint: "#968974", // labels, counts, separators, attribution
  rule: "#332C22", // hairlines between cards
  ruleStrong: "#6E5E46", // interactive boundaries: pills, buttons, toggles
  brass: "#E0A94A", // the only action colour
  brassInk: "#14110D", // text on brass
  green: "#6FB189", // confirmed / yours / a named friend
  oxblood: "#C4685A", // closure and caution only, never full-bleed
  glow: "rgba(224,169,74,0.13)", // reveal screen radial only
};

/** Light is the daylight variant. Same structure, nothing moves but the values. */
const light: Palette = {
  ground: "#E4E1D6",
  surface: "#F3F1E9",
  surface2: "#EAE7DC",
  ink: "#1F1B15",
  inkMuted: "#625B4E",
  inkFaint: "#696357",
  rule: "#D2CDBE",
  ruleStrong: "#858072",
  brass: "#7E5A18",
  brassInk: "#FFF8E9",
  green: "#2C6448",
  oxblood: "#8F3627",
  glow: "rgba(126,90,24,0.09)",
};

export const palettes = { dark, light } as const;
export type ThemeName = keyof typeof palettes;

/** Spacing scale (spec §1). Seven steps, and nothing between them. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Radii, named by use rather than by size, because the spec assigns them by use. */
export const radius = {
  field: 10,
  button: 12,
  tile: 12,
  pill: 999,
} as const;

/**
 * Hairline weight. Deliberately 1 rather than StyleSheet.hairlineWidth: at
 * 3x density hairlineWidth is 0.33pt, which on the dark palette's low-contrast
 * `rule` against `ground` disappears entirely on some Android panels. The
 * separator between cards is load-bearing -- it is what makes eight stacked
 * cards read as a list rather than a wall.
 */
export const hairline = 1;

export interface Theme {
  readonly name: ThemeName;
  readonly colours: Palette;
  readonly space: typeof space;
  readonly radius: typeof radius;
  readonly hairline: number;
  /**
   * A fixed text scale to render at, instead of following the OS.
   *
   * `null` is the normal case: text scales with Dynamic Type / font size the
   * way spec §11 requires, and nothing here interferes.
   *
   * A number pins the scale and switches OS scaling off, so the result is the
   * same on every device. That is only useful for the harness -- it is how the
   * card can be checked at the largest setting without anyone changing their
   * phone's accessibility options, and without the preview compounding with
   * whatever the tester already has set.
   */
  readonly fontScaleOverride: number | null;
}

function build(name: ThemeName, fontScaleOverride: number | null): Theme {
  return { name, colours: palettes[name], space, radius, hairline, fontScaleOverride };
}

const ThemeContext = createContext<Theme>(build("dark", null));

export interface ThemeProviderProps {
  children: ReactNode;
  /**
   * Pin the theme instead of following the system. Providers nest, so this is
   * what lets one screen render both palettes at once -- which the card
   * harness does, and which is the only honest way to check that the grid
   * really is identical across themes.
   */
  force?: ThemeName;
  /**
   * Pin the text scale rather than following the OS. Harness only -- see
   * `Theme.fontScaleOverride`.
   */
  fontScale?: number;
}

export function ThemeProvider({ children, force, fontScale }: ThemeProviderProps) {
  const scheme = useColorScheme();
  // useColorScheme() returns null when the platform has no preference yet.
  // Falling back to dark rather than light is the spec's position: this app is
  // used in a car, often after dark. A lit sign at dusk is the native state.
  const name: ThemeName = force ?? (scheme === "light" ? "light" : "dark");
  const override = fontScale ?? null;
  const theme = useMemo(() => build(name, override), [name, override]);

  return createElement(ThemeContext.Provider, { value: theme }, children);
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
