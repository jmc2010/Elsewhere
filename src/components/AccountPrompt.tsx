import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { supabase } from "@/lib/supabase";
import { useTheme, type Theme } from "@/theme/tokens";
import { tabular, type } from "@/theme/type";

/**
 * The account offer (design spec §8).
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS MUST NOT BECOME
 * ----------------------------------------------------------------------------
 * A sign-up wall. §6 treats the frictionless first run as a competitive
 * position rather than an oversight: the funded competitor's cold start is a
 * Plaid connection, and asking for an account before the app has shown
 * anybody a restaurant trades our one structural advantage for a conversion
 * rate.
 *
 * So the rules are not stylistic:
 *   - First run never shows this. Location is the only thing ever asked for.
 *   - It appears only after `accountPromptAfterReviews` REAL reviews, at the
 *     moment it protects something that exists.
 *   - It is framed by what it SAVES, never by what it unlocks, because it
 *     unlocks nothing. Everything works identically for somebody who
 *     declines, forever.
 *   - It is shown at most once. "No thanks" is permanent and silent.
 *
 * ----------------------------------------------------------------------------
 * WHY A CODE AND NOT A LINK
 * ----------------------------------------------------------------------------
 * A magic link has to leave the app, open a browser and deep-link back,
 * which fails in in-app mail clients, on a second device, and behind link
 * scanners -- and when it fails it fails silently, which this project has
 * been bitten by twice (worklets, gesture-handler). A six-digit code typed
 * into the screen you are already looking at has the same privacy
 * properties, the same Apple 4.8 position (no third-party SDK, so no
 * obligation to offer Sign in with Apple), and none of the round trip.
 *
 * ----------------------------------------------------------------------------
 * THE CONVERSION PRESERVES auth.uid()
 * ----------------------------------------------------------------------------
 * updateUser({email}) then verifyOtp({type:'email_change'}) attaches an
 * identity to the EXISTING anonymous user rather than creating a new one.
 * Verified on local with a real anonymous account carrying a verdict and a
 * lock-in: same uid before and after, rows still readable through RLS. That
 * property is the only reason any of this is safe to do after the fact.
 */

export interface AccountPromptProps {
  /** Real count of what they have told the app. Never rounded, never faked. */
  things: number;
  onConverted: () => void;
  onDecline: () => void;
}

type Stage = "offer" | "code";

export function AccountPrompt({ things, onConverted, onDecline }: AccountPromptProps) {
  const theme = useTheme();
  const s = styles(theme);
  const insets = useSafeAreaInsets();

  const [stage, setStage] = useState<Stage>("offer");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const addr = email.trim();
    if (!addr.includes("@")) {
      setError("That doesn't look like an email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.updateUser({ email: addr });
      if (e) throw e;
      setStage("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't send. Try again?");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const { error: e } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email_change",
      });
      if (e) throw e;
      onConverted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.screen, { paddingTop: insets.top + theme.space.xxl }]}>
      {stage === "offer" ? (
        <>
          {/* §8's framing, with the real number. Not "create an account" --
              that describes the mechanism, and the mechanism is not the
              reason. */}
          <Text style={s.head}>
            You&apos;ve told Elsewhere{" "}
            <Text style={tabular}>{things}</Text>{" "}
            {things === 1 ? "thing" : "things"} about how you eat.
          </Text>
          <Text style={s.body}>
            All of it lives on this phone. If you lose it or replace it,
            it&apos;s gone — there&apos;s no way for me to find it again.
          </Text>
          <Text style={s.body}>
            An email address fixes that. It changes nothing else: no password,
            no profile, nothing new to check, and nothing here works
            differently either way.
          </Text>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.colours.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            style={s.input}
            accessibilityLabel="Your email address"
          />
        </>
      ) : (
        <>
          <Text style={s.head}>Check your email.</Text>
          <Text style={s.body}>
            I sent a six-digit code to {email.trim()}. It&apos;s good for an
            hour.
          </Text>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="000000"
            placeholderTextColor={theme.colours.inkFaint}
            keyboardType="number-pad"
            maxLength={6}
            textContentType="oneTimeCode"
            style={[s.input, s.codeInput, tabular]}
            accessibilityLabel="The six-digit code from your email"
          />
        </>
      )}

      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={[s.acts, { paddingBottom: insets.bottom + theme.space.lg }]}>
        <Pressable
          onPress={() => void (stage === "offer" ? send() : verify())}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [s.primary, pressed && s.pressed]}
        >
          <Text style={s.primaryLabel}>
            {busy ? "…" : stage === "offer" ? "Send me a code" : "That's it"}
          </Text>
        </Pressable>

        {/* The decline. Plain words, no guilt, no "are you sure". It is a
            real option and the app genuinely does not care. */}
        <Pressable onPress={onDecline} accessibilityRole="button" hitSlop={12}>
          <Text style={s.quiet}>
            {stage === "offer" ? "No thanks" : "Not now"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = (t: Theme) => build(t);
const build = ({ colours: c, space, radius, hairline }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.ground, paddingHorizontal: 22 },
    head: { ...type.screenHead, color: c.ink, marginBottom: space.lg },
    body: { ...type.body, color: c.inkMuted, marginBottom: space.md },
    input: {
      ...type.body, color: c.ink,
      borderWidth: hairline, borderColor: c.ruleStrong, borderRadius: 12,
      paddingVertical: 13, paddingHorizontal: 14, marginTop: space.lg,
    },
    codeInput: { ...type.pick, textAlign: "center", letterSpacing: 6 },
    error: { ...type.reason, color: c.ink, marginTop: space.md },
    acts: { marginTop: "auto", rowGap: space.lg, alignItems: "center" },
    primary: {
      alignSelf: "stretch", alignItems: "center",
      backgroundColor: c.brass, borderRadius: radius.button, paddingVertical: 15,
    },
    pressed: { opacity: 0.7 },
    primaryLabel: { ...type.button, color: c.brassInk },
    quiet: { ...type.meta, color: c.inkMuted },
  });
