// functions/api/offers/admantum-feed.js
// Cloudflare Pages Function — GET /api/offers/admantum-feed
//
// Server-side proxy for Admantum's Offers API (https://admantum.com/api/v3/offers/).
// Same pattern as offery-feed.js:
//   1) Keeps ADMANTUM_APP_ID / secret handling out of client-side JS.
//   2) The signed-in user's real id is looked up here from the session
//      cookie (eb_session) and passed to Admantum server-side.
//
// Requires the caller to be signed in — returns 401 if not (matches
// openAdmantumOfferwall()'s res.status === 401 check in earn.html).
//
// ⚠️ Admantum's `device` param is NOT optional in practice — leaving it out
// returns {"success":false,"message":"invalid device"} even though the docs
// don't call it mandatory. Fixed here by detecting device from the User-Agent
// header. If Admantum ever rejects with "invalid device" again, the accepted
// value strings may need adjusting — ask Admantum support for the exact set.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

const ADMANTUM_APP_ID = "52189";

export async function onRequestGet(context) {
  const { request, env } = context;

  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const device = detectDevice(request.headers.get("User-Agent") || "");

  const feedUrl =
    `https://admantum.com/api/v3/offers/` +
    `?appid=${encodeURIComponent(ADMANTUM_APP_ID)}` +
    `&uid=${encodeURIComponent(me.id)}` +
    `&device=${encodeURIComponent(device)}` +
    (ip ? `&ip=${encodeURIComponent(ip)}` : "");

  try {
    const res = await fetch(feedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy",
      },
    });

    if (!res.ok) {
      console.error("admantum-feed: upstream status", res.status);
      return errorJson("Admantum feed request failed.", 502);
    }

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("admantum-feed: non-JSON response:", raw.slice(0, 300));
      return errorJson("Admantum returned an unexpected response.", 502);
    }

    if (data.success !== true) {
      console.error("admantum-feed: upstream error:", raw.slice(0, 300));
      return errorJson(data.message || "Admantum feed error.", 502);
    }

    const offers = (Array.isArray(data.offers) ? data.offers : []).map(normalizeAdmantumOffer);

    // `raw` included so the frontend can console.log() the untouched
    // response while confirming field names — same pattern as offery-feed.
    return json({ offers, raw: data });
  } catch (err) {
    console.error("admantum-feed error:", err);
    return errorJson("Could not reach Admantum.", 502);
  }
}

function normalizeAdmantumOffer(o) {
  return {
    id: o.offer_id,
    title: o.offer_title,
    description: o.offer_description,
    image: o.offer_image,
    link: o.offer_link,
    reward: o.offer_virtual_currency,
  };
}

function detectDevice(ua) {
  const s = ua.toLowerCase();
  if (/ipad|tablet(?!.*mobile)/.test(s)) return "tablet";
  if (/mobi|android|iphone/.test(s)) return "mobile";
  return "desktop";
}
