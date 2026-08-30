/**
 * functions/api/offers/vortexwall-postback.js
 *
 * VortexWall publisher postback (server-to-server conversion callback).
 * Type B (iframe-only) provider — placement configured at
 * publisher.vortexwall.com/placement.
 *
 * ⚠️ DEBUG BUILD — this version adds console.log() at every branch so
 * `wrangler pages deployment tail --project-name=earnbangla` shows
 * exactly which check a given callback hit (missing params / no
 * secret / bad signature / ignored non-"completed" result / duplicate
 * / user-not-found / credited). No behavior is changed from the
 * production file — same signature formula, same "only credit on
 * result === 'completed'" rule. Once the completed + rejected
 * same-txid test is done and the result is understood, swap this back
 * for a clean version (drop the console.log lines, and add the
 * reversal branch if the test confirms one is needed).
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
 *   hash = SHA256(identity_id + campaign_id + txid + secret)
 * No separator between fields, in that exact order.
 *
 * ── Points vs payout ─────────────────────────────────────────────────
 * VortexWall computes {points} on their side already using the
 * Exchange Rate set in the placement (1000 coins = $1 here), e.g.
 * payout=1 -> points=1000. So we credit `points` directly as
 * coins_earned — we do NOT recompute payout * COINS_PER_DOLLAR
 * ourselves like the other providers.
 *
 * ── {result} values ──────────────────────────────────────────────────
 * Confirmed: "completed" for a normal successful conversion.
 * Being confirmed right now: what {result} + {txid} look like for a
 * rejected/chargeback test sent with the SAME txid as a prior
 * completed test — that's what this debug build is for. Until that's
 * fully understood, this file still ONLY credits on
 * result === "completed" and treats every other result value as
 * "not a creditable conversion" (ignored, 200 OK, nothing written to
 * the DB) rather than guessing a reversal/decrement branch — see
 * OFFERWALL-MASTER-GUIDE.md §৭ on why guessing signature/status
 * formulas silently breaks things.
 */

const PROVIDER = "vortexwall";
const DEBUG_TAG = "VORTEXWALL_DEBUG";

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
  console.log(`${DEBUG_TAG} received`, JSON.stringify(p));

  // 1. Required params.
  if (!p.userId || !p.campaignId || !p.txid) {
    console.log(`${DEBUG_TAG} FAIL missing_params`, JSON.stringify(p));
    return jsonResponse(
      { status: "error", message: "Missing identity_id, campaign_id, or txid." },
      400
    );
  }

  // 2. Signature check — confirmed formula, see header comment.
  const secret = env.VORTEXWALL_SECRET_KEY || "";
  if (!secret) {
    console.log(`${DEBUG_TAG} FAIL no_secret_configured`);
    return jsonResponse({ status: "error", message: "Server not configured." }, 500);
  }
  const expectedHash = await sha256Hex(p.userId + p.campaignId + p.txid + secret);
  if (!timingSafeEqual(p.hash, expectedHash)) {
    console.log(
      `${DEBUG_TAG} FAIL bad_signature`,
      JSON.stringify({
        received_hash: p.hash,
        expected_hash: expectedHash,
        userId: p.userId,
        campaignId: p.campaignId,
        txid: p.txid,
      })
    );
    return jsonResponse({ status: "error", message: "Invalid signature." }, 403);
  }
  console.log(`${DEBUG_TAG} signature_ok`);

  // 3. Only credit on a confirmed successful conversion. See header
  //    comment — reversal/chargeback result value is being confirmed now.
  if (p.result !== "completed") {
    console.log(`${DEBUG_TAG} IGNORED non_completed_result`, JSON.stringify({
      result: p.result,
      txid: p.txid,
      userId: p.userId,
      payout: p.payout,
      points: p.points,
    }));
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
    console.log(`${DEBUG_TAG} DUPLICATE`, JSON.stringify({ txid: p.txid, existingRowId: existing.id }));
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
    console.log(`${DEBUG_TAG} FAIL user_not_found`, JSON.stringify({ userId: p.userId }));
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

  console.log(`${DEBUG_TAG} CREDITED`, JSON.stringify({ userId: p.userId, txid: p.txid, points }));
  return jsonResponse({ status: "credited", coins: points }, 200);
}

export async function onRequestGet(context) {
  return handlePostback(context.request, context.env);
}

export async function onRequestPost(context) {
  return handlePostback(context.request, context.env);
}