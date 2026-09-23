import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The user's theme choice, persisted per device.
 *
 * Three states, and "system" is the default rather than an afterthought:
 * most people never open a setting, and following the phone is the right
 * behaviour for them.
 *
 * Why the choice exists at all. Spec §1 is emphatic that dark is the PRIMARY
 * theme and light is the daylight variant — the app is used in a car, often
 * after dark, and §11 says "dark is the default at night". Following the OS
 * silently contradicts that on any phone set to light: it shows the daylight
 * theme at 9pm, which is the exact case the spec argues against. But the
 * light palette is real, contrast-audited work for a genuine use, so removing
 * the choice would be worse than offering it.
 *
 * Stored per device, not on the profile. A theme is a property of the screen
 * you are looking at — somebody with a phone and a tablet may reasonably want
 * different answers — and it is not worth a round trip on every cold open.
 */
export type ThemePreference = "system" | "dark" | "light";

const KEY = "elsewhere.theme.v1";

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    // A read failure must not decide someone's theme for them permanently.
    return "system";
  }
}

export async function saveThemePreference(p: ThemePreference): Promise<void> {
  try {
    if (p === "system") await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, p);
  } catch {
    // Non-fatal: it reverts to following the phone next launch.
  }
}
