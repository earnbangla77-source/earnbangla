// functions/api/offers/earnings.js
//
// Returns the current user's offer-completion history for the profile
// page's "Earnings" tab. Mirrors the shape/pattern of
// functions/api/withdraw/request.js (GET) so profile.html's tab logic
// can reuse the same fetch/render approach.
//
// offer_completions doesn't store the offer's display name (only
// provider + offer_id — see offery-postback.js), so "name" here is a
// readable label built from provider + offer_id, not the real offer title.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

const PROVIDER_LABELS = {
  offery: "Offery",
  cpagrip: "CPAGrip",
};

function labelFor(row) {
  const provider = PROVIDER_LABELS[row.provider] || row.provider || "Offer";
  return row.offer_id ? `${provider} Offer #${row.offer_id}` : provider;
}

export async function onRequestGet({ request, env }) {
  const db = env.DB;
  const user = await getUserFromRequest(request, db);

  if (!user) {
    return errorJson("Not signed in.", 401);
  }

  const { results } = await db
    .prepare(
      `SELECT provider, offer_id, coins_earned, status, created_at
       FROM offer_completions
       WHERE user_id = ? AND status = 'credited'
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .bind(user.id)
    .all();

  const earnings = (results || []).map((row) => ({
    name: labelFor(row),
    coins: row.coins_earned,
    createdAt: row.created_at,
  }));

  return json({ earnings });
}
