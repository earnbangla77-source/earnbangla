// functions/api/offers/gemiad-feed.js
// Cloudflare Pages Function — GET /api/offers/gemiad-feed
//
// Server-side proxy for GemiAd's Static Offers API
// (dashboard.gemiad.com/publisher/documentation → API Offers).
//
// ⚠️ CONFIRMED from GemiAd's own Documentation page (2026-08-27, "API
//    Offers" section, full response example + field table now checked):
//   GET http://api.gemiwall.com/api/offers/static
//   Required query params: placementId, apiKey
//   Rate limit: 5 requests/minute PER PLACEMENT — exceeding returns 429.
//   Response envelope uses a boolean `success` field (same convention as
//   TaskWall — see taskwall-feed.js) — NOT a string `status`. This file
//   checks `data.success === true`, not `data.status`.
//
// ⚠️ Offer object fields CONFIRMED (no longer guessed) from the docs'
//    Response Example + "Response Fields Documentation" table:
//      name            → display title (NOT "title")
//      description.en  → locale-keyed object, e.g. { en: "..." }
//      icon            → icon/logo URL
//      payout          → total reward in USD (NOT already coins — see
//                         the conversion note in normalizeGemiadOffer below)
//      url             → click/tracking URL, containing a literal
//                         "[USER_ID]" placeholder (NOT "{USER_ID}")
//      events[]        → sub-events for multi-event offers (multiEvent:
//                         true); each event may carry its own `payout`.
//                         Not currently surfaced to the frontend — the
//                         offer's top-level `payout` (the total) is used.
//      category, country[], device[], trackingType, dailyCap,
//      dailyClickCap, epc, cvr — available but not currently used by
//      normalizeGemiadOffer(); add if the frontend needs them later.
//
// ⚠️ GemiAd's static endpoint does NOT take a userid/subId param at all
//    (confirmed — docs list only placementId + apiKey). The per-user
//    tracking id is injected into each offer's `url` by replacing the
//    literal "[USER_ID]" placeholder — see injectUserId() below (confirmed
//    from docs, no longer a guessed macro spelling). Optional `sub1`
//    (source) / `sub2` (subsource) params are also supported per docs but
//    not currently appended — add `&sub1=...&sub2=...` in injectUserId()
//    if per-traffic-source attribution is needed later.
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
// ⚠️ IMPORTANT — apiKey is NOT the same Secret Key used in
//    gemiad-postback.js's hash. Confirmed via a live 401 "Invalid API key"
//    test against the real endpoint: GemiAd's docs say apiKey is "your API
//    key from the placement settings" — i.e. a PER-PLACEMENT key found on
//    the Placement's own settings page in the dashboard, distinct from the
//    single "Secret Key" under Profile Settings that the postback hash
//    uses. env.GEMIAD_SECRET_KEY here must be set to THAT placement-level
//    API key, not the Profile Settings Secret Key — re-check the
//    Placement → Settings page in the dashboard and update the secret:
//   wrangler pages secret put GEMIAD_SECRET_KEY --project-name=earnbangla
//    (Re-verify gemiad-postback.js separately — its hash formula was
//    confirmed against the Postbacks docs page and should keep using the
//    Profile Settings Secret Key; only THIS file's apiKey was wrong.)
//
// env.GEMIAD_SECRET_KEY here must hold the PLACEMENT-LEVEL API key from
// GemiAd dashboard → Placement → Settings — NOT the Profile Settings
// Secret Key (that one stays server-side only in gemiad-postback.js for
// the hash check). Despite the shared variable name (kept as-is to match
// the existing wrangler secret already provisioned for this project),
// these are two different keys — see the confirmed note above.

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

  // Field names are now confirmed correct (see header note), so `raw` is
  // no longer needed for debugging — dropped to avoid shipping GemiAd's
  // full payload (including other users'-irrelevant offer internals) to
  // the client on every request.
  return json({ offers });
}

function normalizeGemiadOffer(o, userId) {
  // Confirmed field names from GemiAd's "API Offers" documentation
  // (dashboard.gemiad.com/publisher/documentation → API Offers, response
  // example + field table). No more guessing:
  //   id, name, description.{locale}, icon, url, payout (USD), events[],
  //   category, country[], device[], trackingType, dailyCap, etc.
  const title = o.name ?? "";
  // description is a locale-keyed object, e.g. { en: "..." } — fall back to
  // "en", then to whatever the first available locale is.
  const description =
    (o.description && (o.description.en || Object.values(o.description)[0])) || "";
  const image = o.icon ?? "";

  // payout is in USD (confirmed) — convert to this placement's coin
  // currency the same way every other provider on this site does
  // (1000 coins = $1), matching the reward the gemiad-postback.js hash/
  // credit flow will later report back for the SAME offer completion.
  const payoutUsd = parseFloat(o.payout) || 0;
  const reward = Math.round(payoutUsd * 1000);

  // Tracking URL uses a literal "[USER_ID]" placeholder (confirmed, NOT
  // "{USER_ID}") — replace it with this user's id so GemiAd can match the
  // later postback back to them. sub1/sub2 are optional per docs; omitted
  // here since we don't have a separate source/subsource to pass.
  const link = injectUserId(o.url ?? "", userId);

  return {
    id: o.id,
    title,
    description,
    image,
    link,
    reward,
  };
}

// Replaces GemiAd's literal "[USER_ID]" placeholder in the click/tracking
// URL with this user's id (confirmed from the "API Offers" docs — NOT a
// "{USER_ID}"-style macro like the postback URL uses).
function injectUserId(link, userId) {
  if (!link) return link;
  return link.replace("[USER_ID]", encodeURIComponent(userId));
}