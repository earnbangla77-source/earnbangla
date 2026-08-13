// functions/api/activity.js
// Public endpoint — no auth required. Returns the most recent "coins earned"
// events, used to populate the live ticker on the homepage.

import { json, errorJson } from "../_lib/auth.js";

export async function onRequestGet({ env }) {
  const db = env.DB;
  if (!db) return errorJson("DB not bound", 500);

  const { results } = await db
    .prepare(
      `SELECT u.username AS username, u.avatar AS avatar,
              a.coins_earned AS coinsEarned, a.created_at AS createdAt
       FROM activity_log a
       JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT 12`
    )
    .all();

  return json({ activity: results || [] });
}
