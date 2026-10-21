import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Whether the account offer has already been made.
 *
 * ONE key, and it records only that the proactive ask has happened -- not
 * what was answered. §8's ruling is that declining is permanent and
 * invisible: "no nag, no badge, no second ask, no feature held back". A flag
 * that distinguished "declined" from "dismissed" would exist in order to ask
 * again, so it is not kept.
 *
 * The offer stays permanently available in the shelf, which is what makes
 * one-and-done fair: nothing is withheld from somebody who said no, and
 * changing their mind never requires being asked twice.
 *
 * ON DEVICE, DELIBERATELY. The irony is noted -- this flag lives in the same
 * AsyncStorage whose loss the account exists to protect against, so wiping
 * the phone re-asks somebody who already declined. Ruled acceptable: a wipe
 * has already destroyed their ledger, so they are starting over regardless,
 * and the alternative is storing "this person refused to be stored" on the
 * server about somebody who just asked for nothing to be kept.
 */
const ASKED_KEY = "elsewhere.account.asked.v1";

export async function hasBeenAskedAboutAccount(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) !== null;
  } catch {
    // Fail toward NOT asking. An unreadable flag must never become a second
    // prompt for somebody who already said no.
    return true;
  }
}

export async function markAskedAboutAccount(): Promise<void> {
  try {
    await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString());
  } catch {
    // Non-fatal, and it fails in the forgiving direction: worst case the
    // offer appears once more. Unpleasant, not harmful.
  }
}
