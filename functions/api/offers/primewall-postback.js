// functions/api/offers/primewall-postback.js
//
// ⚠️ TEMPORARY DEBUG VERSION — this does NOT credit coins yet.
//
// We still don't know exactly what parameter names / format Prime Wall
// sends in its postback (their dashboard doesn't document it anywhere we
// could see, and the Postback Tester form was cut off before showing the
// full field list). Instead of guessing, this version just logs everything
// it receives and replies "ok" — so we can capture one real request and
// build the final version from actual data instead of guesses.
//
// HOW TO USE THIS:
//   1. Deploy this file (git add/commit/push as usual).
//   2. On the Prime Wall dashboard → Placement → Edit Placement, set the
//      "Postback" field to:
//        https://earn-bangla.com/api/offers/primewall-postback
//   3. In one terminal, run:
//        wrangler pages deployment tail --project-name=earnbangla
//   4. On the Prime Wall dashboard → Integration → Postback Tester, fill in
//      a test User ID + Payout (and any other fields you see after
//      scrolling down — there may be more below Payout) and send a test
//      postback.
//   5. Copy everything the tail prints between the ===== lines below and
//      send it back — that's the real format, and the final version (with
//      actual coin-crediting, duplicate-guard, users table updates, etc.,
//      matching offery-postback.js's pattern) can be written immediately
//      from that.
//
// Once the real version is written, this file gets replaced entirely —
// nothing here is meant to stay.

async function logAndOk(request) {
  const url = new URL(request.url);
  const queryParams = Object.fromEntries(url.searchParams.entries());

  let rawBody = "";
  let bodyParams = {};
  try {
    if (request.method === "POST") {
      rawBody = await request.clone().text();
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        bodyParams = rawBody ? JSON.parse(rawBody) : {};
      } else if (contentType.includes("form")) {
        bodyParams = Object.fromEntries((await request.formData()).entries());
      }
    }
  } catch (err) {
    rawBody = "(could not parse body: " + err.message + ")";
  }

  console.log("===== Prime Wall postback (DEBUG) =====");
  console.log("method:", request.method);
  console.log("full URL:", request.url);
  console.log("query params:", JSON.stringify(queryParams));
  console.log("content-type:", request.headers.get("content-type") || "(none)");
  console.log("raw body:", rawBody || "(empty)");
  console.log("parsed body params:", JSON.stringify(bodyParams));
  console.log("========================================");

  // Reply "ok" (plain text) since that's what Offery expects too — if Prime
  // Wall's tester shows an error because it wanted JSON instead, that's
  // useful information too, note it down when you send the log back.
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}

export async function onRequestGet(context) {
  return logAndOk(context.request);
}

export async function onRequestPost(context) {
  return logAndOk(context.request);
}
