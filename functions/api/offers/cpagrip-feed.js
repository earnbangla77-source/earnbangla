// functions/api/offers/cpagrip-feed.js
// Cloudflare Pages Function — GET /api/offers/cpagrip-feed
//
// Server-side proxy for CPAGrip's JSON Offer Feed
// (https://www.cpagrip.com/common/offer_feed_json.php). earn.html's
// frontend calls this instead of hitting cpagrip.com directly because:
//
//   1) CPAGrip's feed endpoint may not send CORS headers — a direct browser
//      fetch from earnbangla.pages.dev could be silently blocked.
//   2) The signed-in user's real id is looked up here from the session
//      cookie and used as tracking_id, so it can't be spoofed from
//      devtools by editing a client-side value.
//
// Requires the caller to be signed in (same eb_session cookie as
// everything else) — returns 401 if not.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

const CPAGRIP_USER_ID = "2549531";
const CPAGRIP_PUBKEY = "ea0cba2918d5147f28df6c3b2c342e55";

export async function onRequestGet(context) {
  const { request, env } = context;

  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }

  const feedUrl =
    `https://www.cpagrip.com/common/offer_feed_json.php` +
    `?user_id=${CPAGRIP_USER_ID}` +
    `&pubkey=${CPAGRIP_PUBKEY}` +
    `&tracking_id=${encodeURIComponent(me.id)}`;

  try {
    const res = await fetch(feedUrl, {
      headers: {
        // Some CPA network feeds reject requests with no browser-like UA.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy",
      },
    });

    if (!res.ok) {
      console.error("cpagrip-feed: upstream status", res.status);
      return errorJson("CPAGrip feed request failed.", 502);
    }

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // CPAGrip occasionally returns HTML (rate-limit / error page) instead
      // of JSON. Log the start of it so a real failure is diagnosable from
      // Cloudflare's function logs.
      console.error("cpagrip-feed: non-JSON response:", raw.slice(0, 300));
      return errorJson("CPAGrip returned an unexpected response.", 502);
    }

    // Offers are normally under `offers` (matches CPAGrip's RSS feed shape,
    // <offers><offer>...), with a couple of fallbacks just in case.
    const offers =
      data.offers || data.Offers || (Array.isArray(data) ? data : []);

    // `raw` is included so the frontend can console.log() the untouched
    // response while field names are being verified against real data —
    // safe to drop once the mapping in earn.html is confirmed correct.
    return json({ offers, raw: data });
  } catch (err) {
    console.error("cpagrip-feed error:", err);
    return errorJson("Could not reach CPAGrip.", 502);
  }
}
