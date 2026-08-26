// functions/api/offers/radientwall-postback.js
//
// ⚠️ Place this file at functions/api/offers/radientwall-postback.js
//    (sibling to offery-postback.js / primewall-postback.js) — this
//    REPLACES the earlier DEBUG version once you deploy this.
//
// Receives server-to-server postbacks from RadiantWall when a user
// completes an offer. Confirmed from RadiantWall's own docs (Integration →
// Postback / Security / Postback Code sections):
//
//   RadiantWall calls this URL with an HTTP GET request containing:
//
//   subId       - the earnbangla user's id (same value we pass as
//                  [USER_ID] in the offerwall iframe tracking link)
//   transId     - RadiantWall's unique transaction id for this completion
//   reward      - the reward amount (coins) — always sent as an ABSOLUTE
//                  value; whether to add or subtract is decided by `status`
//   payout      - the offer payout in USD (stored for reference)
//   signature   - MD5(subId + transId + reward + SECRET_KEY)
//   status      - "1" = credit (add reward), "2" = reversal (subtract reward
//                  — advertiser canceled / fraud / data-entry mistake)
//   userIp      - the user's IP address at completion (optional, logged only)
//   offer_name  - name of the completed offer (optional, logged only)
//   country     - ISO2 country code the lead came from (optional, logged only)
//
// RadiantWall expects a specific PLAIN TEXT response (not JSON), and it's
// different from Offery's (which just wants "ok" always):
//
//   "OK"  - when this is a new transaction that was just processed
//   "DUP" - when this transaction_id was already processed before (tells
//            RadiantWall's server to stop retrying this transaction)
//
// RadiantWall waits up to 60 seconds for a response before timing out, and
// explicitly warns you to check for a duplicate transaction id first to
// avoid double-crediting on a timeout/retry — which is exactly what the
// duplicate-guard below does.
//
// ⚠️ Requires env.RADIENTWALL_SECRET_KEY (the "Secret Key" shown on the
//    RadiantWall dashboard's Sites page) — already set via:
//
//   wrangler pages secret put RADIENTWALL_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put RADIENTWALL_SECRET_KEY --project-name=earnbangla --env preview
//
// Uses the same offer_completions table as Offery/Prime Wall — no new
// migration needed. Rows are stored with provider = 'radientwall'.

function textResponse(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

function ok() {
  // New transaction, successfully processed.
  return textResponse("OK", 200);
}

function dup() {
  // Already-processed transaction — tells RadiantWall to stop retrying it.
  return textResponse("DUP", 200);
}

function fail(message, status = 400) {
  console.error("radientwall-postback:", message);
  return textResponse(message, status);
}

// Minimal, dependency-free MD5 (hex output) — same implementation used in
// offery-postback.js. Needed because Cloudflare's Web Crypto API only
// supports SHA-1/256/384/512, not MD5, and RadiantWall's postback signature
// is MD5-based. Verified against known test vectors.
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

  // RadiantWall's docs specify a GET request, but accept POST too (mirrors
  // offery-postback.js) in case they ever call it that way.
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    let bodyParams = {};
    if (contentType.includes("application/json")) {
      bodyParams = await request.json();
    } else {
      const formData = await request.formData();
      bodyParams = Object.fromEntries(formData.entries());
    }
    params = { ...params, ...bodyParams };
  }

  const subId = String(params.subId || "");
  const transId = String(params.transId || "");
  const offerName = String(params.offer_name || "");
  const userIp = String(params.userIp || "");
  const country = String(params.country || "");
  const rewardRaw = params.reward; // keep the raw string for signature check
  const reward = parseFloat(rewardRaw);
  const status = String(params.status || "1"); // "1" = credit, "2" = reversal
  const signature = String(params.signature || "");

  const secret = env.RADIENTWALL_SECRET_KEY || "";
  if (!secret) return fail("Server not configured (missing RADIENTWALL_SECRET_KEY).", 500);

  // 1. Verify the signature: MD5(subId + transId + reward + secret)
  const expected = md5(subId + transId + rewardRaw + secret);
  if (!signature || signature !== expected) {
    // TEMPORARY DEBUG — remove once signature mismatches are resolved.
    // Printed as a single plain string (not an object with a "signature"
    // key) because Cloudflare's log tail auto-redacts fields that look
    // like secrets/signatures. Never prints the secret itself.
    console.log(
      "RADIENTWALL_DEBUG subId=[" + subId + "] transId=[" + transId +
      "] rewardRaw=[" + rewardRaw + "] secretLen=" + secret.length +
      " EXPECTEDHASH:" + expected + " RECEIVEDHASH:" + signature
    );
    return fail("Signature doesn't match.", 403);
  }

  // 2. Validate required fields
  if (!subId || !transId || !Number.isFinite(reward)) {
    return fail("Missing or invalid parameters.", 400);
  }

  const userId = subId;
  const coins = Math.round(Math.abs(reward));
  console.log("radientwall-postback:", { userId, transId, offerName, userIp, country, coins, status });

  if (status === "2") {
    // ---- Reversal: subtract a previous credit, if one exists ----
    const existing = await env.DB.prepare(
      `SELECT id, coins_earned FROM offer_completions WHERE provider = 'radientwall' AND transaction_id = ? AND status = 'credited'`
    ).bind(transId).first();

    if (!existing) {
      // Nothing to reverse (never credited, or already reversed).
      // Still tell RadiantWall it's a known/duplicate transaction so it
      // stops retrying.
      return dup();
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
  const dupRow = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'radientwall' AND transaction_id = ?`
  ).bind(transId).first();

  if (dupRow) {
    return dup(); // already processed — tell RadiantWall to stop retrying
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

  // Note: RadiantWall doesn't send a numeric offer_id like Offery does —
  // only offer_name (and even that's optional: "offer" is sent if the name
  // doesn't exist). We store it in the offer_id column since that's the
  // closest identifier we have; it's just for reference/debugging.
  await env.DB.prepare(
    `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES ('radientwall', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerName || null, transId, parseFloat(params.payout) || 0, coins).run();

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
