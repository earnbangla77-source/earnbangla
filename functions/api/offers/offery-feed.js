// functions/api/offers/offery-feed.js
// Cloudflare Pages Function — GET /api/offers/offery-feed
//
// Server-side proxy for Offery's Offers API (https://offery.io/api/).
// earn.html's frontend calls this instead of hitting offery.io directly,
// same reasons as cpagrip-feed.js:
//
//   1) Keeps OFFERY_API_KEY out of devtools / client-side JS.
//   2) The signed-in user's real id is looked up here from the session
//      cookie and swapped into each offer's click URL server-side, so it
//      can't be spoofed from devtools.
//
// Requires the caller to be signed in (same eb_session cookie as
// everything else) — returns 401 if not.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

// TODO: fill in once your Offery placement is approved
// (Offery dashboard → your app → API Documents / App Details).
const OFFERY_API_KEY ="8qb2kq6axoev42a70fz01b44chpx6q";

export async function onRequestGet(context) {
  const { request, env } = context;

  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }

  const feedUrl = `https://offery.io/api/?apikey=${encodeURIComponent(OFFERY_API_KEY)}`;

  try {
    const res = await fetch(feedUrl, {
      headers: {
        // Some offerwall feeds reject requests with no browser-like UA.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy",
      },
    });

    if (!res.ok) {
      console.error("offery-feed: upstream status", res.status);
      return errorJson("Offery feed request failed.", 502);
    }

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("offery-feed: non-JSON response:", raw.slice(0, 300));
      return errorJson("Offery returned an unexpected response.", 502);
    }

    const rows = Array.isArray(data.data) ? data.data : [];

    // Each row's `url` looks like:
    //   https://offery.io/click/xxxxx/1234/USER_ID
    // Swap the USER_ID placeholder for the signed-in user's real id here
    // (server-side), so it can't be spoofed from devtools.
    const offers = rows.map((row) => ({
      ...row,
      url: String(row.url || "").replace("USER_ID", encodeURIComponent(me.id)),
    }));

    // `raw` included so the frontend can console.log() the untouched
    // response while confirming field names — same pattern as cpagrip-feed.
    return json({ offers, raw: data });
  } catch (err) {
    console.error("offery-feed error:", err);
    return errorJson("Could not reach Offery.", 502);
  }
}
