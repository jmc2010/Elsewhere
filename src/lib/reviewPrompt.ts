import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { tuning } from "@/config/tuning";

/**
 * The review prompt, as a LOCAL notification (design spec §4, §13).
 *
 * Why this exists at all: review capture only ever fired as an interstitial
 * on the next cold open, and after dinner the next cold open is tomorrow or
 * never. Measured on the only real account: 6 verdicts, every one of them
 * `known` from the recognition grid. Nothing had ever asked at a moment worth
 * answering, so the moat the whole product rests on was collecting nothing.
 *
 * LOCAL, not a server push. No backend, no token registration, no device
 * table, and it works with the phone offline. The trigger is a timestamp we
 * already know at lock-in, so there is nothing a server could add except
 * infrastructure and a privacy surface.
 *
 * PERMISSION IS ASKED ONCE, EVER. If it is declined the app falls back to the
 * interstitial and never asks again — §6 keeps location as the only
 * permission this product insists on, and a second prompt for a nicety is how
 * an app teaches people to say no to everything.
 */

const ASKED_KEY = "elsewhere.notifications.asked.v1";
const SCHEDULED_PREFIX = "elsewhere.reviewPrompt.";

/**
 * Foreground behaviour: show it. The user is in the app but may be elsewhere
 * in it.
 *
 * Called lazily, NOT at module scope, and guarded. This used to run on import
 * -- and `reviewPrompt` is imported by the home route, so it executed before
 * anything rendered. A throw there kills the app at launch with no error
 * boundary mounted and no way to see why: the screen a user gets is a crash,
 * and the only diagnostic is a device log.
 *
 * Nothing about scheduling a reminder is worth that risk. Anything that can
 * throw belongs behind a function somebody chose to call.
 */
let handlerReady = false;

function ensureHandler(): void {
  if (handlerReady) return;
  handlerReady = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // A notification is a nicety. It must never be able to break the app.
  }
}

/**
 * Ask once, remember the answer forever.
 *
 * Returns whether we may schedule. Never throws: a notification is a nicety,
 * and it must not be able to break a lock-in, which is the thing the user
 * actually did.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;

    // Already asked and refused. Do not ask again.
    if ((await AsyncStorage.getItem(ASKED_KEY)) !== null) return false;
    await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString());

    if (!current.canAskAgain) return false;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * Schedule "How was <name>?" for lock-in + the prompt delay.
 *
 * The notification carries the lock-in id, so tapping it can open review
 * capture for THAT place rather than dropping the user on the shortlist to
 * work out why their phone buzzed.
 */
export async function scheduleReviewPrompt(
  lockinId: string,
  placeId: string,
  displayName: string,
): Promise<void> {
  try {
    ensureHandler();
    if (!(await ensureNotificationPermission())) return;

    if (Platform.OS === "android") {
      // Android will not deliver anything without a channel.
      await Notifications.setNotificationChannelAsync("review", {
        name: "How was it?",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: null,
      });
    }

    const when = new Date(Date.now() + tuning.recency.reviewPromptHours * 60 * 60 * 1000);

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        // §10's string, verbatim. It is a question, not an announcement --
        // the answer takes one tap and the notification says so by asking.
        title: `How was ${displayName}?`,
        body: "Two taps and I'll stop sending you there.",
        data: { lockinId, placeId },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: when,
        channelId: "review",
      },
    });

    // Remember it so it can be cancelled if the review is answered early.
    await AsyncStorage.setItem(SCHEDULED_PREFIX + lockinId, id);
  } catch {
    // Silent, deliberately. The lock-in has already been written; failing to
    // schedule a reminder is not worth interrupting somebody who has just
    // decided where they are going.
  }
}

/**
 * Cancel a pending prompt because the review already happened.
 *
 * Without this, answering the interstitial in the morning still buzzes the
 * phone that evening asking about a meal already reviewed -- which reads as
 * the app not listening.
 */
export async function cancelReviewPrompt(lockinId: string): Promise<void> {
  try {
    const key = SCHEDULED_PREFIX + lockinId;
    const id = await AsyncStorage.getItem(key);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(key);
    }
  } catch {
    // Non-fatal.
  }
}

/** The lock-in a notification tap is asking about, if the app was opened that way. */
export async function lockinFromNotificationTap(): Promise<string | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    const data = response?.notification.request.content.data as
      | { lockinId?: string }
      | undefined;
    return data?.lockinId ?? null;
  } catch {
    return null;
  }
}

export { Notifications };
