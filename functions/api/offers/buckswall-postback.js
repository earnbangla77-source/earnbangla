// functions/api/offers/buckswall-postback.js
//
// ⚠️ Place this file at functions/api/offers/buckswall-postback.js
//    (sibling to taskwall-postback.js, offery-postback.js, revtoo-postback.js,
//    admantum-postback.js, etc.)
//
// Receives server-to-server postbacks from BuckWall (buckswall.com) for the
// offerwall at https://buckswall.com/offerwall.php?placement_id=81&user_id={user_id}
// (Type B — iframe-only, per OFFERWALL-MASTER-GUIDE.md §2 — no separate
// buckswall-feed.js is needed). Based on the "Postback Setup Guide" macro
// table shared in chat.
//
// ⚠️ BuckWall is DIFFERENT from every other provider integrated so far in
//    THREE important ways — read all three before deploying:
//
//   1) NO SIGNATURE AND NO SHARED-PASSWORD MACRO AT ALL.
//      Every other provider gives *some* secret in the postback (MD5
//      signature for Offery/Revtoo/Admantum/RadiantWall/PaidBucksy, a
//      shared password param for TaskWall/CPAGrip). BuckWall's macro
//      table has NONE — {subid1}/{payout}/{currency_amount}/
//      {currency_name}/{offer_name}/{ip_address}/{status}/{subid2}/
//      {event_id}/{event_name} is the complete documented list, and none
//      of them is a secret. Anyone who found this URL could forge a
//      request and credit themselves unlimited coins.
//
//      WORKAROUND: embed a secret of your own choosing directly in the
//      Postback URL string you paste into BuckWall's dashboard — as a
//      literal query param, NOT a macro:
//
//        https://earn-bangla.com/api/offers/buckswall-postback?secret=PUT_A_LONG_RANDOM_STRING_HERE&user={subid1}&amount={currency_amount}&payout={payout}&offer={offer_name}&status={status}&event_id={event_id}&event_name={event_name}&currency={currency_name}&ip={ip_address}
//
//      and set that exact same string as env.BUCKSWALL_POSTBACK_SECRET
//      (see bottom of this file). This is the same idea as TaskWall/
//      CPAGrip's password field, just done manually since BuckWall's
//      dashboard doesn't appear to offer a built-in password field for it
//      (none was mentioned in the pasted docs).
//
//   2) NO UNIQUE CONVERSION ID, AND NO OFFER ID EITHER.
//      Other providers give at least a transaction id (Offery/Revtoo/
//      RadiantWall/PaidBucksy) or an offer id to build a synthetic key
//      from (TaskWall/Admantum). BuckWall gives neither — the closest
//      thing to an identifier is {offer_name} (free text). Dedupe/match
//      key used everywhere in this file (both for crediting AND for
//      matching a later reversal back to its original credit):
//
//        buckswall-${userId}-${offerName}-${eventId || "single"}
//
//      {event_id} is included because Multi-Event Campaigns fire one
//      postback PER EVENT (e.g. install, then registration, then
//      purchase) for the same offer/user — those must NOT be deduped
//      against each other. For a normal single-event conversion
//      {event_id} is empty, so the key collapses to
//      buckswall-${userId}-${offerName}.
//
//      TRADE-OFF A (repeatable offers): if a REPEATABLE offer is
//      completed twice by the same user, both postbacks produce the same
//      key and only the first credit is recorded — there's no way around
//      this without a real per-conversion id from BuckWall.
//
//      TRADE-OFF B (reversal matching): a reversal postback is matched to
//      its original credit ONLY by recomputing this same key from
//      whatever {subid1}/{offer_name}/{event_id} the reversal postback
//      carries. If BuckWall's reversal postback ever sends a different
//      offer_name/event_id than the original approval did for the same
//      conversion, the key won't match and the reversal will be silently
//      logged-and-ignored (nothing to reverse). Ask BuckWall support for
//      a real conversion id if payout accuracy on chargebacks matters.
//
//   3) {status} — CREDIT ON "approved", REVERSE ON ANYTHING ELSE
//      NON-EMPTY. BuckWall's docs only document "approved" as an example
//      status value; no chargeback/rejection string is documented anywhere
//      in the pasted guide. Since we can't know the real token in advance,
//      this file treats status this way:
//        - status === "approved"        → credit (if not already credited)
//        - status is any other non-empty value (e.g. "rejected",
//          "declined", "reversed", "chargeback", or whatever BuckWall
//          actually sends) → look for a matching CREDITED row (via the
//          key in point 2) and reverse it (decrement coins/
//          completed_offers/total_earning, floored at 0), unless it was
//          already reversed. If no matching credited row exists (e.g. the
//          conversion was never approved in the first place, or BuckWall
//          uses an interim status like "pending" before "approved"), this
//          is a no-op — logged, nothing credited or reversed, because
//          there's nothing to act on.
//        - status is empty/missing      → logged and ignored entirely
//          (not enough information to safely do anything).
//      Reversal amounts are taken from the ORIGINAL stored credited row's
//      coins_earned/payout — NOT from whatever the incoming reversal
//      postback claims — same defensive pattern used for other providers'
//      chargebacks on this site.
//
// Params used (per the macro table):
//   subid1          - our user's id                         → {subid1}
//   currency_amount - coins to credit, pre-converted using the
//                     placement's Exchange Rate              → {currency_amount}
//   payout          - USD payout, stored for reference       → {payout}
//   offer_name      - only identifier available; stored in the
//                     offer_id column (no real offer_id exists) → {offer_name}
//   status          - "approved" credits, anything else non-empty
//                     attempts a reversal (see point 3 above)  → {status}
//   event_id        - folded into the dedupe/match key for multi-event
//                     campaigns; empty for normal conversions → {event_id}
//   event_name      - appended to the stored offer label,
//                     logged only                              → {event_name}
//   ip_address      - logged only, not stored                  → {ip_address}
//   currency_name   - logged only, not stored                  → {currency_name}
//   subid2          - the Placement ID (81 here); logged only —
//                     NOT a secret, it's public in the offerwall
//                     link itself                                → {subid2}
//
// Expected response string: NOT documented anywhere in the pasted guide
// (unlike TaskWall's exact "OK", or the §5 table in
// OFFERWALL-MASTER-GUIDE.md for the other providers). Defaulting to
// plain-text "OK" (uppercase) to match the majority convention on this
// site — UNCONFIRMED. If BuckWall's dashboard shows the postback as
// failing/retrying after a real test, check their support or a "Test
// Postback" tool for the exact expected string and fix the ok() helper.
//
// ⚠️ Requires env.BUCKSWALL_POSTBACK_SECRET — pick a long random string
//    yourself (BuckWall doesn't give you one), set it here, and use the
//    EXACT SAME string as a literal `secret=` query param (not a macro)
//    in the Postback URL pasted into BuckWall's dashboard:
//
//   wrangler pages secret put BUCKSWALL_POSTBACK_SECRET --project-name=earnbangla
//   wrangler pages secret put BUCKSWALL_POSTBACK_SECRET --project-name=earnbangla --env preview
//
// ⚠️ Reuses the same shared offer_completions table (provider, user_id,
//    offer_id, transaction_id, payout, coins_earned, status, created_at)
//    used for every other provider — NO new D1 migration needed, this
//    just inserts rows with provider = 'buckswall' (status = 'credited'
//    or 'reversed').
//
// Same three-column earnings fix as every other provider: crediting a
// completion bumps users.coins AND users.completed_offers AND
// users.total_earning (a reversal decrements all three, floored at 0),
// not just coins.

function ok() {
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("buckswall-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

async function readParams(request) {
  // BuckWall's docs don't say whether real conversions arrive as GET or
  // POST — always check the URL query string first (per
  // OFFERWALL-MASTER-GUIDE.md §8: some providers claim POST but actually
  // put everything in the query string with an empty body), then fall
  // back to parsing a POST body.
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

async function handleApproved(env, { userId, transId, offerLabel, coins, payout }) {
  // Dedupe scoped to 'credited' rows only, so a later 'reversed' audit
  // row for the same transId never blocks a fresh credit if BuckWall
  // somehow re-approves the same key (shouldn't normally happen, but
  // costs nothing to be scoped correctly).
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'buckswall' AND transaction_id = ? AND status = 'credited'`
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
     VALUES ('buckswall', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerLabel, transId, payout, coins).run();

  return ok();
}

async function handleReversal(env, { userId, transId, status }) {
  // Find the original credited row for this key — reversal amounts come
  // from THIS row, never from the incoming postback's own payout/amount
  // (see point 3 in the header comment).
  const original = await env.DB.prepare(
    `SELECT user_id, coins_earned, payout FROM offer_completions
     WHERE provider = 'buckswall' AND transaction_id = ? AND status = 'credited'`
  ).bind(transId).first();

  if (!original) {
    console.log(`buckswall-postback: reversal ignored, no matching credit for transId=${transId} (status="${status}")`);
    return ok();
  }

  if (String(original.user_id) !== userId) {
    console.error(`buckswall-postback: reversal user mismatch — credited row user_id=${original.user_id}, postback userId=${userId}, transId=${transId}`);
    return ok();
  }

  const alreadyReversed = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'buckswall' AND transaction_id = ? AND status = 'reversed'`
  ).bind(transId).first();

  if (alreadyReversed) {
    return ok(); // already reversed once — idempotent, don't double-reverse
  }

  const coins = Math.abs(original.coins_earned);

  await env.DB.prepare(
    `UPDATE users
     SET coins = MAX(coins - ?, 0),
         completed_offers = MAX(completed_offers - 1, 0),
         total_earning = MAX(total_earning - ?, 0)
     WHERE id = ?`
  ).bind(coins, coins, userId).run();

  await env.DB.prepare(
    `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES ('buckswall', ?, '', ?, ?, ?, 'reversed', datetime('now'))`
  ).bind(userId, transId, original.payout, -coins).run();

  console.log(`buckswall-postback: reversed transId=${transId} coins=${coins} (status="${status}")`);
  return ok();
}

async function handlePostback(request, env) {
  // --- TEMP DEBUG: see exactly what BuckWall's server sends before the
  //     first real live test. Remove once the param names/shapes above
  //     are confirmed against a real conversion. ---
  const debugRawBody = await request.clone().text().catch(() => "<unreadable>");
  console.log("buckswall-postback: DEBUG incoming request", {
    method: request.method,
    contentType: request.headers.get("content-type"),
    url: request.url,
    rawBody: debugRawBody,
  });
  // --- END TEMP DEBUG ---

  const params = await readParams(request);

  const secret = String(params.secret || "");
  const userId = String(params.subid1 || "");
  const offerName = String(params.offer_name || "").trim();
  const eventId = String(params.event_id || "").trim();
  const eventName = String(params.event_name || "").trim();
  const status = String(params.status || "").trim().toLowerCase();
  const currencyAmount = parseFloat(params.currency_amount);
  const payout = parseFloat(params.payout) || 0;
  const ipAddress = String(params.ip_address || "");
  const currencyName = String(params.currency_name || "");
  const placementId = String(params.subid2 || "");

  const expectedSecret = env.BUCKSWALL_POSTBACK_SECRET || "";
  if (!expectedSecret) {
    return fail("Server not configured (missing BUCKSWALL_POSTBACK_SECRET).", 500);
  }

  // 1. Verify OUR OWN secret param — see point 1 in the header comment
  //    for why this exists (BuckWall's macros carry no auth at all).
  if (!secret || secret !== expectedSecret) {
    return fail("Invalid or missing secret.", 403);
  }

  // 2. Validate required fields
  if (!userId || !offerName) {
    return fail("Missing or invalid parameters.", 400);
  }

  console.log("buckswall-postback:", {
    userId, offerName, eventId, eventName, status, currencyAmount, payout,
    ipAddress, currencyName, placementId,
  });

  // No unique transaction id and no offer id exist in BuckWall's macro
  // set — synthetic key used both for crediting and for matching a later
  // reversal back to it (see point 2 in the header comment).
  const transId = `buckswall-${userId}-${offerName}-${eventId || "single"}`;

  // 3. Route by status (see point 3 in the header comment).
  if (status === "approved") {
    if (!Number.isFinite(currencyAmount)) {
      return fail("Missing or invalid currency_amount.", 400);
    }
    const coins = Math.round(Math.abs(currencyAmount));
    const offerLabel = eventName ? `${offerName} [${eventName}]` : offerName;
    return handleApproved(env, { userId, transId, offerLabel, coins, payout });
  }

  if (status) {
    // Any other non-empty status is treated as a reversal signal.
    return handleReversal(env, { userId, transId, status });
  }

  console.log(`buckswall-postback: ignored (status is empty/missing)`);
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
