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
 * ── Signature (CONFIRMED) ────────────────────────────────────────────
 *   hash = SHA256(identity_id + campaign_id + txid + secret)
 * No separator between fields, in that exact order.
 *
 * IMPORTANT confirmed limitation: a completed test and a rejected test
 * sent with the same identity_id/campaign_id/txid produced the exact
 * same hash, even though payout/points/result all differed. So the
 * signature does NOT cover payout, points, or result — anyone who
 * captures one valid hash for a given identity/campaign/txid could in
 * principle replay it with a different payout/result. Because of this,
 * the reversal branch below deliberately does NOT trust the incoming
 * payout/points on a rejection — it looks up and reuses the amounts
 * from our own previously-stored "credited" row for that txid instead.
 *
 * ── Points vs payout ─────────────────────────────────────────────────
 * VortexWall computes {points} on their side already using the
 * Exchange Rate set in the placement (1000 coins = $1 here), e.g.
 * payout=2 -> points=2000. So on a completed conversion we credit
 * `points` directly as coins_earned — we do NOT recompute
 * payout * COINS_PER_DOLLAR ourselves like the other providers.
 *
 * ── {result} values ──────────────────────────────────────────────────
 * Confirmed via real Test CallBacks:
 *   - "completed" → normal successful conversion, credit the user.
 *   - "rejected"  → reversal of a previous "completed" conversion with
 *                   the SAME txid. VortexWall sends payout/points as
 *                   negative mirrors of the original (e.g. payout=-2,
 *                   points=-2000 after an original payout=2/points=2000),
 *                   but per the note above we ignore those numbers and
 *                   reverse using our own stored record instead.
 * Any other {result} value is unrecognized — logged and ignored (200
 * OK, nothing written) rather than guessed, per
 * OFFERWALL-MASTER-GUIDE.md §৭.
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
  // captured test callbacks — GET request, empty body).
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

async function handleCompleted(p, env) {
  const points = Math.max(0, Math.round(Number.parseFloat(p.points) || 0));
  const payout = Number.parseFloat(p.payout) || 0;

  // Duplicate check — provider + transaction_id + status, so a later
  // "rejected" postback with the same txid is never mistaken for a
  // duplicate of this "completed" one.
  const existing = await env.DB.prepare(
    "SELECT id FROM offer_completions WHERE provider = ? AND transaction_id = ? AND status = 'credited'"
  )
    .bind(PROVIDER, p.txid)
    .first();

  if (existing) {
    return jsonResponse({ status: "duplicate" }, 200);
  }

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

  await env.DB.prepare(
    `INSERT INTO offer_completions
       (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  )
    .bind(PROVIDER, p.userId, p.campaignId, p.txid, payout, points)
    .run();

  return jsonResponse({ status: "credited", coins: points }, 200);
}

async function handleRejected(p, env) {
  // Only reverse a txid we actually credited before. This also means a
  // "rejected" that arrives with no matching prior "completed" (bad
  // txid, replay, or the conversion was never credited in the first
  // place) is safely ignored instead of decrementing anyone.
  const original = await env.DB.prepare(
    "SELECT id, user_id, payout, coins_earned FROM offer_completions WHERE provider = ? AND transaction_id = ? AND status = 'credited'"
  )
    .bind(PROVIDER, p.txid)
    .first();

  if (!original) {
    console.log(
      "VORTEXWALL rejected_no_matching_credit",
      JSON.stringify({ txid: p.txid, userId: p.userId })
    );
    return jsonResponse({ status: "ignored", reason: "no matching credited txn" }, 200);
  }

  // Don't reverse the same txid twice.
  const alreadyReversed = await env.DB.prepare(
    "SELECT id FROM offer_completions WHERE provider = ? AND transaction_id = ? AND status = 'reversed'"
  )
    .bind(PROVIDER, p.txid)
    .first();

  if (alreadyReversed) {
    return jsonResponse({ status: "duplicate" }, 200);
  }

  // Sanity check: the rejection's identity_id should match the user we
  // originally credited. If it doesn't, something is wrong (spoofed or
  // mismatched params) — log it and don't touch anyone's balance.
  if (original.user_id !== p.userId) {
    console.log(
      "VORTEXWALL rejected_user_mismatch",
      JSON.stringify({ txid: p.txid, originalUserId: original.user_id, postbackUserId: p.userId })
    );
    return jsonResponse({ status: "ignored", reason: "user mismatch" }, 200);
  }

  // Reverse using OUR stored amounts, not the incoming payout/points —
  // see header comment on why the incoming numbers aren't trusted.
  await env.DB.prepare(
    `UPDATE users
     SET coins = MAX(0, coins - ?),
         completed_offers = MAX(0, completed_offers - 1),
         total_earning = MAX(0, total_earning - ?)
     WHERE id = ?`
  )
    .bind(original.coins_earned, original.payout, p.userId)
    .run();

  await env.DB.prepare(
    `INSERT INTO offer_completions
       (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'reversed', datetime('now'))`
  )
    .bind(PROVIDER, p.userId, p.campaignId, p.txid, -original.payout, -original.coins_earned)
    .run();

  return jsonResponse({ status: "reversed" }, 200);
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

  // 3. Route by confirmed result value.
  if (p.result === "completed") {
    return handleCompleted(p, env);
  }

  if (p.result === "rejected") {
    return handleRejected(p, env);
  }

  console.log("VORTEXWALL unrecognized_result", JSON.stringify({ result: p.result, txid: p.txid }));
  return jsonResponse({ status: "ignored", result: p.result }, 200);
}

export async function onRequestGet(context) {
  return handlePostback(context.request, context.env);
}

export async function onRequestPost(context) {
  return handlePostback(context.request, context.env);
}