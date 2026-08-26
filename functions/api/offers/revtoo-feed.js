// functions/api/offers/revtoo-feed.js
// Cloudflare Pages Function — GET /api/offers/revtoo-feed
//
// Server-side proxy for Revtoo's Offers API (docs.revtoo.com/api/offers).
// earn.html's frontend calls this instead of hitting revtoo.com directly,
// same reasons as cpagrip-feed.js / offery-feed.js:
//
//   1) Keeps REVTOO_API_KEY out of devtools / client-side JS.
//   2) The signed-in user's real id is looked up here from the session
//      cookie and sent to Revtoo as `user_id` server-side, so it can't be
//      spoofed from devtools — Revtoo embeds it into each offer's redirect
//      URL for us.
//
// Requires the caller to be signed in (same eb_session cookie as
// everything else) — returns 401 if not.
//
// ⚠️ Response shape is DIFFERENT from CPAGrip/Offery: Revtoo returns offers
// directly as a flat top-level `offers` array (not nested under
// `data.data`), and each offer's `reward` is already converted using the
// Currency Name / Exchange Rate on the placement (Points / 1000.00) — keep
// those in sync with functions/api/offers/revtoo-postback.js.
//
// ⚠️ Some offers (mostly surveys) have a VARIABLE payout — Revtoo sends the
// literal string "*" instead of a number for both `payout` and `reward` on
// those. normalizeRevtooOffer()-equivalent logic below turns that into
// `coins: null` so the frontend can render "Varies" instead of a fake 0.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

const REVTOO_API_KEY = "8euee083znhqu99d3y17gzed8fqxc8";

export async function onRequestGet(context) {
  const { request, env } = context;

  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }

  const feedUrl = `https://revtoo.com/api/offers/?api_key=${encodeURIComponent(REVTOO_API_KEY)}&user_id=${encodeURIComponent(me.id)}`;

  try {
    const res = await fetch(feedUrl, {
      headers: {
        // Some offerwall feeds reject requests with no browser-like UA.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy",
      },
    });

    if (!res.ok) {
      console.error("revtoo-feed: upstream status", res.status);
      return errorJson("Revtoo feed request failed.", 502);
    }

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("revtoo-feed: non-JSON response:", raw.slice(0, 300));
      return errorJson("Revtoo returned an unexpected response.", 502);
    }

    if (data.success === false) {
      // e.g. status 100 (missing key) / 101 (invalid key) / 102 (rate
      // limited) / 103 (pagination) / 105 (bad country codes) — see
      // docs.revtoo.com/api/offers
      console.error("revtoo-feed: API error", data.status, data.message);
      return errorJson(data.message || "Revtoo API error.", 502);
    }

    const rows = Array.isArray(data.offers) ? data.offers : [];

    // Revtoo already embeds the real user_id we sent above into each
    // offer's `url` — this is just a defensive fallback in case a bracket
    // placeholder ever slips through unsubstituted.
    const offers = rows.map((row) => ({
      ...row,
      url: String(row.url || "").replace(/\[?USER_ID\]?/g, encodeURIComponent(me.id)),
    }));

    // `raw` included so the frontend can console.log() the untouched
    // response while confirming field names — same pattern as
    // cpagrip-feed/offery-feed.
    return json({ offers, raw: data });
  } catch (err) {
    console.error("revtoo-feed error:", err);
    return errorJson("Could not reach Revtoo.", 502);
  }
}
