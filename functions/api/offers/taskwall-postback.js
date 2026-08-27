// functions/api/offers/taskwall-postback.js
//
// ⚠️ Place this file at functions/api/offers/taskwall-postback.js
//    (sibling to offery-postback.js, revtoo-postback.js, admantum-postback.js)
//
// Receives server-to-server postbacks from TaskWall (taskwall.io) when a
// user completes an offer. Confirmed against taskwall.io/documentation/?postback=1.
//
// ⚠️ TaskWall is DIFFERENT from every other provider integrated so far:
//   - NO MD5/SHA signature at all. Auth is a plain shared **password**
//     string (like CPAGrip), sent back as the `password` param, checked
//     with a simple string comparison.
//   - NO unique transaction/conversion id in the postback params (confirmed
//     — the full param list is app_name, userid, password, user_amount,
//     offer_name, offer_id, payout, ip_address, currency_name, date). Same
//     situation as Admantum — dedupe uses a synthetic key built from
//     userid + offer_id (see the trade-off note in admantum-postback.js:
//     a repeatable offer completed twice by the same user will only be
//     credited once).
//   - NO status/chargeback param either — TaskWall's postback contract
//     has no reversal mechanism at all. This file only ever credits; there
//     is nothing to reverse a credit with. If TaskWall does chargebacks
//     some other way (dashboard-side deduction, a different endpoint),
//     that's outside what this postback can see — check with TaskWall
//     support if reversals matter for your payout risk.
//
// Params (from docs):
//   userid          - the earnbangla user's id
//   password        - must equal env.TASKWALL_POSTBACK_PASSWORD
//   user_amount     - coins to credit, already converted using the
//                      Exchange Rate set on the app (dashboard → Exchange
//                      Rate = 1000, i.e. 1000 coins = $1, matching the
//                      other providers)
//   offer_id        - TaskWall's offer id
//   offer_name      - logged only, not stored
//   payout          - offer payout in USD, stored for reference
//   ip_address      - logged only, not stored
//   currency_name   - logged only (should read "Coin" per the dashboard
//                      Currency Name field)
//   date            - logged only, not stored
//
// Expected response: exact text "OK" (per taskwall.io/documentation).
//
// ⚠️ Requires env.TASKWALL_POSTBACK_PASSWORD — set this to the SAME value
//    typed into the "Postback Password (Optional)" field on the TaskWall
//    app settings page (currently blank in the dashboard screenshot — you
//    must set a real password there AND here, otherwise anyone who
//    discovers this URL could credit themselves unlimited coins with no
//    authentication at all):
//
//   wrangler pages secret put TASKWALL_POSTBACK_PASSWORD --project-name=earnbangla
//   wrangler pages secret put TASKWALL_POSTBACK_PASSWORD --project-name=earnbangla --env preview
//
// ⚠️ Reuses the same offer_completions table (provider, user_id, offer_id,
//    transaction_id, payout, coins_earned, status, created_at) already used
//    for Offery/Revtoo/Admantum — NO new D1 migration needed, this just
//    inserts rows with provider = 'taskwall'.
//
// Same earnings-tracking fix as the other providers: crediting a
// completion bumps users.coins AND users.completed_offers AND
// users.total_earning, not just coins.

function ok() {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("taskwall-postback:", message);
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
  const params = await readParams(request);

  const userId = String(params.userid || "");
  const password = String(params.password || "");
  const offerId = String(params.offer_id || "");
  const offerName = String(params.offer_name || "");
  const amount = parseFloat(params.user_amount);
  const payout = parseFloat(params.payout) || 0;

  const expectedPassword = env.TASKWALL_POSTBACK_PASSWORD || "";
  if (!expectedPassword) {
    return fail("Server not configured (missing TASKWALL_POSTBACK_PASSWORD).", 500);
  }

  // 1. Verify the shared password (plain string compare — no hashing on
  //    TaskWall's side per their docs/PHP example).
  if (!password || password !== expectedPassword) {
    return fail("Invalid password.", 403);
  }

  // 2. Validate required fields
  if (!userId || !Number.isFinite(amount)) {
    return fail("Missing or invalid parameters.", 400);
  }

  const coins = Math.round(Math.abs(amount));
  // TaskWall sends no unique transaction id — build a synthetic one (see
  // the trade-off note at the top of this file).
  const transId = `taskwall-${userId}-${offerId}`;
  console.log("taskwall-postback:", { userId, transId, offerId, offerName, coins, payout });

  // ---- Credit (TaskWall has no chargeback/status param — credit-only) ----
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'taskwall' AND transaction_id = ?`
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
     VALUES ('taskwall', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
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
