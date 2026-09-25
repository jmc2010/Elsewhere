import AsyncStorage from "@react-native-async-storage/async-storage";

import { tuning } from "@/config/tuning";

/**
 * How far the user last chose to look, persisted per device.
 *
 * This exists because the radius was previously state and nothing else: it
 * reset to the default on every cold open, so any adjustment survived exactly
 * one session. That is fine for a control nobody can reach -- and until
 * 2026-09-24 nobody could, because the "How far" group only rendered in dense
 * areas. Making it reachable makes forgetting it a bug: being asked the same
 * question every morning is worse than not being asked.
 *
 * Stored per device rather than on the profile, for the same reason as the
 * theme: it is a property of how you are using the app right now, and it is
 * not worth a round trip before the first query can run.
 *
 * VALIDATED, NOT CLAMPED. A stored value that is no longer one of
 * `radiusChoices` is discarded in favour of the default. Clamping would be
 * worse: a build on 2026-09-24 briefly offered 25, and clamping that to the
 * 15 ceiling would silently hold someone at a radius they never chose, with no
 * pill to tell them so. Falling back to the default is visible and correct.
 */
const KEY = "elsewhere.radius.v1";

export async function loadRadiusPreference(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return tuning.catalog.radiusMiles;
    const miles = Number(raw);
    // Number("") is 0 and Number("abc") is NaN; the membership test rejects
    // both without needing to special-case them.
    return (tuning.catalog.radiusChoices as readonly number[]).includes(miles)
      ? miles
      : tuning.catalog.radiusMiles;
  } catch {
    // A read failure must not strand somebody at an unexpected radius.
    return tuning.catalog.radiusMiles;
  }
}

export async function saveRadiusPreference(miles: number): Promise<void> {
  try {
    if (miles === tuning.catalog.radiusMiles) await AsyncStorage.removeItem(KEY);
    else await AsyncStorage.setItem(KEY, String(miles));
  } catch {
    // Non-fatal: it reverts to the default next launch.
  }
}
