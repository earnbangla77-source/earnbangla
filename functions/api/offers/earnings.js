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
//
// Supports an optional ?view= query param:
//   ?view=credited     (default) — normal completed/credited earnings
//   ?view=chargebacks  — reversed transactions (status = 'chargeback'),
//                        so the profile page can show a "Chargebacks" tab
//                        alongside Earnings / Withdrawals / Pending.

import { getUserFromRequest, json, errorJson } from "../../_lib/auth.js";

const PROVIDER_LABELS = {
  admantum: "Admantum",
  cpagrip: "CPAGrip",
  cpalead: "Cpalead",
  gamwall: "Gamwall",
  gemiad: "Gemiad",
  nexowall: "Nexowall",
  offery: "Offery",
  paidbucksy: "Paidbucksy",
  primewall: "Primewall",
  radientwall: "Radientwall",
  revtoo: "Revtoo",
  taskwall: "Taskwall",
  vortexwall: "Vortexwall",
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

  const url = new URL(request.url);
  const view = (url.searchParams.get("view") || "credited").toLowerCase();
  const statusFilter = view === "chargebacks" ? "chargeback" : "credited";

  const { results } = await db
    .prepare(
      `SELECT provider, offer_id, coins_earned, status, created_at
       FROM offer_completions
       WHERE user_id = ? AND status = ?
       ORDER BY created_at DESC
       LIMIT 100`
    )
    .bind(user.id, statusFilter)
    .all();

  const key = view === "chargebacks" ? "chargebacks" : "earnings";
  const items = (results || []).map((row) => ({
    name: labelFor(row),
    coins: row.coins_earned,
    createdAt: row.created_at,
  }));

  return json({ [key]: items });
}
