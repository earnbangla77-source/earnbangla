// functions/api/offers/taskwall-feed.js
// Cloudflare Pages Function — GET /api/offers/taskwall-feed
//
// Server-side proxy for TaskWall's Offers API (taskwall.io/documentation/?api=1).
// Same pattern as offery-feed.js / admantum-feed.js:
//   1) Keeps the TaskWall App/API key out of client-side JS.
//   2) The signed-in user's real id is looked up here from the session
//      cookie and sent to TaskWall as `userid` server-side.
//
// Requires the caller to be signed in — returns 401 if not (matches
// openTaskwallOfferwall()'s res.status === 401 check in earn.html).
//
// Confirmed against taskwall.io/documentation/?api=1:
//   GET https://wall.taskwall.io/api/?app_id=&country=&os=android&userid={user_id}
//   app_id  - Required. This is actually the "API KEY" shown on the app's
//             View App Details page (dashboard screenshot), NOT the numeric
//             app_id in the dashboard's own URL (?app_id=1230) — those are
//             two different things, don't mix them up.
//   userid  - Required.
//   country - Optional (ISO2, e.g. TR/US/GB).
//   os      - Optional: android / ios / desktop.
// Response: {"status":"success","count":N,"offers":[{offer_id, title,
//   description, icon, payout, link, user_amount, devices, available_in,
//   countries}, ...]}  — note `status` is the STRING "success", not a bool.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

// From the "View App Details" page — this is the API KEY field, used as
// the app_id query param per TaskWall's docs.
const TASKWALL_APP_KEY = "35e67766abe0e8b9a6aa0ae5ff0cd090";

export async function onRequestGet(context) {
  const { request, env } = context;

  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }

  const country = request.headers.get("CF-IPCountry") || "";
  const os = detectOs(request.headers.get("User-Agent") || "");

  const feedUrl =
    `https://wall.taskwall.io/api/` +
    `?app_id=${encodeURIComponent(TASKWALL_APP_KEY)}` +
    `&userid=${encodeURIComponent(me.id)}` +
    (os ? `&os=${encodeURIComponent(os)}` : "") +
    (country ? `&country=${encodeURIComponent(country)}` : "");

  try {
    const res = await fetch(feedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy",
      },
    });

    if (!res.ok) {
      console.error("taskwall-feed: upstream status", res.status);
      return errorJson("TaskWall feed request failed.", 502);
    }

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("taskwall-feed: non-JSON response:", raw.slice(0, 300));
      return errorJson("TaskWall returned an unexpected response.", 502);
    }

    // NOTE: TaskWall's `status` field is the string "success", not a bool.
    if (data.status !== "success") {
      console.error("taskwall-feed: upstream error:", raw.slice(0, 300));
      return errorJson(data.message || "TaskWall feed error.", 502);
    }

    const offers = (Array.isArray(data.offers) ? data.offers : []).map(normalizeTaskwallOffer);

    // `raw` included so the frontend can console.log() the untouched
    // response while confirming field names — same pattern as offery-feed.
    return json({ offers, raw: data });
  } catch (err) {
    console.error("taskwall-feed error:", err);
    return errorJson("Could not reach TaskWall.", 502);
  }
}

function normalizeTaskwallOffer(o) {
  return {
    id: o.offer_id,
    title: o.title,
    description: o.description,
    image: o.icon,
    link: o.link,
    reward: o.user_amount,
  };
}

function detectOs(ua) {
  const s = ua.toLowerCase();
  if (/android/.test(s)) return "android";
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  return "desktop";
}
