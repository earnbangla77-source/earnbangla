/**
 * functions/api/offers/cpalead-postback.js
 *
 * CPAlead publisher postback (server-to-server conversion callback).
 *
 * Type A provider, but UNLIKE Offery/Revtoo/Admantum this is NOT
 * MD5-signature based — CPAlead uses a shared plain "password" query
 * param instead (confirmed via CPAlead's own Postback Documentation
 * and dashboard, see screenshot: cpalead.com/en/postback/configuration).
 *
 * Recommended Postback URL to paste into CPAlead dashboard
 * (Postback → Configuration):
 *
 *   https://earn-bangla.com/api/offers/cpalead-postback
 *     ?subid={subid}
 *     &lead_id={lead_id}
 *     &campaign_id={campaign_id}
 *     &campaign_name={campaign_name}
 *     &payout={payout}
 *     &password={password}
 *
 * Macro notes (from CPAlead dashboard + docs):
 * - {subid}         -> our internal users.id. MUST be set to the
 *                      logged-in user's id when we build the CPAlead
 *                      offer link (this is what CPAlead echoes back
 *                      here as "subid").
 * - {lead_id}        -> unique per-conversion id, used for dedupe.
 *                      Alias accepted: {transaction_id}.
 * - {payout}         -> USD payout for the conversion.
 *                      Alias accepted: {amount}.
 * - {campaign_id}/{campaign_name} -> informational only, stored on the
 *                      offer_completions row. Aliases accepted:
 *                      {offer_id}/{offer_name}.
 * - {password}       -> shared secret you set in the CPAlead Postback
 *                      Configuration screen. Compared against
 *                      env.CPALEAD_POSTBACK_PASSWORD.
 *
 * CPAlead does NOT require a specific response string (unlike Offery's
 * "ok" or Admantum's "OK") — their docs only say "return a fast HTTP 2xx
 * response". We return small JSON bodies here; that is fine per docs,
 * but reconfirm by watching `wrangler pages deployment tail` the first
 * time CPAlead fires a real/test postback, per the checklist in
 * OFFERWALL-MASTER-GUIDE.md §৯ step 10.
 *
 * NOTE: no reversal/chargeback macro was found in CPAlead's public docs
 * at the time this file was written. If CPAlead later sends a reversal
 * postback (e.g. with a `status=reversed` style param), that branch
 * needs to be added — do not assume the param name, confirm from a real
 * postback log first (see OFFERWALL-MASTER-GUIDE.md §৭/§৯).
 */

const PROVIDER = "cpalead";

// Same exchange rate other providers use (see checklist step 9):
// 1000 coins = $1 payout.
const COINS_PER_DOLLAR = 1000;

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readParams(request) {
  // CPAlead sends everything in the query string. Per
  // OFFERWALL-MASTER-GUIDE.md §৭ ("Provider POST বললেও params body-তে
  // না"), always read the URL query string first and only fall back to
  // a parsed body if a value is missing there.
  const url = new URL(request.url);
  const q = url.searchParams;

  const params = {
    subid: q.get("subid") || "",
    leadId: q.get("lead_id") || q.get("transaction_id") || "",
    campaignId: q.get("campaign_id") || q.get("offer_id") || "",
    campaignName: q.get("campaign_name") || q.get("offer_name") || "",
    payout: q.get("payout") || q.get("amount") || "0",
    password: q.get("password") || "",
  };

  const hasCore = params.subid && params.leadId;
  if (hasCore || request.method !== "POST") {
    return params;
  }

  // Fallback: some setups may POST form-encoded params instead.
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = new URLSearchParams(await request.text());
      params.subid = params.subid || body.get("subid") || "";
      params.leadId = params.leadId || body.get("lead_id") || body.get("transaction_id") || "";
      params.campaignId = params.campaignId || body.get("campaign_id") || body.get("offer_id") || "";
      params.campaignName = params.campaignName || body.get("campaign_name") || body.get("offer_name") || "";
      params.payout = params.payout !== "0" ? params.payout : (body.get("payout") || body.get("amount") || "0");
      params.password = params.password || body.get("password") || "";
    }
  } catch {
    // ignore — query string values (if any) still stand
  }

  return params;
}

async function handlePostback(request, env) {
  const params = await readParams(request);

  // 1. Password check.
  const expected = env.CPALEAD_POSTBACK_PASSWORD || "";
  if (!expected || !timingSafeEqual(params.password, expected)) {
    return jsonResponse({ status: "error", message: "Invalid password." }, 403);
  }

  // 2. Required params.
  const userId = params.subid;
  const leadId = params.leadId;
  if (!userId || !leadId) {
    return jsonResponse(
      { status: "error", message: "Missing subid or lead_id." },
      400
    );
  }

  const payout = Number.parseFloat(params.payout) || 0;
  const coinsEarned = Math.max(0, Math.round(payout * COINS_PER_DOLLAR));

  // 3. Duplicate check — provider + transaction_id, per
  //    OFFERWALL-MASTER-GUIDE.md §৪.
  const existing = await env.DB.prepare(
    "SELECT id FROM offer_completions WHERE provider = ? AND transaction_id = ?"
  )
    .bind(PROVIDER, leadId)
    .first();

  if (existing) {
    return jsonResponse({ status: "duplicate" }, 200);
  }

  // 4. Credit the user. Update coins, completed_offers, and
  //    total_earning together (see §৭ fixed-bug note — updating only
  //    `coins` was the old bug).
  const update = await env.DB.prepare(
    `UPDATE users
     SET coins = coins + ?,
         completed_offers = completed_offers + 1,
         total_earning = total_earning + ?
     WHERE id = ?`
  )
    .bind(coinsEarned, payout, userId)
    .run();

  if (!update.meta || update.meta.changes === 0) {
    return jsonResponse({ status: "error", message: "User not found." }, 404);
  }

  // 5. Record the completion (exact column order/names per
  //    OFFERWALL-MASTER-GUIDE.md §৪ — never reorder these).
  await env.DB.prepare(
    `INSERT INTO offer_completions
       (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  )
    .bind(PROVIDER, userId, params.campaignId || null, leadId, payout, coinsEarned)
    .run();

  return jsonResponse({ status: "credited", coins: coinsEarned }, 200);
}

export async function onRequestGet(context) {
  return handlePostback(context.request, context.env);
}

export async function onRequestPost(context) {
  return handlePostback(context.request, context.env);
}
