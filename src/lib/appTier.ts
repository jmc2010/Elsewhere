/**
 * Which build this is: development, preview or production.
 *
 * Comes from EXPO_PUBLIC_APP_TIER, set per EAS environment. It is sent with
 * every places-proxy call and used for exactly one thing: capping the daily
 * Google quota lower for non-production builds, so leaving a simulator open
 * cannot eat a real budget.
 *
 * It is UNAUTHENTICATED and that is deliberate. The tier can only lower the
 * cap, never raise it -- claiming "production" yields the same default an
 * absent marker would -- so there is nothing to gain by forging it and no
 * need to prove it.
 *
 * All three builds share ONE cloud database. Data isolation comes free from
 * the package ids differing: different package id, different anonymous
 * session, different user, different rows. Spend isolation does not come
 * free, because spend is charged to Google rather than to a row. Hence this.
 *
 * Defaults to `development` when unset, which is the safest wrong answer:
 * an unlabelled build gets the SMALL cap rather than the large one.
 */
export type AppTier = "development" | "preview" | "production";

export const appTier: AppTier = (() => {
  const raw = process.env.EXPO_PUBLIC_APP_TIER;
  return raw === "production" || raw === "preview" || raw === "development"
    ? raw
    : "development";
})();
