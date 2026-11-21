// functions/api/offers/paidbucksy-postback.js
//
// Receives server-to-server postbacks from PaidBucksy. PaidBucksy calls this
// URL with an HTTP GET, substituting the macros you set in the Site Postback
// URL field of the placement:
//
//   user_id         - any user id (we do NOT check it against the users table)
//   transaction_id  - PaidBucksy's unique id for this completion
//   reward          - coins (absolute value; `status` says add or subtract)
//   payout          - offer payout in USD
//   status          - "1" = credit, "2" = revoke / chargeback
//   signature       - MD5(user_id + transaction_id + reward + SECRET_KEY)
//   campaign_id     - PaidBucksy's offer id (stored as offer_id)
//   offer_name, country, ip - logged only
//
// Response body: "OK" for a new transaction, "DUP" for an already-processed
// one (PaidBucksy retries up to 5 times on anything else).
//
// BEHAVIOR (same as offery-postback.js):
//   - Every valid, correctly-signed postback is ALWAYS saved to
//     offer_completions, even if no matching user exists in `users`
//     (e.g. PaidBucksy's test button with a dummy user_id, or wall-approval
//     testing). If a matching user exists, their coins / completed_offers /
//     total_earning are updated too; if not, only the row is recorded.
//   - Revoke (status=2) marks the row 'chargeback' and reverses the user's
//     totals if that user exists.
//
// Requires env.PAIDBUCKSY_SECRET_KEY:
//   wrangler pages secret put PAIDBUCKSY_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put PAIDBUCKSY_SECRET_KEY --project-name=earnbangla --env preview
//
// Uses the existing offer_completions columns (transaction_id, status).
// Recommended (prevents double-credit races on retries):
//   CREATE UNIQUE INDEX IF NOT EXISTS idx_oc_provider_tx
//     ON offer_completions(provider, transaction_id);

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

// Minimal, dependency-free MD5 (hex). Web Crypto has no MD5.
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
  const rewardRaw = String(params.reward ?? ""); // raw string for signature
  const reward = parseFloat(rewardRaw);
  const status = String(params.status || "1");
  const signature = String(params.signature || "").toLowerCase();

  const secret = env.PAIDBUCKSY_SECRET_KEY || "";
  if (!secret) return fail("Server not configured (missing PAIDBUCKSY_SECRET_KEY).", 500);

  // 1. Verify signature
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
      `SELECT id, user_id, coins_earned FROM offer_completions
       WHERE provider = 'paidbucksy' AND transaction_id = ? AND status = 'credited'`
    ).bind(transactionId).first();

    if (!existing) {
      // Never credited or already reversed — still OK.
      return ok();
    }

    // Atomic: reverse user totals (no-op if user doesn't exist) + mark row.
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE users
         SET coins = MAX(coins - ?, 0),
             completed_offers = MAX(completed_offers - 1, 0),
             total_earning = MAX(total_earning - ?, 0)
         WHERE id = ?`
      ).bind(existing.coins_earned, existing.coins_earned, existing.user_id),
      env.DB.prepare(`UPDATE offer_completions SET status = 'chargeback' WHERE id = ?`)
        .bind(existing.id),
    ]);

    return ok();
  }

  // ---- Credit ----
  const existing = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'paidbucksy' AND transaction_id = ?`
  ).bind(transactionId).first();

  if (existing) return dup();

  // Atomic: record the completion ALWAYS, and bump the user's totals only if
  // that user exists (UPDATE simply changes 0 rows for an unknown user_id).
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
         VALUES ('paidbucksy', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
      ).bind(userId, campaignId, transactionId, parseFloat(params.payout) || 0, coins),
      env.DB.prepare(
        `UPDATE users
         SET coins = coins + ?,
             completed_offers = completed_offers + 1,
             total_earning = total_earning + ?
         WHERE id = ?`
      ).bind(coins, coins, userId),
    ]);
  } catch (err) {
    // A concurrent retry may have inserted the same transaction first
    // (only possible if the UNIQUE index exists) — treat as duplicate.
    const again = await env.DB.prepare(
      `SELECT id FROM offer_completions WHERE provider = 'paidbucksy' AND transaction_id = ?`
    ).bind(transactionId).first();
    if (again) return dup();
    throw err;
  }

  return ok();
}

export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}