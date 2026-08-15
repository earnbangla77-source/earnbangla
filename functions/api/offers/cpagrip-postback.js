// functions/api/offers/cpagrip-postback.js
//
// ⚠️ Place this file at functions/api/offers/cpagrip-postback.js
//    (sibling to functions/api/offers/postback.js from your UpWall setup)
//
// Receives server-to-server postbacks from CPAGrip's GLOBAL POSTBACK system
// when a user completes an offer. CPAGrip calls this URL with a POST request
// (application/x-www-form-urlencoded) containing:
//
//   password     - the secret you set on CPAGrip's Global Postback page
//   payout       - dollar amount CPAGrip paid for this offer, e.g. "0.99"
//   offer_id     - CPAGrip's internal offer id
//   tracking_id  - the value you passed as &tracking_id= on the offer link
//                  (this MUST be the earnbangla user's numeric id)
//
// NOTE: CPAGrip's global postback does not send a unique conversion/lead id,
// so duplicate-protection here is based on (provider, user_id, offer_id) —
// a given user can only be credited once for a given offer_id, ever. If you
// want users to be able to redo the same offer later, you'd need to relax
// this (e.g. add a time window) — but for most GPT sites this is the safer
// default since CPAGrip offers are usually one-time-per-user anyway.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

// How many coins per $1.00 of payout. Your withdraw system uses
// 200 coins = $0.20, i.e. 1000 coins = $1.00 — adjust if that's not right.
const COINS_PER_DOLLAR = 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const contentType = request.headers.get("content-type") || "";
    let params;

    if (contentType.includes("application/json")) {
      params = await request.json();
    } else {
      // CPAGrip sends standard form-encoded POST data
      const formData = await request.formData();
      params = Object.fromEntries(formData.entries());
    }

    const password = params.password || "";
    const payout = parseFloat(params.payout);
    const offerId = String(params.offer_id || "");
    const trackingId = String(params.tracking_id || "");

    // 1. Verify the shared secret
    const expectedPassword = env.OFFERWALL_POSTBACK_PASSWORD || "";
    if (!expectedPassword || password !== expectedPassword) {
      console.error("cpagrip-postback: bad password");
      return errorJson("Access Denied.", 403);
    }

    // 2. Validate required fields
    if (!trackingId || !offerId || !Number.isFinite(payout) || payout <= 0) {
      return errorJson("Missing or invalid parameters.", 400);
    }

    const userId = parseInt(trackingId, 10);
    if (!Number.isFinite(userId)) {
      return errorJson("Invalid tracking_id.", 400);
    }

    const coinsEarned = Math.round(payout * COINS_PER_DOLLAR);

    // 3. Duplicate guard — same user + same offer_id only credited once
    const existing = await env.DB.prepare(
      `SELECT id FROM offer_completions WHERE provider = ? AND user_id = ? AND offer_id = ?`
    )
      .bind("cpagrip", userId, offerId)
      .first();

    if (existing) {
      // Tell CPAGrip we received it fine — just don't pay twice.
      return json({ status: "duplicate_ignored" });
    }

    // 4. Credit the user's coin balance
    const update = await env.DB.prepare(
      `UPDATE users SET coins = coins + ? WHERE id = ?`
    )
      .bind(coinsEarned, userId)
      .run();

    if (!update.success || update.meta.changes === 0) {
      return errorJson("User not found.", 404);
    }

    // 5. Log the completion
    await env.DB.prepare(
      `INSERT INTO offer_completions (provider, user_id, offer_id, payout, coins_earned, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind("cpagrip", userId, offerId, payout, coinsEarned)
      .run();

    return json({ status: "ok" });
  } catch (err) {
    console.error("cpagrip-postback error:", err);
    return errorJson(err.message || "Server error", 500);
  }
}
