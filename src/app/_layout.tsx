import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

// TanStack Query, and deliberately not PowerSync (spec §8). Offline-first is
// not a requirement for a connected dining decision, and PowerSync's
// conflict resolution buys nothing here.
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

  /**
   * Drop cached Google responses when the app backgrounds.
   *
   * Place detail calls the Atmosphere SKU, which is the most expensive thing
   * the app does, and it fires on every open -- so tapping between two places
   * would charge for the same place twice. The query cache holds the response
   * for the life of a foreground session, which is ordinary HTTP behaviour
   * rather than storage: in memory only, no persister is configured, nothing
   * reaches disk, and it is gone the moment the app backgrounds.
   *
   * Flagged in docs/STATUS.md as a licensing question rather than settled
   * here. The Google Maps Platform Terms allow caching place IDs indefinitely
   * and almost nothing else; holding a response for minutes inside one screen
   * session reads as request scope to me, but that is a reading and not a
   * ruling.
   *
   * Only the Google queries are cleared. Layer 1 and Layer 3 are ours and
   * have no such constraint.
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

  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
