import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
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

  return (
    <QueryClientProvider client={client}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
