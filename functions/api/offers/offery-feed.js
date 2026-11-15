// functions/api/offers/offery-feed.js
// Cloudflare Pages Function — GET /api/offers/offery-feed
//
// Server-side proxy for Offery's Offers API (https://offery.io/docs/).
//
//   1) Keeps the API key out of devtools / client-side JS.
//   2) The signed-in user's real id is swapped into each offer's click URL
//      server-side, so it can't be spoofed from devtools.
//   3) GEO TARGETING: the visitor's country (from Cloudflare) is sent to
//      Offery via the documented `countries` param, AND offers are filtered
//      again locally using each offer's geo_targeting field. So a user on a
//      US VPN only sees US offers, an Australian VPN only AU offers, etc.
//
// Optional (recommended): move the key to a Cloudflare secret
//   wrangler pages secret put OFFERY_API_KEY --project-name=earnbangla
//   wrangler pages secret put OFFERY_API_KEY --project-name=earnbangla --env preview
// If the secret isn't set, the fallback constant below is used.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

const OFFERY_API_KEY_FALLBACK = "8qb2kq6axoev42a70fz01b44chpx6q";

// Cloudflare returns these for unknown / Tor traffic — treat as "no country".
const UNKNOWN_COUNTRIES = ["", "XX", "T1"];

function offerAllowedIn(row, country) {
  const geo = row && row.geo_targeting;
  if (!geo) return true; // no geo info → treat as worldwide

  const allowed = (Array.isArray(geo.allowed_countries) ? geo.allowed_countries : [])
    .map((c) => String(c).toUpperCase());
  const excluded = (Array.isArray(geo.excluded_countries) ? geo.excluded_countries : [])
    .map((c) => String(c).toUpperCase());

  if (excluded.includes(country)) return false;
  if (allowed.length > 0 && !allowed.includes(country)) return false;
  return true;
}

export async function onRequestGet(context) {
  const { request, env } = context;

  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }

  const apiKey = env.OFFERY_API_KEY || OFFERY_API_KEY_FALLBACK;

  // Visitor's country as seen by Cloudflare (reflects their VPN exit IP).
  const country = String(
    request.headers.get("CF-IPCountry") || (request.cf && request.cf.country) || ""
  ).toUpperCase();
  const hasCountry = !UNKNOWN_COUNTRIES.includes(country);

  let feedUrl = `https://offery.io/api/?apiKey=${encodeURIComponent(apiKey)}`;
  if (hasCountry) {
    feedUrl += `&countries=${encodeURIComponent(country.toLowerCase())}`;
  }

  try {
    const res = await fetch(feedUrl, {
      headers: {
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

    let rows = Array.isArray(data.data) ? data.data : [];

    // Second line of defense: even if Offery's `countries` filter lets a
    // wrong-country offer through, drop it here.
    if (hasCountry) {
      rows = rows.filter((row) => offerAllowedIn(row, country));
    }

    // Swap the USER_ID placeholder for the signed-in user's real id.
    const offers = rows.map((row) => ({
      ...row,
      url: String(row.url || "").replace("USER_ID", encodeURIComponent(me.id)),
    }));

    return json({ offers, country: hasCountry ? country : null, raw: data });
  } catch (err) {
    console.error("offery-feed error:", err);
    return errorJson("Could not reach Offery.", 502);
  }
}