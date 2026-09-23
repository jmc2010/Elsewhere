// places-proxy — the ONLY path to Google.
//
// Holds the API key, enforces the per-user daily quota, batches shortlist
// hydration, and returns Google-derived values in an envelope that has no
// database writer (CLAUDE.md, spec §8).
//
// THE RULE THIS FILE EXISTS TO ENFORCE
//
// Google Places content must never be written to the database. Only two
// things from a Places response may be persisted, and each has exactly one
// writer, both of them database functions that take no other Google field:
//
//   google_place_id_record()        place_id, indefinitely
//   google_business_status_record() a derived boolean, NOT the status string
//
// Everything else — rating, userRatingCount, priceLevel, hours, reviews,
// editorialSummary, the serves*/goodFor* attributes — lives only in the
// `live` object below, which is serialised to the HTTP response and dropped.
// If you find yourself passing a field from `LiveFields` into any supabase
// call, stop: that is the legal violation the whole architecture exists to
// prevent, and scripts/check-no-google-persistence.py will fail the build.

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SEARCH_TEXT = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS = "https://places.googleapis.com/v1/places";

// The field mask selects the billing SKU. Adding a field here changes what
// every call costs — see docs/measurements.md before touching it.
//
// Shortlist hydration deliberately does NOT request the Atmosphere set. At a
// shortlist of 25 that is the difference between Enterprise ($20/1k) and
// Enterprise+Atmosphere ($25/1k) on every card the user never opens.
//
// NOTE THE PREFIXING, which differs by endpoint and is not interchangeable:
//
//   searchText     returns {"places": [...]}, so fields are "places.rating"
//   Place Details  returns a single Place, so fields are plain "rating"
//
// Getting it wrong produces a 400 from Google that reads like a permissions
// or key problem. This mask goes to Place Details, so it is unprefixed.
const MASK_SHORTLIST = [
  "id", "displayName", "location", "rating", "userRatingCount", "priceLevel",
  "regularOpeningHours", "businessStatus", "websiteUri",
].join(",");

// Detail view: one place, opened deliberately, so Atmosphere is justified.
const MASK_DETAIL = [
  "id", "displayName", "location", "rating", "userRatingCount", "priceLevel",
  "regularOpeningHours", "businessStatus", "websiteUri", "reviews",
  "editorialSummary", "servesVegetarianFood", "outdoorSeating",
  "goodForGroups", "goodForChildren", "reservable", "takeout", "delivery",
  "servesCocktails",
].join(",");

// Resolution goes to searchText, so these ARE prefixed. Only what the match
// decision needs, never more -- the mask selects the billing SKU.
const MASK_RESOLVE = "places.id,places.displayName,places.location";

// --- Resolution validation --------------------------------------------------
//
// Measured, not guessed. locationBias is advisory: a 2km bias circle returned
// a result 60km outside it, and five chains matched at the wrong branch with
// a name similarity of 1.00. locationRestriction was tried and is worse — it
// lost four correct matches and still needed this check anyway.
//
// So: bias for recall, and validate the coordinates ourselves. A rejected
// resolution is a no_result, which is recoverable. A wrong place_id is stored
// permanently, served to every user forever, and silent.
//
// See docs/measurements.md.
const BIAS_RADIUS_M = 2000;
const SAME_BUILDING_M = 30;   // coordinates alone settle it
const MAX_DISTANCE_M = 250;
const MIN_NAME_SIMILARITY = 0.55;

// A failed resolution is retried after this long, not never. Coordinates
// improve between Overture releases, and a place absent from Google today may
// be listed next month. Long enough that a genuine absence is not re-paid for
// on every hydration; short enough that a monthly reingest gets a fresh look.
const RESOLUTION_RETRY_DAYS = 30;

const NAME_NOISE = new Set([
  "the", "a", "of", "and", "restaurant", "cafe", "bar", "grill", "co", "inc",
  "llc", "shop", "kitchen",
]);

function nameTokens(s: string): Set<string> {
  const words = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter(Boolean);
  const kept = words.filter((w) => !NAME_NOISE.has(w));
  return new Set(kept.length ? kept : words);
}

function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function haversineM(
  lat1: number, lon1: number, lat2: number, lon2: number,
): number {
  const R = 6371000, rad = Math.PI / 180;
  const dp = (lat2 - lat1) * rad, dl = (lon2 - lon1) * rad;
  const a = Math.sin(dp / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * The whole point: reject rather than guess.
 *
 * `colocated` is how many OTHER catalog places sit within 30m. It decides
 * whether proximity alone is enough, and it is not a detail:
 *
 * The same-building pass exists because at a few metres there is no other
 * building, so a name disagreement means the two sources name one shop
 * differently -- "Bayer's Kolonialwaren" and "Bayers Bakery" in Muenster.
 * That reasoning collapses when the address holds more than one business,
 * which in North Texas is 58% of the catalog.
 *
 * Rider's Smokehouse in Valley View closed years ago; its successor
 * Middlebrooks Bar & Grill is 8m away and still trading. Without this check,
 * resolving Rider's would accept Middlebrooks and bind a defunct restaurant
 * to a live one's place_id permanently -- every hydration forever showing
 * Middlebrooks' rating and hours under Rider's name.
 */
function acceptsResolution(
  catalogName: string, catalogLat: number, catalogLon: number,
  googleName: string, googleLat: number, googleLon: number,
  colocated: number,
): boolean {
  const d = haversineM(catalogLat, catalogLon, googleLat, googleLon);
  const nameAgrees = nameSimilarity(catalogName, googleName) >= MIN_NAME_SIMILARITY;
  // Proximity alone settles it ONLY where nothing else shares the address.
  if (d <= SAME_BUILDING_M && colocated === 0) return true;
  if (d > MAX_DISTANCE_M) return false;
  return nameAgrees;
}

// --- Types ------------------------------------------------------------------

interface CatalogPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Used to make the Text Search query specific; see resolvePlaceId. */
  locality: string | null;
  region: string | null;
  google_place_id: string | null;
  google_resolution_failed: boolean;
  google_resolution_attempted_at: string | null;
  /** Other catalog places within 30m; 0 means the address is unshared. */
  colocated_count: number;
}

/** A previously-failed place becomes eligible again after the retry window. */
function dueForRetry(p: CatalogPlace): boolean {
  if (!p.google_resolution_failed) return false;
  if (!p.google_resolution_attempted_at) return true;
  const age = Date.now() - Date.parse(p.google_resolution_attempted_at);
  return age > RESOLUTION_RETRY_DAYS * 86_400_000;
}

/**
 * Google-derived values. REQUEST-SCOPED ONLY.
 *
 * Typed distinctly from anything with a database writer, deliberately. There
 * is no function anywhere in this project that accepts a LiveFields and
 * persists it, and adding one would be a legal violation, not a design
 * choice. See CLAUDE.md.
 */
interface LiveFields {
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  regularOpeningHours?: unknown;
  businessStatus?: string;
  websiteUri?: string;
  reviews?: unknown[];
  editorialSummary?: unknown;
  [attribute: string]: unknown;
}

type LiveStatus = "ok" | "unresolved" | "quota_exceeded" | "error";

/** Mirrors google_quota_reserve()'s RETURNS TABLE. */
interface QuotaGrant {
  granted: number;
  used_today: number;
  daily_limit: number;
}

// --- Google calls -----------------------------------------------------------

async function resolvePlaceId(
  key: string, place: CatalogPlace,
): Promise<string | null> {
  // Name ALONE is not enough, and this cost a live debugging round.
  //
  // locationBias is advisory (see above), so a bare "Dairy Queen" lets Google
  // return whichever branch it prefers; the distance check then rejects it and
  // the place comes back unresolved. Valley View's Dairy Queen failed exactly
  // this way while the identical place resolved at 11m from the spike, which
  // had always included locality.
  //
  // The 73% in docs/measurements.md was measured WITH locality. Any change
  // here invalidates that number.
  const locality = [place.locality, place.region].filter(Boolean).join(", ");
  const body = {
    textQuery: locality ? `${place.name}, ${locality}` : place.name,
    maxResultCount: 1,
    // locationBias, NOT locationRestriction. See the note above.
    locationBias: {
      circle: {
        center: { latitude: place.lat, longitude: place.lon },
        radius: BIAS_RADIUS_M,
      },
    },
  };
  const res = await fetch(SEARCH_TEXT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": MASK_RESOLVE,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`searchText ${res.status}: ${await res.text()}`);
  const hit = (await res.json())?.places?.[0];
  if (!hit?.id || !hit?.location) return null;

  const ok = acceptsResolution(
    place.name, place.lat, place.lon,
    hit.displayName?.text ?? "", hit.location.latitude, hit.location.longitude,
    place.colocated_count,
  );
  return ok ? hit.id : null;
}

async function placeDetails(
  key: string, googlePlaceId: string, mask: string,
): Promise<LiveFields> {
  const res = await fetch(`${PLACE_DETAILS}/${googlePlaceId}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": mask },
  });
  if (!res.ok) {
    throw new Error(
      `details ${res.status} for ${googlePlaceId} (mask="${mask}"): ` +
        `${await res.text()}`,
    );
  }
  return await res.json() as LiveFields;
}

// --- Handler ----------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("GOOGLE_MAPS_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  // Supabase injects the service role key under either name depending on
  // project age: the newer secret-key naming, or the original.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY");

  // Name what is missing. "server misconfigured" is true and useless, and
  // the caller cannot see the function environment to work it out.
  const missing = [
    !key && "GOOGLE_MAPS_API_KEY (set it: supabase secrets set ...)",
    !url && "SUPABASE_URL (normally injected by the platform)",
    !serviceKey &&
    "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY (normally injected)",
  ].filter(Boolean);
  // Written as an explicit triple test rather than `missing.length > 0` so
  // TypeScript narrows all three to string for the rest of the handler.
  if (!key || !url || !serviceKey) {
    return json({
      error: "server misconfigured: missing " + missing.join("; "),
      hint: "supabase secrets list shows what is set; platform-injected " +
        "variables do not appear there.",
    }, 500);
  }

  // Identify the caller. The quota is per user, so an unauthenticated request
  // has nothing to charge and is refused rather than served for free.
  const authHeader = req.headers.get("Authorization") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "authentication required" }, 401);

  let payload: {
    action?: string;
    place_ids?: string[];
    session_id?: string;
    /**
     * Which build is calling: development, preview or production.
     *
     * Advisory and unauthenticated ON PURPOSE. The tier can only LOWER the
     * caller's daily quota, never raise it, so forging it gains nothing --
     * claiming "production" yields the same 60 an absent marker would. That
     * property is what makes it safe to take a client's word for.
     */
    app_tier?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const action = payload.action ?? "hydrate";
  const ids = payload.place_ids ?? [];
  const sessionId = payload.session_id ?? null;
  const appTier = payload.app_tier ?? null;

  if (action !== "hydrate" && action !== "detail") {
    return json({ error: `unknown action ${action}` }, 400);
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return json({ error: "place_ids required" }, 400);
  }
  // The shortlist-of-25 IS the cost ceiling per session (spec §5.1). A client
  // asking for more is a bug or an attack; either way it does not get served.
  const MAX_BATCH = action === "detail" ? 1 : 25;
  if (ids.length > MAX_BATCH) {
    return json(
      { error: `at most ${MAX_BATCH} place_ids for action=${action}` },
      400,
    );
  }

  const db: SupabaseClient = createClient(url, serviceKey);

  const { data: rows, error: rowsErr } = await db
    .from("places")
    // Must stay one string literal: supabase-js infers the row type from the
    // column list statically, and a concatenated expression degrades it to
    // GenericStringError.
    .select("id, name, locality, region, google_place_id, google_resolution_failed, google_resolution_attempted_at, colocated_count")
    .in("id", ids)
    .eq("permanently_closed", false);
  if (rowsErr) return json({ error: rowsErr.message }, 500);

  // Coordinates come from a view/RPC rather than the geography column, which
  // does not serialise usefully through PostgREST.
  const { data: coords, error: coordErr } = await db
    .rpc("places_coords", { p_ids: ids });
  if (coordErr) return json({ error: coordErr.message }, 500);
  const coordById = new Map<string, { lat: number; lon: number }>(
    (coords ?? []).map((c: { id: string; lat: number; lon: number }) =>
      [c.id, { lat: c.lat, lon: c.lon }]
    ),
  );

  const places: CatalogPlace[] = (rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    locality: r.locality,
    region: r.region,
    lat: coordById.get(r.id)?.lat ?? 0,
    lon: coordById.get(r.id)?.lon ?? 0,
    google_place_id: r.google_place_id,
    google_resolution_failed: r.google_resolution_failed,
    google_resolution_attempted_at: r.google_resolution_attempted_at,
    colocated_count: r.colocated_count ?? 0,
  }));

  // Budget the batch BEFORE spending any of it. A place needing resolution
  // costs two calls (searchText + details); an already-resolved one costs one.
  const needsResolution = places.filter((p) =>
    !p.google_place_id && (!p.google_resolution_failed || dueForRetry(p))
  );
  // A place that will short-circuit as `unresolved` makes no Google call, so
  // it must not be budgeted for one. Counting it charged the user for work
  // that never happened.
  const willCall = places.filter((p) =>
    p.google_place_id || !p.google_resolution_failed || dueForRetry(p)
  );
  const requested = willCall.length + needsResolution.length;

  // Attribute per call, by what is actually invoked. A batch is not one kind
  // of call: a place needing resolution costs a searchText AND a details
  // call, and searchText is Text Search -- a different SKU family from Place
  // Details entirely, not merely a different tier of it.
  //
  // The MASK selects the tier, which is why these names are what they are:
  //   MASK_RESOLVE asks for displayName and location, both Pro-tier fields
  //     for Text Search (id/name/attributions alone would be Essentials).
  //   MASK_SHORTLIST adds rating, priceLevel and hours -> Enterprise.
  //   MASK_DETAIL adds reviews and the serves*/goodFor* attributes
  //     -> Enterprise + Atmosphere.
  const detailSku = action === "detail"
    ? "places.details.enterprise_atmosphere"
    : "places.details.enterprise";

  const breakdown: Record<string, number> = {};
  if (needsResolution.length > 0) {
    breakdown["places.searchText.pro"] = needsResolution.length;
  }
  if (willCall.length > 0) {
    breakdown[detailSku] = willCall.length;
  }

  // Record the tier before reserving, so the reservation sees it on the very
  // first call from a new build rather than from the second onward.
  if (appTier) {
    await db.rpc("note_app_tier", { p_user: user.id, p_tier: appTier });
  }

  const { data: quotaRow, error: quotaErr } = await db
    .rpc("google_quota_reserve", {
      p_user: user.id,
      p_breakdown: breakdown,
      p_session: sessionId,
    })
    .single();
  if (quotaErr) return json({ error: quotaErr.message }, 500);
  const quota = quotaRow as QuotaGrant | null;

  // Fail closed. If the quota row is missing we have no idea what has been
  // spent, and guessing in the generous direction is how a bill happens.
  const granted: number = quota?.granted ?? 0;
  const mask = action === "detail" ? MASK_DETAIL : MASK_SHORTLIST;

  // Spend the grant in shortlist order, so a partial grant hydrates the cards
  // the user sees first rather than a random subset.
  let budget = granted;
  const results = await Promise.all(places.map(async (p) => {
    const base = { place_id: p.id, name: p.name };
    const retry = dueForRetry(p);
    if (!p.google_place_id && p.google_resolution_failed && !retry) {
      // Known unresolvable and not yet due another look. Costs nothing.
      return { ...base, live: null, live_status: "unresolved" as LiveStatus };
    }
    const cost = (!p.google_place_id && (!p.google_resolution_failed || retry))
      ? 2
      : 1;
    if (budget < cost) {
      return { ...base, live: null, live_status: "quota_exceeded" as LiveStatus };
    }
    budget -= cost;

    try {
      let gid = p.google_place_id;
      if (!gid) {
        gid = await resolvePlaceId(key, p);
        // place_id is one of exactly two Google values we may persist, and
        // this is its only writer.
        await db.rpc("google_place_id_record", {
          p_place: p.id, p_place_id: gid, p_failed: gid === null,
        });
        if (!gid) {
          return { ...base, live: null, live_status: "unresolved" as LiveStatus };
        }
      }

      const live = await placeDetails(key, gid, mask);

      // The other permitted write: a derived boolean, never the status string.
      // Suppressing a dead row also stops us paying to hydrate it again.
      if (live.businessStatus === "CLOSED_PERMANENTLY") {
        await db.rpc("google_business_status_record", {
          p_place: p.id, p_permanently_closed: true,
        });
      }

      return { ...base, live, live_status: "ok" as LiveStatus };
    } catch (e) {
      console.error(`hydrate ${p.id}: ${e instanceof Error ? e.message : e}`);
      return { ...base, live: null, live_status: "error" as LiveStatus };
    }
  }));

  return json({
    session_id: sessionId,
    quota: {
      granted,
      used_today: quota?.used_today ?? null,
      daily_limit: quota?.daily_limit ?? null,
      // The client renders catalog-only for anything not hydrated. Degraded
      // is a normal mode, not an error (spec §5).
      degraded: granted < requested,
    },
    places: results,
    attribution: "Powered by Google",
  });
});
