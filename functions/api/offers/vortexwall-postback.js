/**
 * functions/api/offers/vortexwall-postback.js
 *
 * VortexWall publisher postback (server-to-server conversion callback).
 * Type B (iframe-only) provider — placement configured at
 * publisher.vortexwall.com/placement.
 *
 * Callback URL to paste into the VortexWall placement modal:
 *
 *   https://earn-bangla.com/api/offers/vortexwall-postback
 *     ?identity_id={IDENTITY_ID}&campaign_id={CAMPAIGN_ID}
 *     &campaign_name={CAMPAIGN_NAME}&event_id={EVENT_ID}
 *     &event_name={EVENT_NAME}&payout={PAYOUT}&points={POINTS}
 *     &txid={TXID}&result={RESULT}&ipaddr={IPADDR}
 *     &sub1={SUB1}&sub2={SUB2}&hash={HASH}
 *
 * ── Signature (CONFIRMED, not guessed) ──────────────────────────────
 * Captured a real "Test CallBack" via a debug/logging version of this
 * file (see wrangler tail output), then brute-forced common
 * concatenation patterns against the real {hash} value + the real
 * secret key from the VortexWall dashboard. Exactly one formula
 * matched:
 *
 *   hash = SHA256(identity_id + campaign_id + txid + secret)
 *
 * No separator between fields, in that exact order. SHA-256 (64 hex
 * chars) is natively supported by Cloudflare's Web Crypto API, so no
 * custom MD5 implementation is needed here (unlike Offery/Revtoo/
 * Admantum/RadiantWall/PaidBucksy).
 *
 * ── Points vs payout ─────────────────────────────────────────────────
 * VortexWall computes {points} on their side already using the
 * Exchange Rate set in the placement (1000 coins = $1 here), e.g.
 * payout=1 -> points=1000 in the captured test. So we credit
 * `points` directly as coins_earned — we do NOT recompute
 * payout * COINS_PER_DOLLAR ourselves like the other providers.
 *
 * ── {result} values ──────────────────────────────────────────────────
 * Confirmed: "completed" for a normal successful conversion (from the
 * real Test CallBack). NOT confirmed: what value VortexWall sends for
 * a chargeback/reversal. Public docs weren't found and the dashboard's
 * Test CallBack tool only appears to simulate a normal conversion.
 *
 * Until a real reversal example is captured, this file ONLY credits on
 * result === "completed" and treats every other result value as
 * "not a creditable conversion" (ignored, 200 OK, nothing written to
 * the DB) rather than guessing a reversal/decrement branch — see
 * OFFERWALL-MASTER-GUIDE.md §৭ on why guessing signature/status
 * formulas silently breaks things. If VortexWall later sends a
 * chargeback postback, log it first (same debug-logging technique used
 * to find the hash formula) before writing the decrement logic.
 */

const PROVIDER = "vortexwall";

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readParams(request) {
  // VortexWall sends everything in the query string (confirmed from the
  // captured test callback — GET request, empty body).
  const url = new URL(request.url);
  const q = url.searchParams;
  return {
    userId: q.get("identity_id") || "",
    campaignId: q.get("campaign_id") || "",
    campaignName: q.get("campaign_name") || "",
    payout: q.get("payout") || "0",
    points: q.get("points") || "0",
    txid: q.get("txid") || "",
    result: q.get("result") || "",
    hash: q.get("hash") || "",
  };
}

async function handlePostback(request, env) {
  const p = readParams(request);

  // 1. Required params.
  if (!p.userId || !p.campaignId || !p.txid) {
    return jsonResponse(
      { status: "error", message: "Missing identity_id, campaign_id, or txid." },
      400
    );
  }

  // 2. Signature check — confirmed formula, see header comment.
  const secret = env.VORTEXWALL_SECRET_KEY || "";
  if (!secret) {
    return jsonResponse({ status: "error", message: "Server not configured." }, 500);
  }
  const expectedHash = await sha256Hex(p.userId + p.campaignId + p.txid + secret);
  if (!timingSafeEqual(p.hash, expectedHash)) {
    return jsonResponse({ status: "error", message: "Invalid signature." }, 403);
  }

  // 3. Only credit on a confirmed successful conversion. See header
  //    comment — reversal/chargeback result value is not confirmed yet.
  if (p.result !== "completed") {
    return jsonResponse({ status: "ignored", result: p.result }, 200);
  }

  const points = Math.max(0, Math.round(Number.parseFloat(p.points) || 0));
  const payout = Number.parseFloat(p.payout) || 0;

  // 4. Duplicate check — provider + transaction_id, per
  //    OFFERWALL-MASTER-GUIDE.md §৪.
  const existing = await env.DB.prepare(
    "SELECT id FROM offer_completions WHERE provider = ? AND transaction_id = ?"
  )
    .bind(PROVIDER, p.txid)
    .first();

  if (existing) {
    return jsonResponse({ status: "duplicate" }, 200);
  }

  // 5. Credit the user — coins, completed_offers, and total_earning
  //    together (see §৭ fixed-bug note).
  const update = await env.DB.prepare(
    `UPDATE users
     SET coins = coins + ?,
         completed_offers = completed_offers + 1,
         total_earning = total_earning + ?
     WHERE id = ?`
  )
    .bind(points, payout, p.userId)
    .run();

  if (!update.meta || update.meta.changes === 0) {
    return jsonResponse({ status: "error", message: "User not found." }, 404);
  }

  // 6. Record the completion (exact column order/names per
  //    OFFERWALL-MASTER-GUIDE.md §৪ — never reorder these).
  await env.DB.prepare(
    `INSERT INTO offer_completions
       (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  )
    .bind(PROVIDER, p.userId, p.campaignId, p.txid, payout, points)
    .run();

  return jsonResponse({ status: "credited", coins: points }, 200);
}

export async function onRequestGet(context) {
  return handlePostback(context.request, context.env);
}

export async function onRequestPost(context) {
  return handlePostback(context.request, context.env);
}
