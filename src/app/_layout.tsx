import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from "@/lib/themePreference";
import { palettes, ThemeProvider } from "@/theme/tokens";
import { useAppFonts } from "@/theme/type";

/**
 * Fonts and theme are established ONCE, here, for the whole app.
 *
 * They used to be per-screen: every route called useAppFonts() and wrapped
 * itself in a ThemeProvider. That worked while the theme only followed the
 * OS, because every screen independently reached the same answer. The moment
 * the user can CHOOSE, it stops working -- each screen would load the stored
 * preference asynchronously and render the old theme until it arrived, so
 * every navigation would flash.
 */

interface ThemeControl {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const ThemeControlContext = createContext<ThemeControl>({
  preference: "system",
  setPreference: () => {},
});

/** For the shelf's Settings section. */
export function useThemeControl(): ThemeControl {
  return useContext(ThemeControlContext);
}

export default function RootLayout() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The decision window is ~90 seconds (spec §3). Refetching a
            // shortlist mid-decision would reshuffle the list under someone
            // who is halfway through reading it.
            staleTime: 5 * 60 * 1000,
            retry: 1,
          },
        },
      }),
  );

  const [fontsLoaded, fontError] = useAppFonts();
  // null while unread. Rendering before it lands would show the phone's theme
  // and then swap, which is the flash this exists to prevent.
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null);

  useEffect(() => {
    void loadThemePreference().then(setPreferenceState);
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p); // immediate, so the toggle feels instant
    void saveThemePreference(p);
  }, []);

  /**
   * Drop cached Google responses when the app backgrounds.
   *
   * Place detail calls the Atmosphere SKU and it fires on every open, so
   * tapping between two places would charge for the same place twice. The
   * cache is in memory only, no persister is configured, nothing reaches
   * disk, and it is gone on background -- ordinary HTTP behaviour rather than
   * storage. Flagged in docs/STATUS.md as a licensing question, not settled
   * here. Only the Google queries are cleared; Layer 1 and Layer 3 are ours.
   */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        client.removeQueries({ queryKey: ["place_live"] });
        client.removeQueries({ queryKey: ["hydrate"] });
      }
    });
    return () => sub.remove();
  }, [client]);

  if (fontError) {
    // Name the font rather than rendering in a fallback face -- the whole
    // static-instance exercise exists so that cannot happen silently.
    return (
      <View style={bare.centre}>
        <Text style={bare.text}>Fonts failed to load: {fontError.message}</Text>
      </View>
    );
  }
  if (!fontsLoaded || preference === null) {
    return <View style={bare.blank} />;
  }

  return (
    <QueryClientProvider client={client}>
      <ThemeControlContext.Provider value={{ preference, setPreference }}>
        <ThemeProvider preference={preference}>
          <SafeAreaProvider>
            <StatusBar style={preference === "light" ? "dark" : "auto"} />
            <Stack screenOptions={{ headerShown: false }} />
          </SafeAreaProvider>
        </ThemeProvider>
      </ThemeControlContext.Provider>
    </QueryClientProvider>
  );
}

const bare = StyleSheet.create({
  blank: { flex: 1, backgroundColor: palettes.dark.ground },
  centre: {
    flex: 1, alignItems: "center", justifyContent: "center",
    padding: 24, backgroundColor: palettes.dark.ground,
  },
  text: { color: palettes.dark.ink, fontSize: 15 },
});
