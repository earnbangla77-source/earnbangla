// functions/api/offers/adbreakmedia-postback.js
//
// ⚠️ Place this file at functions/api/offers/adbreakmedia-postback.js
//    (sibling to offery-postback.js)
//
// Receives server-to-server postbacks from AdBreak Media when a user
// completes an offer. Postback URL to paste into the AdBreak placement:
//
//   https://earn-bangla.com/api/offers/adbreakmedia-postback?user=[YOUR_USER_ID]&reward=[REWARD_VALUE]&offerName=[OFFER_NAME]&offerId=[OFFER_ID]&ip=[USER_IP]&status=[STATUS]&transaction_id=[TXID]&country=[COUNTRY]&is_multi=[MULTI_EVENT]&ename=[EVENT_NAME]&eid=[EVENT_ID]&payout=[PAYOUT]&hash=[HASH]&sub1=[SUB1]&sub2=[SUB2]
//
// Params AdBreak sends:
//
//   user            - the earnbangla user's id ([YOUR_USER_ID])
//   reward          - coins to credit — ALREADY converted using the Currency
//                     Name / Exchange Rate set on the AdBreak placement.
//                     Keep them in sync with this site:
//                       Currency Name = Coin
//                       Exchange Rate = 1000  (1000 coins = $1.00)
//                     ALWAYS an absolute value — use `status` to decide
//                     whether to add or subtract.
//   offerName       - offer name (logged only)
//   offerId         - AdBreak's offer id
//   ip              - user's IP (logged only)
//   status          - "completed" = credit, "rejected" = chargeback
//   transaction_id  - AdBreak's unique conversion id (TXID)
//   country         - ISO2 country (logged only)
//   is_multi / ename / eid - multi-event info (logged only)
//   payout          - USD payout (stored for reference)
//   hash            - SHA256(user + offerId + txid + PUBLISHER_SECRET_KEY)
//   sub1 / sub2     - extra params (unused)
//
// AdBreak expects HTTP 200 and a body that does NOT contain "fail" or
// "error". We return plain "ok" on success. (On real failures we return a
// non-200 status, so AdBreak retries up to 5 times, 1 hour apart.)
//
// ⚠️ Requires env.ADBREAK_SECRET_KEY (AdBreak dashboard → Settings →
//    Secret Credentials → publisher secret key):
//
//   wrangler pages secret put ADBREAK_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put ADBREAK_SECRET_KEY --project-name=earnbangla --env preview
//
//   Then REDEPLOY — Pages doesn't inject new secrets into existing deployments.
//
// ⚠️ Uses the shared offer_completions table (provider, user_id, offer_id,
//    transaction_id, payout, coins_earned, status, created_at) — same as
//    offery-postback.js.
//
// Like Offery/PrimeWall: every completion is ALWAYS recorded in
// offer_completions, even if the user id doesn't exist in `users` (then no
// user's balance changes). Always returns "ok" so AdBreak marks it successful.

// Optional extra protection from AdBreak's docs. Hash verification is already
// strong; turn this on only if you are sure AdBreak's IP won't change.
const ENFORCE_IP_WHITELIST = false;
const ALLOWED_IPS = ["139.144.178.218"];

function ok() {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}

function reject(message, status = 400) {
  console.error("adbreakmedia-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
      const formData = await request.formData();
      bodyParams = Object.fromEntries(formData.entries());
    }
    params = { ...params, ...bodyParams };
  }

  // Optional IP whitelist
  if (ENFORCE_IP_WHITELIST) {
    const ip =
      request.headers.get("cf-connecting-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    if (!ALLOWED_IPS.includes(ip)) {
      return reject("Access Denied", 403);
    }
  }

  const userId = String(params.user || "");
  const offerId = String(params.offerId || "");
  const offerName = String(params.offerName || "");
  // AdBreak's URL example uses `transaction_id`, its PHP example reads `txid`
  // — accept both.
  const transId = String(params.transaction_id || params.txid || "");
  // The docs' macro is `reward`, but their sample URL shows `coins` — accept both.
  const reward = parseFloat(params.reward ?? params.coins);
  const status = String(params.status || "completed").toLowerCase();
  const receivedHash = String(params.hash || "").toLowerCase();

  const secret = env.ADBREAK_SECRET_KEY || "";
  if (!secret) return reject("Server not configured (missing ADBREAK_SECRET_KEY).", 500);

  // 1. Verify the hash: SHA256(user + offerId + txid + secret)
  const expected = await sha256Hex(userId + offerId + transId + secret);
  if (!receivedHash || receivedHash !== expected) {
    return reject("Unauthorized", 403);
  }

  // 2. Validate required fields
  if (!userId || !transId || !Number.isFinite(reward)) {
    return reject("Missing or invalid parameters.", 400);
  }

  const coins = Math.round(Math.abs(reward));
  console.log("adbreakmedia-postback:", {
    userId, transId, offerId, offerName, coins, status,
    country: params.country, ip: params.ip, multi: params.is_multi, event: params.ename,
  });

  if (status === "rejected") {
    // ---- Chargeback: reverse a previous credit, if one exists ----
    // Amount comes from the ORIGINAL stored row, not from the incoming
    // postback, so a rejected call can never subtract more than was credited.
    const existing = await env.DB.prepare(
      `SELECT id, user_id, coins_earned FROM offer_completions
       WHERE provider = 'adbreakmedia' AND transaction_id = ? AND status = 'credited'`
    ).bind(transId).first();

    if (!existing) {
      // Never credited, or already reversed — nothing to do.
      return ok();
    }

    await env.DB.prepare(
      `UPDATE users
       SET coins = MAX(coins - ?, 0),
           completed_offers = MAX(completed_offers - 1, 0),
           total_earning = MAX(total_earning - ?, 0)
       WHERE id = ?`
    ).bind(existing.coins_earned, existing.coins_earned, existing.user_id).run();

    await env.DB.prepare(`UPDATE offer_completions SET status = 'chargeback' WHERE id = ?`)
      .bind(existing.id).run();

    return ok();
  }

  if (status !== "completed") {
    // Unknown status — don't guess, just acknowledge.
    console.log("adbreakmedia-postback: ignored unknown status", { transId, status });
    return ok();
  }

  // ---- Credit ----
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'adbreakmedia' AND transaction_id = ?`
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

  const matched = update.success && update.meta.changes > 0;
  if (!matched) {
    console.log("adbreakmedia-postback: no matching user, recorded anyway", { userId, transId });
  }

  await env.DB.prepare(
    `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES ('adbreakmedia', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerId, transId, parseFloat(params.payout) || 0, coins).run();

  return ok();
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return reject(err.message || "Server error", 500); }
}

export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return reject(err.message || "Server error", 500); }
}
