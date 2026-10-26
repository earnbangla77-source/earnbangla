// functions/api/activity.js
// GET /api/activity — TODAY's real offer completions (Bangladesh time, UTC+6) for the home-page top ticker.
// Source: offer_completions (one row per completed offer) joined to users for the username.
// Newest first. Only 'credited' rows (chargebacks/'reversed' rows are not shown).
// Only public users (is_private = 0), same rule as leaderboard.js.
// At 00:00 Bangladesh time "today" rolls over, so the ticker starts fresh each day.

const LIMIT = 30;
const TZ = "+6 hours"; // Bangladesh Standard Time

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      `SELECT u.username AS username,
              oc.provider AS provider,
              oc.coins_earned AS coins,
              strftime('%m/%d/%Y', oc.created_at, '${TZ}') AS day
         FROM offer_completions oc
         JOIN users u ON u.id = oc.user_id
        WHERE oc.status = 'credited'
          AND oc.coins_earned > 0
          AND u.is_private = 0
          AND date(oc.created_at, '${TZ}') = date('now', '${TZ}')
        ORDER BY oc.id DESC
        LIMIT ?`
    ).bind(LIMIT).all();

    const activity = (results || []).map((r) => ({
      username: r.username,
      provider: r.provider,
      coinsEarned: Math.round(r.coins),
      date: r.day, // MM/DD/YYYY
    }));

    return new Response(JSON.stringify({ activity }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    });
  } catch (e) {
    console.log("activity error", e && e.message);
    return new Response(JSON.stringify({ activity: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
