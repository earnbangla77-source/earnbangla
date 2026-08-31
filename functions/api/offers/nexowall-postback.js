// functions/api/offers/nexowall-postback.js
//
// ⚠️ Place this file at functions/api/offers/nexowall-postback.js
//    (sibling to offery-postback.js, revtoo-postback.js, taskwall-postback.js)
//
// Receives server-to-server postbacks from Nexowall when a user completes
// an offer on the "Earn bangla" placement.
//
// ⚠️ UNCONFIRMED PARAM NAMES — READ BEFORE GOING LIVE ⚠️
// Nexowall has no public documentation (checked — nexowall.me has no
// indexed docs). This file is modeled directly on taskwall-postback.js's
// STRUCTURE (password-based auth, no MD5, credit-only, synthetic dedupe
// key) because Nexowall's dashboard shows the exact same shape of setup
// (Postback URL + plain Postback Password, no Secret/API signature field).
// The actual PARAM NAMES below (userid, user_amount, offer_id, offer_name,
// payout, ip_address) are borrowed from that same family of white-label
// offerwall panel (confirmed identical on a sibling platform's public
// docs) — but NOT yet confirmed for Nexowall itself. Treat this as the
// best first guess, not a confirmed integration.
//
// The DEBUG console.log below is intentionally kept (not stripped like a
// finished integration would) so that the FIRST real postback shows the
// true param names in `wrangler pages deployment tail` — compare that
// against the field names used below and fix any mismatch immediately,
// same as the guide's checklist step 10 requires before marking this ✅.
//
// Assumed params (adjust once confirmed against real tail log output):
//   userid          - the earnbangla user's id
//   password        - must equal env.NEXOWALL_POSTBACK_PASSWORD (p4X@2G2Z
//                      as currently set in the Nexowall dashboard)
//   user_amount     - coins to credit (dashboard Exchange Rate is set to
//                      1000, i.e. 1000 coins = $1, matching other providers)
//   offer_id        - Nexowall's offer id
//   offer_name      - logged only, not stored
//   payout          - offer payout in USD, stored for reference
//   ip_address      - logged only, not stored
//
// Expected response: "OK" (assumed — TaskWall/UPWALL family convention;
// confirm against Nexowall's own docs/support if postbacks keep retrying
// despite a 200, since that usually means the expected response string
// doesn't match what's actually required).
//
// ⚠️ No unique transaction id assumed in the postback (same situation as
//    Admantum/TaskWall) — dedupe uses a synthetic key from userid + offer_id.
//    Trade-off: the same repeatable offer completed twice by the same user
//    will only be credited once. If Nexowall's real postback DOES include
//    a transaction id (visible once we see the raw log), switch to using
//    that instead — it's a safer dedupe key.
//
// ⚠️ No status/chargeback param assumed either — this file only ever
//    credits. If Nexowall sends a reversal some other way, that's outside
//    what this postback can see until confirmed.
//
// ⚠️ Requires env.NEXOWALL_POSTBACK_PASSWORD — set to the SAME value as
//    the "Postback Password" field in the Nexowall dashboard (currently
//    p4X@2G2Z):
//
//   wrangler pages secret put NEXOWALL_POSTBACK_PASSWORD --project-name=earnbangla
//   wrangler pages secret put NEXOWALL_POSTBACK_PASSWORD --project-name=earnbangla --env preview
//
// ⚠️ Reuses the same offer_completions table (provider, user_id, offer_id,
//    transaction_id, payout, coins_earned, status, created_at) already used
//    for the other providers — NO new D1 migration needed, this just
//    inserts rows with provider = 'nexowall'.
//
// Same earnings-tracking fix as the other providers: crediting a
// completion bumps users.coins AND users.completed_offers AND
// users.total_earning, not just coins.

function ok() {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("nexowall-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

async function readParams(request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  if (Object.keys(params).length > 0) {
    return params;
  }

  if (request.method === "POST") {
    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await request.json();
      }
      if (contentType.includes("form")) {
        const formData = await request.formData();
        return Object.fromEntries(formData.entries());
      }
    } catch {
      // no/unparseable body — fine, fall through with empty params
    }
  }

  return params;
}

async function handlePostback(request, env) {
  // --- DEBUG: keep this until a real Nexowall postback is confirmed to
  // match the assumed param names above. Compare this log against the
  // field names used below on the first live test; remove once verified. ---
  const debugRawBody = await request.clone().text().catch(() => "<unreadable>");
  console.log("nexowall-postback: DEBUG incoming request", {
    method: request.method,
    contentType: request.headers.get("content-type"),
    url: request.url,
    rawBody: debugRawBody,
  });
  // --- END DEBUG ---

  const params = await readParams(request);

  const userId = String(params.userid || "");
  const password = String(params.password || "");
  const offerId = String(params.offer_id || "");
  const offerName = String(params.offer_name || "");
  const amount = parseFloat(params.user_amount);
  const payout = parseFloat(params.payout) || 0;

  const expectedPassword = env.NEXOWALL_POSTBACK_PASSWORD || "";
  if (!expectedPassword) {
    return fail("Server not configured (missing NEXOWALL_POSTBACK_PASSWORD).", 500);
  }

  // 1. Verify the shared password (plain string compare, no hashing —
  //    assumed same convention as TaskWall; confirm if this ever fails
  //    with a correctly-configured password).
  if (!password || password !== expectedPassword) {
    return fail("Invalid password.", 403);
  }

  // 2. Validate required fields
  if (!userId || !Number.isFinite(amount)) {
    return fail("Missing or invalid parameters.", 400);
  }

  const coins = Math.round(Math.abs(amount));
  // No confirmed unique transaction id — synthetic dedupe key (see note
  // above; switch to a real transaction id if the raw log shows one).
  const transId = `nexowall-${userId}-${offerId}`;
  console.log("nexowall-postback:", { userId, transId, offerId, offerName, coins, payout });

  // ---- Credit (no confirmed chargeback/status param — credit-only) ----
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'nexowall' AND transaction_id = ?`
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
     VALUES ('nexowall', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerId, transId, payout, coins).run();

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
