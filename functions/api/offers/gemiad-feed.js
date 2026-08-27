// functions/api/offers/gemiad-feed.js
// Cloudflare Pages Function — GET /api/offers/gemiad-feed
//
// Server-side proxy for GemiAd's Static Offers API
// (dashboard.gemiad.com/publisher/documentation → API Offers).
//
// ⚠️ CONFIRMED from GemiAd's own Documentation page (2026-08-27):
//   GET http://api.gemiwall.com/api/offers/static
//   Required query params: placementId, apiKey
//   Rate limit: 5 requests/minute PER PLACEMENT — exceeding returns 429.
//   Response envelope uses a boolean `success` field (same convention as
//   TaskWall — see taskwall-feed.js) — NOT a string `status`. This file
//   checks `data.success === true`, not `data.status`.
//
// ⚠️ NOT confirmed yet — GemiAd's docs "Response Example" was cut off
//    before the individual offer object's fields were visible. This file
//    makes a best-effort guess at offer field names based on common
//    offerwall API conventions (title/description/icon/payout/link), with
//    fallback candidate names for each. The `raw` field in this endpoint's
//    JSON response carries GemiAd's untouched payload through — after the
//    FIRST real request, open the browser console (or wrangler tail),
//    check `raw`, and fix normalizeGemiadOffer() below if any field came
//    back empty or wrong. Do not assume this mapping is correct without
//    checking a real response first — see the TaskWall user_amount/
//    multi_event lesson and the three-bugs-in-a-row history in
//    OFFERWALL-MASTER-GUIDE.md §7 for why this matters.
//
// ⚠️ Unlike TaskWall/Admantum/Offery, GemiAd's static endpoint does NOT
//    take a userid/subId param at all (confirmed — docs list only
//    placementId + apiKey). GemiAd is not personalizing the feed per user;
//    the per-user tracking id almost certainly needs to be injected into
//    each offer's click/tracking link before sending the user there
//    (common pattern for "static" offer feeds elsewhere in the industry).
//    Until a real response is seen, injectUserId() below tries a handful
//    of common macro spellings ({USER_ID}, {SUBID}, {CLICKID}, lowercase
//    variants) and otherwise passes the link through unchanged — check the
//    real `link` values GemiAd returns and fix this once the actual macro
//    (if any) is known. This is the single most important thing to verify
//    before relying on this file for real coin payouts, since a wrong or
//    missing user id here means GemiAd's postback can't be matched back to
//    the right earnbangla user.
//
// Rate limiting (5 req/min/placement): this file caches GemiAd's response
// in-memory for CACHE_TTL_MS and serves the cache to concurrent/rapid user
// requests instead of hitting GemiAd on every single earn.html page load.
// With many users hitting /gemiad-feed at once, calling upstream per
// request would blow through 5/min almost immediately and start getting
// 429s. Note this is a best-effort per-isolate cache (Cloudflare may spin
// up multiple isolates or recycle one), not a strict guarantee — if 429s
// still show up under real traffic, move this to Cloudflare KV instead.
//
// Reuses env.GEMIAD_SECRET_KEY (the same "Secret Key" from GemiAd
// dashboard → Profile Settings already used in gemiad-postback.js's hash)
// as the apiKey — GemiAd's dashboard only exposes ONE secret key anywhere
// (Profile Settings), no separate placement-level API key field was found
// after checking, so this is the confirmed single source of truth. If
// GemiAd later adds a separate placement-level key, swap it in below.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

const GEMIAD_PLACEMENT_ID = "6a900ec9d7e247e9a4fd0b74";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — comfortably under the 5 req/min cap

let cachedData = null;
let cachedAt = 0;

export async function onRequestGet(context) {
  const { request, env } = context;

  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }

  const apiKey = env.GEMIAD_SECRET_KEY || "";
  if (!apiKey) {
    return errorJson("Server not configured (missing GEMIAD_SECRET_KEY).", 500);
  }

  const now = Date.now();
  let data = cachedData && (now - cachedAt) < CACHE_TTL_MS ? cachedData : null;

  if (!data) {
    const feedUrl =
      `http://api.gemiwall.com/api/offers/static` +
      `?placementId=${encodeURIComponent(GEMIAD_PLACEMENT_ID)}` +
      `&apiKey=${encodeURIComponent(apiKey)}`;

    try {
      const res = await fetch(feedUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy",
        },
      });

      if (!res.ok) {
        console.error("gemiad-feed: upstream status", res.status);
        // Prefer a stale cache over a hard failure (e.g. a transient 429
        // from the 5/min rate limit).
        if (cachedData) {
          data = cachedData;
        } else {
          return errorJson("GemiAd feed request failed.", 502);
        }
      } else {
        const raw = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          console.error("gemiad-feed: non-JSON response:", raw.slice(0, 300));
          return errorJson("GemiAd returned an unexpected response.", 502);
        }

        if (parsed.success !== true) {
          console.error("gemiad-feed: upstream error:", raw.slice(0, 300));
          return errorJson(parsed.message || "GemiAd feed error.", 502);
        }

        data = parsed;
        cachedData = parsed;
        cachedAt = now;
      }
    } catch (err) {
      console.error("gemiad-feed error:", err);
      if (cachedData) {
        data = cachedData;
      } else {
        return errorJson("Could not reach GemiAd.", 502);
      }
    }
  }

  const rawOffers = Array.isArray(data.offers)
    ? data.offers
    : Array.isArray(data.data)
    ? data.data
    : [];

  const offers = rawOffers.map((o) => normalizeGemiadOffer(o, me.id));

  // `raw` included so the frontend can console.log() the untouched
  // response while confirming field names — same pattern as
  // offery-feed.js / taskwall-feed.js. REMOVE once field names below are
  // confirmed correct, to avoid shipping GemiAd's full payload to the client.
  return json({ offers, raw: data });
}

function normalizeGemiadOffer(o, userId) {
  const title = o.title ?? o.name ?? o.offer_name ?? "";
  const description = o.description ?? o.short_description ?? "";
  const image = o.icon ?? o.image ?? o.icon_url ?? "";
  const rawAmount =
    o.reward ?? o.amount ?? o.coins ?? o.payout_coins ?? o.payout ?? 0;
  const reward = parseFloat(rawAmount) || 0;
  const link = injectUserId(o.link ?? o.url ?? o.tracking_link ?? "", userId);

  return {
    id: o.offer_id ?? o.id,
    title,
    description,
    image,
    link,
    reward,
  };
}

// Best-effort macro replacement. GemiAd's postback URL uses {USER_ID}/
// {OFFER_ID}-style macros (confirmed from the postback docs), so the click
// link plausibly uses a similar {...} placeholder for the user id — this
// covers the most likely spellings. Once a real `link` value is seen (via
// the `raw` field above), replace this with whatever macro GemiAd actually
// uses, or with a plain query-string append if there's no macro at all.
function injectUserId(link, userId) {
  if (!link) return link;
  const encoded = encodeURIComponent(userId);
  return link
    .replace("{USER_ID}", encoded)
    .replace("{user_id}", encoded)
    .replace("{SUBID}", encoded)
    .replace("{subid}", encoded)
    .replace("{CLICKID}", encoded)
    .replace("{clickid}", encoded);
}
