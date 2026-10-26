// functions/api/activity.js
// GET /api/activity — top earners of the LAST 30 DAYS (+ their lifetime coins), for the home-page top ticker.
// Same pattern as leaderboard.js: only public users (is_private = 0), username straight from users.
// 30-day earning is computed live from offer_completions (same source as earnings_30d in me.js).
// Chargebacks ('reversed' rows) are subtracted so reversed offers don't count.

const LIMIT = 20;

export async function onRequestGet(context) {
  const { env } = context;
  try {
    // val = net coins per row (credited = +, reversed chargeback = -)
    const { results } = await env.DB.prepare(
      `SELECT u.username AS username,
              SUM(CASE WHEN oc.created_at >= datetime('now', '-30 days') THEN oc.val ELSE 0 END) AS coins30,
              SUM(oc.val) AS coins_all
         FROM (SELECT user_id, created_at,
                      CASE WHEN status = 'credited' THEN coins_earned
                           WHEN status = 'reversed' THEN -ABS(coins_earned)
                           ELSE 0 END AS val
                 FROM offer_completions) oc
         JOIN users u ON u.id = oc.user_id
        WHERE u.is_private = 0
        GROUP BY oc.user_id
       HAVING coins30 > 0
        ORDER BY coins30 DESC
        LIMIT ?`
    ).bind(LIMIT).all();

    const activity = (results || []).map((r) => ({
      username: r.username,
      coinsEarned: Math.round(r.coins30),   // last 30 days
      lifetimeCoins: Math.round(Math.max(0, r.coins_all)), // all time
    }));

    return new Response(JSON.stringify({ activity }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (e) {
    console.log("activity error", e && e.message);
    return new Response(JSON.stringify({ activity: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
