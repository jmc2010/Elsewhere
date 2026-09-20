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

// Supabase renamed the client-side key: the dashboard now issues a
// "publishable key" (sb_publishable_...) in place of the older "anon key"
// (a JWT beginning eyJ...). Both are accepted by supabase-js and both are
// safe to ship, because neither grants anything RLS would not.
//
// Either variable name works, so a .env written against the old naming keeps
// running. The new name is preferred because it matches what the dashboard
// actually calls it, which is where the value is copied from.
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
      "Copy .env.example to .env and fill them in from the Supabase " +
      "dashboard: Project Settings -> API.",
  );
}

// The SECRET key (sb_secret_... / service_role) must never appear here. It
// bypasses RLS entirely, and anything in this file ships inside the bundle.
export const supabase = createClient(url, publishableKey, {
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
