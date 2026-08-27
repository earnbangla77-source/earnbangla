// functions/api/offers/gemiad-postback.js
//
// ⚠️ Place this file at functions/api/offers/gemiad-postback.js
//    (sibling to offery-postback.js, revtoo-postback.js, admantum-postback.js,
//    taskwall-postback.js)
//
// Receives server-to-server postbacks from GemiAd (gemiad.com) when a user
// completes an offer, or when a previously-credited conversion is reversed.
// Confirmed against dashboard.gemiad.com/publisher/documentation → Postbacks.
//
// ⚠️ GemiAd is DIFFERENT from every other provider integrated so far:
//   - Sends HTTP GET only (per docs).
//   - Auth is a SHA-256 HASH macro — NOT MD5 (Admantum) and NOT a plain
//     shared password (TaskWall/CPAGrip). Formula (per docs):
//       hash = SHA256(userId + offerId + txId + secretKey)
//     secretKey is GemiAd's "Secret Key", found in GemiAd dashboard →
//     Profile Settings (confirmed via dashboard screenshot — this is the
//     ONLY key GemiAd exposes anywhere in the dashboard; it is reused
//     below in gemiad-feed.js as the Offers API's `apiKey` too, since no
//     separate placement-level API key field exists).
//   - HAS a real unique transaction id (txId), same id reused for the
//     original conversion AND its reversal — unlike TaskWall/Admantum, no
//     synthetic dedupe key is needed; dedupe directly on txId.
//   - HAS a proper reversal mechanism via the `status` param:
//       status = "completed" → credit the user
//       status = "rejected"  → reverse a PREVIOUSLY-credited conversion.
//         txId matches the ORIGINAL conversion's txId, and `reward`/`payout`
//         arrive as NEGATIVE numbers for the reversal event.
//   - `reward` is already converted into this placement's app currency
//     (coins) per the placement's Exchange Rate (confirmed 1000 coins = $1,
//     matching every other provider on this site) — this is what gets
//     credited/debited. `payout` stays in USD, stored for reference only,
//     same convention as the other providers.
//
// Postback URL to paste into GemiAd dashboard → Placement → Settings →
// Server Postback → Postback URL (confirmed already pasted in there per
// dashboard screenshot). The query param names below are chosen by us and
// MUST stay in sync with what this file parses — if you rename one side,
// rename the other too:
//
//   https://earn-bangla.com/api/offers/gemiad-postback?userId={USER_ID}&offerId={OFFER_ID}&offerName={OFFER_NAME}&eventId={EVENT_ID}&eventName={EVENT_NAME}&payout={PAYOUT}&reward={REWARD}&txId={TXID}&status={STATUS}&ipAddr={IPADDR}&sub1={SUB1}&sub2={SUB2}&hash={HASH}
//
// ⚠️ Requires env.GEMIAD_SECRET_KEY — set this to the SAME value shown in
//    GemiAd dashboard → Profile Settings → Secret Key:
//
//   wrangler pages secret put GEMIAD_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put GEMIAD_SECRET_KEY --project-name=earnbangla --env preview
//
// ⚠️ Optional hardening: GemiAd sends all postbacks from a static IP
//    (64.226.92.208 per their docs at time of writing — reconfirm in your
//    dashboard before relying on it). This file does not check source IP;
//    add that check at the Cloudflare/WAF level if you want it, since the
//    hash check already prevents forged postbacks from crediting coins.
//
// ⚠️ Reuses the same offer_completions table (provider, user_id, offer_id,
//    transaction_id, payout, coins_earned, status, created_at) already used
//    for Offery/Revtoo/Admantum/TaskWall — NO new D1 migration needed, this
//    just inserts rows with provider = 'gemiad'. The `status` column here
//    stores our own 'credited' / 'reversed' values (not GemiAd's wording).
//
// Same earnings-tracking fix as the other providers: crediting bumps
// users.coins AND users.completed_offers AND users.total_earning.
// Reversing now decrements all THREE of the same columns (floored at 0 via
// SQL MAX(), matching the documented fix in OFFERWALL-MASTER-GUIDE.md §7 —
// this was previously coins-only in an earlier draft of this file; aligned
// here to match Offery/Revtoo/Admantum's behavior). Reversal only fires if
// we find our OWN 'credited' row for that txId — a "rejected" postback for
// a txId we never credited (e.g. the original postback's hash failed, or
// it's a duplicate reversal) is accepted but ignored, so a user's balance
// can never go negative from a reversal alone.

function approved() {
  return new Response("Approved", { status: 200, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("gemiad-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handlePostback(request, env) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  const userId = String(params.userId || "");
  const offerId = String(params.offerId || "");
  const offerName = String(params.offerName || "");
  const eventId = String(params.eventId || "");
  const eventName = String(params.eventName || "");
  const payout = parseFloat(params.payout) || 0;
  const reward = parseFloat(params.reward);
  const txId = String(params.txId || "");
  const status = String(params.status || "");
  const hash = String(params.hash || "");

  const secretKey = env.GEMIAD_SECRET_KEY || "";
  if (!secretKey) {
    return fail("Server not configured (missing GEMIAD_SECRET_KEY).", 500);
  }

  // 1. Validate required fields (mirrors GemiAd's own reference implementation)
  if (!hash || !userId || !offerId || !txId) {
    return fail("Missing required parameters.", 400);
  }
  if (!Number.isFinite(reward)) {
    return fail("Missing or invalid parameters.", 400);
  }

  // 2. Verify the SHA-256 hash: SHA256(userId + offerId + txId + secretKey)
  const expectedHash = await sha256Hex(userId + offerId + txId + secretKey);
  if (hash !== expectedHash) {
    return fail("Invalid hash.", 403);
  }

  // reward is signed: positive to credit on completion, negative on reversal
  const coins = Math.round(reward);
  console.log("gemiad-postback:", { userId, txId, offerId, offerName, eventId, eventName, status, coins, payout });

  if (status === "completed") {
    // ---- Credit ----
    const dup = await env.DB.prepare(
      `SELECT id FROM offer_completions WHERE provider = 'gemiad' AND transaction_id = ? AND status = 'credited'`
    ).bind(txId).first();

    if (dup) {
      return approved(); // already credited — idempotent, don't double-credit
    }

    const update = await env.DB.prepare(
      `UPDATE users
       SET coins = coins + ?,
           completed_offers = completed_offers + 1,
           total_earning = total_earning + ?
       WHERE id = ?`
    ).bind(coins, coins, userId).run();

    if (!update.success || update.meta.changes === 0) {
      return fail("User not found.", 404);
    }

    await env.DB.prepare(
      `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
       VALUES ('gemiad', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
    ).bind(userId, offerId, txId, payout, coins).run();

    return approved();
  }

  if (status === "rejected") {
    // ---- Reversal: only deduct if we actually credited this exact txId before ----
    const original = await env.DB.prepare(
      `SELECT id FROM offer_completions WHERE provider = 'gemiad' AND transaction_id = ? AND status = 'credited'`
    ).bind(txId).first();

    if (!original) {
      // Nothing to reverse (never credited, or already reversed) — accept, no-op.
      return approved();
    }

    const deductAmount = Math.abs(coins);

    // Decrement all three columns (not just coins), floored at 0 via SQL
    // MAX() — matches the documented fix for Offery/Revtoo/Admantum in
    // OFFERWALL-MASTER-GUIDE.md §7 ("chargeback-এ তিনটাই ডিক্রিমেন্ট,
    // 0-এর নিচে না").
    await env.DB.prepare(
      `UPDATE users
       SET coins = MAX(coins - ?, 0),
           completed_offers = MAX(completed_offers - 1, 0),
           total_earning = MAX(total_earning - ?, 0)
       WHERE id = ?`
    ).bind(deductAmount, deductAmount, userId).run();

    await env.DB.prepare(`UPDATE offer_completions SET status = 'reversed' WHERE id = ?`)
      .bind(original.id).run();

    return approved();
  }

  return fail(`Unknown status: ${status}`, 400);
}

export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}
