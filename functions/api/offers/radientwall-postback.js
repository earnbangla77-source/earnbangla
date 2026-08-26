// functions/api/offers/radientwall-postback.js
//
// ⚠️ DEBUG VERSION — Place this file at functions/api/offers/radientwall-postback.js
//    (sibling to offery-postback.js / primewall-postback.js)
//
// RadiantWall's dashboard only shows a "Test Postback" form with User ID +
// Payout fields — the actual postback param names (userId? subId?
// transaction id field? signature? status codes?) are NOT documented
// anywhere visible yet. This file does NOT touch coins/DB at all.
// It just logs everything RadiantWall sends (method, query params, body)
// and returns "ok", so we can capture one real postback and see the exact
// shape before writing the final crediting logic.
//
// ---- HOW TO USE ----
// 1. Deploy this file (git push, as usual).
// 2. RadiantWall dashboard → find the Postback URL field (likely under
//    Offers / Placement / Sites settings) and set it to:
//      https://earn-bangla.com/api/offers/radientwall-postback
// 3. In a terminal, run and leave open:
//      wrangler pages deployment tail --project-name=earnbangla
// 4. On RadiantWall dashboard, use the "Test Postback" form (User ID +
//    Payout, and any other fields if you scroll down) and submit.
// 5. Copy everything printed between the ===== lines in the tail output
//    and send it back — that confirms the real param names, and then this
//    file gets replaced with the final version (same structure as
//    offery-postback.js: signature verify, duplicate-guard, chargeback
//    handling, users.coins / completed_offers / total_earning updates,
//    insert into offer_completions with provider = 'radientwall').
//
// No env vars are required for this debug version — no secret key check,
// no D1 calls. Safe to deploy immediately.

function ok() {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}

async function logPostback(request) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());

  let bodyParams = {};
  let rawBody = "";
  let contentType = request.headers.get("content-type") || "";

  if (request.method === "POST") {
    // Read the raw body first (so we can log it even if parsing fails),
    // then try to parse it based on content-type.
    rawBody = await request.text();
    try {
      if (contentType.includes("application/json")) {
        bodyParams = rawBody ? JSON.parse(rawBody) : {};
      } else if (
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("multipart/form-data")
      ) {
        // Re-construct a Request so formData() can parse the body we already
        // consumed as text.
        const cloned = new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: rawBody,
        });
        const formData = await cloned.formData();
        bodyParams = Object.fromEntries(formData.entries());
      }
    } catch (err) {
      bodyParams = { __parseError: String(err.message || err) };
    }
  }

  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    headers[key] = value;
  }

  const logLines = [
    "=====================================================",
    "RADIANTWALL POSTBACK RECEIVED",
    "=====================================================",
    "Method: " + request.method,
    "Full URL: " + request.url,
    "Content-Type: " + contentType,
    "Query params: " + JSON.stringify(queryParams, null, 2),
    "Body params (parsed): " + JSON.stringify(bodyParams, null, 2),
    "Raw body (text): " + rawBody,
    "Headers: " + JSON.stringify(headers, null, 2),
    "=====================================================",
  ];

  console.log(logLines.join("\n"));

  return ok();
}

export async function onRequestPost(context) {
  try {
    return await logPostback(context.request);
  } catch (err) {
    console.error("radientwall-postback DEBUG error:", err);
    // Still return "ok" so RadiantWall doesn't retry/flag this as a failure
    // while we're just trying to observe the payload shape.
    return ok();
  }
}

export async function onRequestGet(context) {
  try {
    return await logPostback(context.request);
  } catch (err) {
    console.error("radientwall-postback DEBUG error:", err);
    return ok();
  }
}
