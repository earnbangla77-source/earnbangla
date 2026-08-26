// functions/api/offers/paidbucksy-postback.js
//
// ⚠️ Place this file at functions/api/offers/paidbucksy-postback.js
//    (sibling to revtoo-postback.js, offery-postback.js, cpagrip-postback.js)
//
// Receives server-to-server postbacks from PaidBucksy (paidbucksy.com) when
// a user completes an offer. Built from PaidBucksy's own docs
// (paidbucksy.gitbook.io/paidbucksy/document/publish-your-docs) — NOT a
// straight port of offery-postback.js / revtoo-postback.js, because two
// things differ from those:
//
//   1) Parameter names: user_id / transaction_id (not subId / transId).
//   2) Expected response body: "OK" for a new transaction, "DUP" for a
//      transaction we've already processed — NOT the plain "ok" that
//      Offery/Revtoo expect. Getting this wrong makes PaidBucksy think the
//      postback failed and it will keep retrying (up to 5 times).
//
// PaidBucksy calls this URL with an HTTP GET, substituting the macros in
// curly braces you configured in the Site Postback URL field on the
// placement's Edit page:
//
//   user_id        - the earnbangla user's id (same value baked into the
//                     iframe src as [USER_ID] in earn.html)
//   transaction_id  - PaidBucksy's unique id for this completion
//   reward          - coins to credit (absolute value — check `status` to
//                      know whether to add or subtract)
//   payout          - offer payout in USD (stored for reference)
//   status          - "1" = add/credit, "2" = subtract/revoke (fraud or
//                      advertiser cancellation)
//   signature       - MD5(user_id + transaction_id + reward + SECRET_KEY)
//   campaign_id     - PaidBucksy's offer id (logged only, not stored)
//   offer_name      - offer name (logged only, not stored)
//   country         - ISO2 country of the lead (logged only, not stored)
//   ip              - user's IP at completion (logged only, not stored)
//
// ⚠️ Requires env.PAIDBUCKSY_SECRET_KEY (the Secret Key shown on the
//    PaidBucksy Placements list next to your API Key):
//
//   wrangler pages secret put PAIDBUCKSY_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put PAIDBUCKSY_SECRET_KEY --project-name=earnbangla --env preview
//
// ⚠️ Reuses the offer_completions.transaction_id + status columns that were
//    already added for Offery (offery-schema-addition.sql) — NO new D1
//    migration is needed for PaidBucksy, this just inserts rows with
//    provider = 'paidbucksy'.
//
// Same earnings-tracking behavior as offery/revtoo postback: crediting a
// completion bumps users.coins, users.completed_offers and
// users.total_earning; a revoke (status=2) reverses all three.

function ok() {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

function dup() {
  return new Response("DUP", { status: 200, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("paidbucksy-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

// Minimal, dependency-free MD5 (hex output). Needed because Cloudflare's
// Web Crypto API only supports SHA-1/256/384/512, not MD5, and PaidBucksy's
// postback signature is MD5-based (same primitive as Offery/Revtoo — this is
// the identical implementation already vetted against known test vectors in
// revtoo-postback.js).
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
  const params = Object.fromEntries(url.searchParams.entries());

  const userId = String(params.user_id || "");
  const transactionId = String(params.transaction_id || "");
  const campaignId = String(params.campaign_id || "");
  const offerName = String(params.offer_name || "");
  const rewardRaw = params.reward; // keep the raw string for signature check
  const reward = parseFloat(rewardRaw);
  const status = String(params.status || "1");
  const signature = String(params.signature || "");

  const secret = env.PAIDBUCKSY_SECRET_KEY || "";
  if (!secret) return fail("Server not configured (missing PAIDBUCKSY_SECRET_KEY).", 500);

  // 1. Verify the signature — MD5(user_id + transaction_id + reward + secret)
  const expected = md5(userId + transactionId + rewardRaw + secret);
  if (!signature || signature !== expected) {
    return fail("Signature doesn't match.", 403);
  }

  // 2. Validate required fields
  if (!userId || !transactionId || !Number.isFinite(reward)) {
    return fail("Missing or invalid parameters.", 400);
  }

  const coins = Math.round(Math.abs(reward));
  console.log("paidbucksy-postback:", { userId, transactionId, campaignId, offerName, coins, status });

  if (status === "2") {
    // ---- Revoke: reverse a previous credit, if one exists ----
    const existing = await env.DB.prepare(
      `SELECT id, coins_earned FROM offer_completions WHERE provider = 'paidbucksy' AND transaction_id = ? AND status = 'credited'`
    ).bind(transactionId).first();

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
  const existing = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'paidbucksy' AND transaction_id = ?`
  ).bind(transactionId).first();

  if (existing) {
    // Already processed — PaidBucksy expects "DUP" here so it stops retrying.
    return dup();
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
     VALUES ('paidbucksy', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, campaignId, transactionId, parseFloat(params.payout) || 0, coins).run();

  return ok();
}

// PaidBucksy's docs say their server makes an HTTP GET request for the
// postback, but this also accepts POST for parity with the other providers
// in this codebase (harmless — PaidBucksy just won't use it).
export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}
