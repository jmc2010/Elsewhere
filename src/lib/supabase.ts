// The Supabase client.
//
// This file holds the ONLY two secrets the app is allowed to carry, and both
// are publishable: the project URL and the anon key. The Google Maps key and
// the Anthropic key live exclusively in edge function environments and must
// never appear in a bundle (CLAUDE.md, spec §8).
//
// If you ever find yourself wanting a Google key here, the answer is a call
// to places-proxy.

import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env and fill them in.",
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // There is no URL-based auth callback in a native app.
    detectSessionInUrl: false,
  },
});

/**
 * Every RLS policy on the catalog is `to authenticated`, and catalog_search
 * is granted to that role only, so the app needs an identity before it can
 * ask what is nearby.
 *
 * An anonymous session is the right shape for this: it is a real auth.uid(),
 * so RLS, the per-user Google quota and Layer 3 history all work from the
 * first launch, and Supabase can convert it to a permanent account later
 * without losing anything. That matters because cold start is a competitive
 * problem (spec §10) — asking someone to make an account before the app has
 * shown them a single restaurant is exactly the friction Zest's Plaid wall
 * suffers from.
 */
export async function ensureSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
