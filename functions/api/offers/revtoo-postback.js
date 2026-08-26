// functions/api/offers/revtoo-postback.js
//
// ⚠️ Place this file at functions/api/offers/revtoo-postback.js
//    (sibling to cpagrip-postback.js and offery-postback.js)
//
// Receives server-to-server postbacks from Revtoo (revtoo.com) when a user
// completes an offer. Confirmed against Revtoo's own docs
// (docs.revtoo.com/s2s-postback/*) — their postback contract is byte-for-byte
// the same as Offery's (same whitelabel offerwall platform under the hood),
// so this file is a straight port of offery-postback.js with the provider
// name swapped.
//
// Revtoo calls this URL with GET (matches "Postback Method: GET" on the
// placement) with the macros substituted:
//
//   subId         - the earnbangla user's id (same value we pass as
//                    user_id in the offer feed request / redirect links)
//   transId       - Revtoo's unique transaction id for this completion
//   offer_id      - Revtoo's offer id
//   offer_name    - offer name (logged only, not stored)
//   offer_type    - offer/survey/video/ptc etc (logged only, not stored)
//   reward        - coins to credit — ALREADY converted using the Currency
//                    Name / Exchange Rate set on the Revtoo placement.
//                    Keep those two in sync with this file:
//                      Currency Name  = Points
//                      Exchange Rate  = 1000.00  (1000 coins = $1.00, same
//                                                  rate as CPAGrip/Offery)
//                      Currency Round = 0         (your coins column is INTEGER)
//   payout        - offer payout in USD (stored for reference)
//   status        - "1" = credit, "2" = chargeback (reverse a previous credit)
//   userIp        - user's IP at completion (logged only, not stored)
//   country       - ISO2 country of the lead (logged only, not stored)
//   debug         - "1" = test postback, "0" = live (logged only, not stored)
//   signature     - MD5(subId + transId + reward + SECRET_KEY)
//
// Revtoo expects the raw text "ok" back — NOT JSON — on success, same as
// CPAGrip's/Offery's contract differences already handled elsewhere in this
// codebase. Anything else and Revtoo marks the postback failed (and lets you
// resend it manually from their dashboard).
//
// ⚠️ Requires env.REVTOO_SECRET_KEY (the "Secret Key" shown on your Revtoo
//    placement once it's approved):
//
//   wrangler pages secret put REVTOO_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put REVTOO_SECRET_KEY --project-name=earnbangla --env preview
//
// ⚠️ Reuses the offer_completions.transaction_id + status columns that were
//    already added for Offery (offery-schema-addition.sql) — NO new D1
//    migration is needed for Revtoo, this just inserts rows with
//    provider = 'revtoo'.
//
// Includes the earnings-tracking fix from day one (the one that had to be
// retrofitted into offery-postback.js): crediting a completion bumps
// users.completed_offers and users.total_earning, not just users.coins.
// Chargebacks reverse all three. (users.earnings_30d is computed live in
// functions/api/auth/me.js from offer_completions, so nothing extra needed
// here for that.)

function ok() {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("revtoo-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

// Minimal, dependency-free MD5 (hex output). Needed because Cloudflare's
// Web Crypto API only supports SHA-1/256/384/512, not MD5, and Revtoo's
// postback signature is MD5-based (same as Offery's — verified against
// known test vectors).
function md5(input) {
  function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
  function toHex(num) {
    let s = "";
    for (let i = 0; i < 4; i++) s += ((num >> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    return s;
  }
  const K = new Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const utf8 = new TextEncoder().encode(input);
  const bitLen = utf8.length * 8;
  const bytes = Array.from(utf8);
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = new Array(16);
    for (let j = 0; j < 16; j++) {
      const o = chunk + j * 4;
      M[j] = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

async function handlePostback(request, env) {
  const url = new URL(request.url);
  let params = Object.fromEntries(url.searchParams.entries());

  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    let bodyParams = {};
    if (contentType.includes("application/json")) {
      bodyParams = await request.json();
    } else {
      // Revtoo's docs say POST postbacks use multipart/form-data.
      const formData = await request.formData();
      bodyParams = Object.fromEntries(formData.entries());
    }
    params = { ...params, ...bodyParams };
  }

  const subId = String(params.subId || "");
  const transId = String(params.transId || "");
  const offerId = String(params.offer_id || "");
  const offerName = String(params.offer_name || "");
  const rewardRaw = params.reward; // keep the raw string for signature check
  const reward = parseFloat(rewardRaw);
  const status = String(params.status || "1");
  const signature = String(params.signature || "");

  const secret = env.REVTOO_SECRET_KEY || "";
  if (!secret) return fail("Server not configured (missing REVTOO_SECRET_KEY).", 500);

  // 1. Verify the signature — MD5(subId + transId + reward + secret)
  const expected = md5(subId + transId + rewardRaw + secret);
  if (!signature || signature !== expected) {
    return fail("Signature doesn't match.", 403);
  }

  // 2. Validate required fields
  if (!subId || !transId || !Number.isFinite(reward)) {
    return fail("Missing or invalid parameters.", 400);
  }

  const userId = subId;
  const coins = Math.round(Math.abs(reward));
  console.log("revtoo-postback:", { userId, transId, offerId, offerName, coins, status });

  if (status === "2") {
    // ---- Chargeback: reverse a previous credit, if one exists ----
    const existing = await env.DB.prepare(
      `SELECT id, coins_earned FROM offer_completions WHERE provider = 'revtoo' AND transaction_id = ? AND status = 'credited'`
    ).bind(transId).first();

    if (!existing) {
      // Nothing to reverse (never credited, or already reversed) — still ok.
      return ok();
    }

    await env.DB.prepare(
      `UPDATE users
       SET coins = MAX(coins - ?, 0),
           completed_offers = MAX(completed_offers - 1, 0),
           total_earning = MAX(total_earning - ?, 0)
       WHERE id = ?`
    ).bind(existing.coins_earned, existing.coins_earned, userId).run();

    await env.DB.prepare(`UPDATE offer_completions SET status = 'chargeback' WHERE id = ?`)
      .bind(existing.id).run();

    return ok();
  }

  // ---- Credit ----
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'revtoo' AND transaction_id = ?`
  ).bind(transId).first();

  if (dup) {
    return ok(); // already processed — idempotent, don't double-credit
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
     VALUES ('revtoo', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerId, transId, parseFloat(params.payout) || 0, coins).run();

  return ok();
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}

export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}
