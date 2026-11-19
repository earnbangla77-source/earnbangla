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
 * IMPORTANT confirmed limitation: the signature does NOT cover payout,
 * points, or result. So the reversal branch does NOT trust the incoming
 * payout/points on a rejection — it reuses the amounts from our own
 * previously-stored "credited" row for that txid.
 *
 * ── Points vs payout ─────────────────────────────────────────────────
 * VortexWall already computes {points} using the placement's Exchange
 * Rate (1000 coins = $1). We credit `points` directly as coins_earned.
 *
 * ── {result} values (confirmed) ──────────────────────────────────────
 *   "completed" → credit the user.
 *   "rejected"  → reversal of a previous "completed" with the SAME txid.
 *   anything else → logged and ignored (200 OK, nothing written).
 *
 * ── Same behavior as offery-postback.js / PrimeWall ──────────────────
 * When the signature is valid, a "completed" postback is ALWAYS saved to
 * offer_completions as 'credited', even if no matching user exists in
 * the users table (in that case no user's balance changes, but the row
 * is still recorded so it shows in the admin Activity Log). Always
 * returns 200 so VortexWall marks the postback as successful.
 *
 * ── Debug logging ────────────────────────────────────────────────────
 * Every branch logs a line starting with "VW" — watch with:
 *   wrangler pages deployment tail --project-name=earnbangla --format=pretty
 * The secret and full hash are never logged (only the first 8 chars of
 * the hash and the secret's length, enough to tell a mismatch apart).
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
  // VortexWall sends everything in the query string (GET, empty body).
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
    hash: (q.get("hash") || "").trim().toLowerCase(),
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
    console.log("VW DUPLICATE", p.txid);
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

  // Same as offery-postback.js: the completion is saved even when no
  // matching user exists (no balance changes in that case).
  const matched = !!(update.meta && update.meta.changes > 0);
  if (!matched) {
    console.log("VW no_matching_user, recorded anyway | id:", p.userId, "| tx:", p.txid);
  }

  await env.DB.prepare(
    `INSERT INTO offer_completions
       (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  )
    .bind(PROVIDER, p.userId, p.campaignId, p.txid, payout, points)
    .run();

  console.log("VW CREDITED | user:", p.userId, "| coins:", points, "| matched:", matched);
  return jsonResponse({ status: "credited", coins: points, user_matched: matched }, 200);
}

async function handleRejected(p, env) {
  // Only reverse a txid we actually credited before.
  const original = await env.DB.prepare(
    "SELECT id, user_id, payout, coins_earned FROM offer_completions WHERE provider = ? AND transaction_id = ? AND status = 'credited'"
  )
    .bind(PROVIDER, p.txid)
    .first();

  if (!original) {
    console.log("VW rejected_no_matching_credit | tx:", p.txid, "| user:", p.userId);
    return jsonResponse({ status: "ignored", reason: "no matching credited txn" }, 200);
  }

  // Don't reverse the same txid twice.
  const alreadyReversed = await env.DB.prepare(
    "SELECT id FROM offer_completions WHERE provider = ? AND transaction_id = ? AND status = 'reversed'"
  )
    .bind(PROVIDER, p.txid)
    .first();

  if (alreadyReversed) {
    console.log("VW rejected_already_reversed | tx:", p.txid);
    return jsonResponse({ status: "duplicate" }, 200);
  }

  // Sanity check: the rejection's identity_id must match the user we
  // originally credited, otherwise don't touch anyone's balance.
  if (original.user_id !== p.userId) {
    console.log(
      "VW rejected_user_mismatch | tx:", p.txid,
      "| original:", original.user_id,
      "| postback:", p.userId
    );
    return jsonResponse({ status: "ignored", reason: "user mismatch" }, 200);
  }

  // Reverse using OUR stored amounts, not the incoming payout/points.
  // (If the user never existed, this UPDATE simply changes 0 rows.)
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

  console.log("VW REVERSED | user:", p.userId, "| coins:", original.coins_earned, "| tx:", p.txid);
  return jsonResponse({ status: "reversed" }, 200);
}

async function handlePostback(request, env) {
  const p = readParams(request);
  console.log(
    "VW received | result:", p.result,
    "| user:", p.userId,
    "| camp:", p.campaignId,
    "| tx:", p.txid,
    "| hasHash:", !!p.hash
  );

  // 1. Required params.
  if (!p.userId || !p.campaignId || !p.txid) {
    console.log("VW FAIL missing_params");
    return jsonResponse(
      { status: "error", message: "Missing identity_id, campaign_id, or txid." },
      400
    );
  }

  // 2. Signature check — confirmed formula, see header comment.
  const secret = (env.VORTEXWALL_SECRET_KEY || "").trim();
  if (!secret) {
    console.log("VW FAIL no_secret_configured");
    return jsonResponse({ status: "error", message: "Server not configured." }, 500);
  }
  const expectedHash = await sha256Hex(p.userId + p.campaignId + p.txid + secret);
  if (!timingSafeEqual(p.hash, expectedHash)) {
    console.log(
      "VW FAIL bad_signature | got:", p.hash.slice(0, 8),
      "| expected:", expectedHash.slice(0, 8),
      "| secretLen:", secret.length
    );
    return jsonResponse({ status: "error", message: "Invalid signature." }, 403);
  }
  console.log("VW signature_ok");

  // 3. Route by confirmed result value.
  if (p.result === "completed") {
    return handleCompleted(p, env);
  }

  if (p.result === "rejected") {
    return handleRejected(p, env);
  }

  console.log("VW IGNORED unrecognized_result:", p.result, "| tx:", p.txid);
  return jsonResponse({ status: "ignored", result: p.result }, 200);
}

async function safeHandle(context) {
  try {
    return await handlePostback(context.request, context.env);
  } catch (err) {
    console.log("VW EXCEPTION", err && err.message ? err.message : String(err));
    return jsonResponse({ status: "error", message: "Server error." }, 500);
  }
}

export async function onRequestGet(context) {
  return safeHandle(context);
}

export async function onRequestPost(context) {
  return safeHandle(context);
}