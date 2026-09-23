import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { appTier } from "@/lib/appTier";
import { useTheme } from "@/theme/tokens";
import { type } from "@/theme/type";

/**
 * Which build this is, and WHICH DATABASE it is actually talking to.
 *
 * Never shown in production.
 *
 * The reason it exists: "development" means two different databases depending
 * on how the app was started. `expo start` reads `.env`, which points at a
 * local Supabase. `eas build --profile development` reads the EAS
 * environment, which points at cloud. Both are correct, and both are called
 * development -- which is exactly the kind of ambiguity that costs an hour
 * three months later when data is "missing" and nothing is wrong except which
 * database you are looking at.
 *
 * So it shows the HOST, not a label. "cloud" and "local" are things somebody
 * decided to call an environment; `oygsbuailwpjgkqbxllp.supabase.co` and
 * `192.168.1.230:54321` are facts. The whole point is to answer "why is my
 * data not there?" by looking at the screen rather than by reasoning about
 * config.
 */
export function EnvironmentBadge() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Compiled out of production entirely -- this returns before any hook that
  // would cost anything, and the string never ships anywhere a user sees.
  if (appTier === "production") return null;

  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  let host = "NO DATABASE URL";
  try {
    const u = new URL(raw);
    host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    // An unparseable URL is itself worth seeing: it is the shape of the bug
    // that crashed every TestFlight build when the environment was empty.
    host = raw || "NO DATABASE URL";
  }

  // A local host is the interesting case, so say so as well as showing it.
  const isLocal =
    /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);

  const s = styles(theme.colours.surface2, theme.colours.brass, theme.colours.inkMuted);

  return (
    <View
      style={[s.wrap, { top: insets.top + 2 }]}
      pointerEvents="none"
      accessibilityLabel={`${appTier} build, database ${host}`}
    >
      <Text style={s.text} numberOfLines={1}>
        {appTier.toUpperCase()} · {isLocal ? "LOCAL " : ""}{host}
      </Text>
    </View>
  );
}

const styles = (bg: string, fg: string, muted: string) =>
  StyleSheet.create({
    wrap: {
      position: "absolute",
      alignSelf: "center",
      zIndex: 999,
      maxWidth: "92%",
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: bg,
      opacity: 0.92,
    },
    text: { ...type.tileMeta, color: fg, letterSpacing: 0.3 },
  });
