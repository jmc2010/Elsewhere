/**
 * Delete the calling user's account and everything attached to it.
 *
 * Apple expects in-app account deletion from any app that offers accounts,
 * and docs/privacy-data-flows.md currently promises deletion by email --
 * which is a weak answer if a reviewer probes it. This is the answer.
 *
 * It needs service_role, because a client holding only the publishable key
 * cannot delete an auth user, so it has to live server-side. That is the
 * whole reason this function exists; it has no other job.
 *
 * WHAT A SINGLE DELETE REMOVES. Verified against the live constraint graph
 * rather than assumed:
 *
 *   auth.users -> profiles                       CASCADE
 *   profiles   -> place_verdicts                 CASCADE
 *                 place_lockins                  CASCADE
 *                 place_corrections              CASCADE
 *                 place_impressions              CASCADE
 *                 household_members              CASCADE
 *   place_verdicts -> verdict_tags               CASCADE
 *   profiles   -> google_api_usage               SET NULL
 *
 * google_api_usage is deliberately SET NULL rather than cascaded: it is the
 * Google spend ledger, it is how cost-per-session is measured, and a deleted
 * account must not silently rewrite the billing history. The rows survive
 * with no user attached, which is anonymisation rather than retention.
 *
 * households.created_by and meals.created_by are RESTRICT, so a user who had
 * created either could not be deleted. Neither table has rows today; when
 * group features land, this function needs a story for handing those over
 * BEFORE it can succeed. Failing loudly here is correct -- silently
 * orphaning somebody's household would be worse.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY");
  if (!url || !anon || !serviceKey) {
    return json({ error: "Function environment is incomplete." }, 500);
  }

  // Identify the caller from THEIR token. The id to delete is never taken
  // from the request body -- a function that accepted one could be asked to
  // delete somebody else's account.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: "Not signed in." }, 401);

  const admin = createClient(url, serviceKey);
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    // Most likely cause once group features exist: a RESTRICT on something
    // they created. Say so rather than returning a bare 500.
    return json({ error: error.message }, 500);
  }

  return json({ deleted: true });
});
