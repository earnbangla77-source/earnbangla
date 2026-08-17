// functions/api/auth/me.js
import { getUserFromRequest, publicUser, json, errorJson } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const db = env.DB;
  const user = await getUserFromRequest(request, db);

  if (!user) {
    return errorJson("Not signed in.", 401);
  }

  const shaped = publicUser(user);

  // earnings30d is computed live from offer_completions instead of trusting
  // a static users.earnings_30d column — a static counter would only ever
  // go up, never "expire" completions older than 30 days. This stays
  // correct automatically as time passes.
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(coins_earned), 0) AS total
       FROM offer_completions
       WHERE user_id = ?
         AND status = 'credited'
         AND created_at >= datetime('now', '-30 days')`
    )
    .bind(user.id)
    .first();

  shaped.earnings30d = row ? row.total : 0;

  return json({ user: shaped });
}
