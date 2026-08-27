// functions/api/offers/admantum-postback.js
//
// ⚠️ Place this file at functions/api/offers/admantum-postback.js
//    (sibling to offery-postback.js and revtoo-postback.js)
//
// Receives server-to-server postbacks from Admantum (admantum.com) when a
// user completes an offer. Confirmed against admantum.com/documentation:
//
//   uid              - the earnbangla user's id (same value sent as uid in
//                       the offer feed request, admantum-feed.js)
//   of_id            - Admantum's offer id (logged only, not stored as a
//                       separate column — folded into the synthetic
//                       transaction id below)
//   virtual_currency - coins to credit, ALREADY converted using the
//                       Exchange Rate set on the Admantum App (dashboard →
//                       Offerwalls → Manage Apps → Edit). Keep that rate in
//                       sync with admantum-feed.js's offer_virtual_currency
//                       passthrough.
//   status           - "1" = completion (credit), "0" = reversal (chargeback)
//   hash             - MD5(uid + of_id + virtual_currency + SECRET_KEY),
//                       NO separators between the parts
//   subid1           - optional passthrough sub id (logged only)
//
// ⚠️ Admantum does NOT send a unique transaction/conversion id (confirmed —
// their mandatory params are only uid and virtual_currency). So unlike
// Offery/Revtoo, there's no real transId to dedupe on. This file builds a
// synthetic one from `admantum-${uid}-${of_id}` instead. Trade-off: if an
// Admantum offer is repeatable (e.g. a daily survey), a second completion
// of the SAME offer by the SAME user will be silently treated as a
// duplicate and not re-credited. Ask Admantum support whether their offers
// are one-time-only; if any are repeatable, this needs a real unique key
// (e.g. incorporate a timestamp param if they'll add one).
//
// Admantum's dashboard Postback Test / Postback Url template shows the URL
// built with query-string params even though the docs call the method
// "POST" — so params are read from the URL query string first, with a
// POST-body fallback just in case.
//
// Admantum expects the exact response text "OK" (uppercase) on success —
// different from Revtoo's lowercase "ok".
//
// ⚠️ Requires env.ADMANTUM_SECRET_KEY (the "Secret Key" shown on the
//    Manage Apps page for this App):
//
//   wrangler pages secret put ADMANTUM_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put ADMANTUM_SECRET_KEY --project-name=earnbangla --env preview
//
// ⚠️ Reuses the same offer_completions table (provider, user_id, offer_id,
//    transaction_id, payout, coins_earned, status, created_at) already used
//    for Offery/Revtoo — NO new D1 migration needed, this just inserts rows
//    with provider = 'admantum'.
//
// Same earnings-tracking fix as Offery/Revtoo: crediting a completion bumps
// users.coins AND users.completed_offers AND users.total_earning, not just
// coins. Chargebacks reverse all three.

function ok() {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("admantum-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

// Minimal, dependency-free MD5 (hex output) — same implementation used in
// revtoo-postback.js. Needed because Cloudflare's Web Crypto API only
// supports SHA-1/256/384/512, not MD5.
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

  if (request.method === "POST" && Object.keys(params).length === 0) {
    const contentType = request.headers.get("content-type") || "";
    try {
      let bodyParams = {};
      if (contentType.includes("application/json")) {
        bodyParams = await request.json();
      } else if (contentType.includes("form")) {
        const formData = await request.formData();
        bodyParams = Object.fromEntries(formData.entries());
      }
      params = { ...params, ...bodyParams };
    } catch {
      // no/unparseable body — fine, params stays as the (empty) query string
    }
  }

  const uid = String(params.uid || "");
  const offerId = String(params.of_id || "");
  const amountRaw = params.virtual_currency; // keep raw string for the signature check
  const amount = parseFloat(amountRaw);
  const status = String(params.status || "1");
  const hash = String(params.hash || "");

  const secret = env.ADMANTUM_SECRET_KEY || "";
  if (!secret) return fail("Server not configured (missing ADMANTUM_SECRET_KEY).", 500);

  // 1. Verify the signature — MD5(uid + of_id + virtual_currency + secret), no separators
  const expected = md5(uid + offerId + amountRaw + secret);
  if (!hash || hash.toLowerCase() !== expected.toLowerCase()) {
    return fail("Signature doesn't match.", 403);
  }

  // 2. Validate required fields
  if (!uid || !Number.isFinite(amount)) {
    return fail("Missing or invalid parameters.", 400);
  }

  const userId = uid;
  const coins = Math.round(Math.abs(amount));
  // Admantum sends no unique transaction id — build a synthetic one (see
  // the trade-off note at the top of this file).
  const transId = `admantum-${uid}-${offerId}`;
  console.log("admantum-postback:", { userId, transId, offerId, coins, status });

  if (status === "0") {
    // ---- Reversal: reverse a previous credit, if one exists ----
    const existing = await env.DB.prepare(
      `SELECT id, coins_earned FROM offer_completions WHERE provider = 'admantum' AND transaction_id = ? AND status = 'credited'`
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
    `SELECT id FROM offer_completions WHERE provider = 'admantum' AND transaction_id = ?`
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
     VALUES ('admantum', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerId, transId, 0, coins).run();

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
