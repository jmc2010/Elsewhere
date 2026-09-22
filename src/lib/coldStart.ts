import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "@/lib/supabase";

/**
 * Whether the cold-start recognition grid should be offered.
 *
 * Spec §8: shown once, on first launch, before the first shortlist.
 * Skippable, and never shown again either way -- re-asking somebody who
 * declined is how a one-screen onboarding becomes nagging.
 *
 * The two outcomes are stored differently, and deliberately:
 *
 *   COMPLETED -> the user has at least one verdict. Not a flag recording that
 *     they finished, but the thing the flag would have been standing in for.
 *     It survives a reinstall, which matters because the account is deferred
 *     but coming (§8): once it exists, a device-local flag is lost on
 *     reinstall and the app asks "which of these do you already know?" of
 *     somebody whose forty verdicts it is holding.
 *
 *   SKIPPED -> AsyncStorage, because a skip writes nothing to the server.
 *     There is no server-side trace of a decision not to answer, and
 *     inventing one -- a row meaning "declined" -- would be storing an
 *     absence as data.
 *
 * Both paths return TRUE on error. A storage or network failure must not trap
 * someone on the onboarding screen; failing toward the app is the safe
 * direction, and the cost of being wrong is one skipped screen.
 */
const SKIPPED_KEY = "elsewhere.coldStart.skipped.v1";

export async function hasSeenColdStart(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(SKIPPED_KEY)) !== null) return true;
  } catch {
    return true;
  }

  try {
    // RLS scopes place_verdicts to the caller, so this counts only their own.
    // head:true sends no rows back -- the count is the whole answer.
    const { count, error } = await supabase
      .from("place_verdicts")
      .select("place_id", { count: "exact", head: true });
    if (error) return true;
    return (count ?? 0) > 0;
  } catch {
    return true;
  }
}

/** Only for the skip path. Completing writes verdicts, which is the record. */
export async function markColdStartSkipped(): Promise<void> {
  try {
    await AsyncStorage.setItem(SKIPPED_KEY, new Date().toISOString());
  } catch {
    // Non-fatal: worst case it is offered once more next launch.
  }
}
