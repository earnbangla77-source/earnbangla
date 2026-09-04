// functions/api/offers/gamwall-postback.js
//
// ⚠️ Place this file at functions/api/offers/gamwall-postback.js
//    (sibling to cpagrip-postback.js and offery-postback.js)
//
// Receives server-to-server postbacks from Gamwall when a user completes an
// offer. Gamwall calls this URL with query-string macros (their docs show a
// plain GET, so we accept GET; POST is also wired up in case they ever
// switch to form-post):
//
//   subid1          - the earnbangla user's id (same value we pass as
//                      {user_id} in the offerwall link)
//   currency_amount - coins to credit — ALREADY converted using the
//                      Virtual Currency Name / Currency Rate set on the
//                      Gamwall placement. Keep those in sync with this file:
//                        Virtual Currency Name = Coins
//                        Currency Rate         = 1000.00 (1000 coins = $1,
//                                                 same rate as CPAGrip/Offery)
//   payout          - offer payout in USD (stored for reference)
//   conversion_id   - Gamwall's unique id for this completion. Use this for
//                      duplicate / chargeback tracking (NOT subid1+offer_name
//                      — multi-step offers send several postbacks per user).
//   offer_id        - Gamwall's offer/campaign id
//   offer_name      - offer name (logged only, not stored)
//   status          - "approved" = credit, "chargeback" = reverse a
//                      previous credit (string, NOT numeric like Offery's
//                      "1"/"2")
//   goal_id/goal_name/step_number - multi-step offer fields, only present
//                      for multi-step campaigns. We ignore these: every step
//                      just arrives as its own postback with its own
//                      conversion_id and gets credited independently.
//
// ⚠️ Gamwall's postback docs list NO signature macro — unlike Offery there
//    is no MD5(subId+transId+reward+SECRET) to verify. The only integrity
//    checks available are (a) keeping this URL secret and (b) a duplicate
//    check on conversion_id, exactly as their own PHP sample does. To close
//    that gap a little we support an OPTIONAL shared-secret query param:
//    append &key=YOUR_SECRET to the Postback URL you paste into the Gamwall
//    placement settings, and set GAMWALL_POSTBACK_KEY to the same value. If
//    GAMWALL_POSTBACK_KEY is unset, the check is skipped (so this still
//    works if you'd rather not bother with it).
//
//      wrangler pages secret put GAMWALL_POSTBACK_KEY --project-name=earnbangla
//      wrangler pages secret put GAMWALL_POSTBACK_KEY --project-name=earnbangla --env preview
//
//    Then set the placement's Postback URL (Publisher Panel → Placement →
//    edit id 57 → Postback URL) to something like:
//      https://earn-bangla.com/api/offers/gamwall-postback?subid1={subid1}&currency_amount={currency_amount}&payout={payout}&conversion_id={conversion_id}&offer_id={offer_id}&offer_name={offer_name}&status={status}&key=YOUR_SECRET
//
// ⚠️ Reuses the same offer_completions table as cpagrip/offery
//    (provider + transaction_id + status columns). No extra migration
//    needed as long as offery-schema-addition.sql has already been run.
//
// Crediting a completion bumps users.coins, users.completed_offers, and
// users.total_earning together (same fix as offery-postback.js). Chargebacks
// reverse all three. users.earnings_30d is intentionally left alone — it's
// computed live in functions/api/auth/me.js from offer_completions.
//
// Gamwall expects a JSON response back, e.g.
//   { "success": true,  "message": "Reward added successfully" }
//   { "success": false, "message": "Duplicate transaction" }
// (different from Offery, which wants raw text "ok".)

function respond(success, message, status = 200) {
  if (!success) console.error("gamwall-postback:", message);
  return new Response(JSON.stringify({ success, message }), {
    status,
    headers: { "content-type": "application/json" },
  });
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
    // Body values win over any query-string duplicates.
    params = { ...params, ...bodyParams };
  }

  // Macros are documented as case-insensitive on Gamwall's side, so accept
  // either casing defensively.
  const get = (name) => params[name] ?? params[name.toLowerCase()] ?? params[name.toUpperCase()];

  const subId = String(get("subid1") || "");
  const conversionId = String(get("conversion_id") || "");
  const offerId = String(get("offer_id") || "");
  const offerName = String(get("offer_name") || "");
  const currencyAmount = parseFloat(get("currency_amount"));
  const payout = parseFloat(get("payout")) || 0;
  const status = String(get("status") || "").toLowerCase();
  const key = String(get("key") || "");

  // 1. Optional shared-secret check (see note above — Gamwall has no
  //    built-in signature, this is our own bolt-on).
  const expectedKey = env.GAMWALL_POSTBACK_KEY || "";
  if (expectedKey && key !== expectedKey) {
    return respond(false, "Invalid or missing key.", 403);
  }

  // 2. Validate required fields
  if (!subId || !conversionId || !Number.isFinite(currencyAmount)) {
    return respond(false, "Missing or invalid parameters.", 400);
  }

  const userId = subId;
  const coins = Math.round(Math.abs(currencyAmount));
  console.log("gamwall-postback:", { userId, conversionId, offerId, offerName, coins, status });

  if (status === "chargeback") {
    // ---- Chargeback: reverse a previous credit, if one exists ----
    const existing = await env.DB.prepare(
      `SELECT id, coins_earned FROM offer_completions WHERE provider = 'gamwall' AND transaction_id = ? AND status = 'credited'`
    ).bind(conversionId).first();

    if (!existing) {
      // Nothing to reverse (never credited, or already reversed) — still success.
      return respond(true, "No matching credited transaction to reverse.");
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

    return respond(true, "Chargeback processed.");
  }

  if (status !== "approved") {
    // Unknown/other status (e.g. "pending") — acknowledge without crediting.
    return respond(true, `Status "${status}" ignored (no credit).`);
  }

  // ---- Credit ----
  // Duplicate check keyed on conversion_id, never subId+offerName, so
  // multi-step offers (several postbacks per user/offer) aren't dropped.
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'gamwall' AND transaction_id = ?`
  ).bind(conversionId).first();

  if (dup) {
    return respond(false, "Duplicate transaction");
  }

  const update = await env.DB.prepare(
    `UPDATE users
     SET coins = coins + ?,
         completed_offers = completed_offers + 1,
         total_earning = total_earning + ?
     WHERE id = ?`
  ).bind(coins, coins, userId).run();

  if (!update.success || update.meta.changes === 0) {
    return respond(false, "User not found.", 404);
  }

  await env.DB.prepare(
    `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES ('gamwall', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerId, conversionId, payout, coins).run();

  return respond(true, "Reward added successfully");
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return respond(false, err.message || "Server error", 500); }
}

export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return respond(false, err.message || "Server error", 500); }
}
