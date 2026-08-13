// functions/api/leaderboard.js
// Cloudflare Pages Function — GET /api/leaderboard
//
// Ranks public users (is_private = 0) by coins — highest coins first.
// Ties are broken by created_at ASC (whoever reached that coin count first
// ranks higher). Wires directly to schema.sql's users table.

const RANK_PRIZES = {
  1: 2000, 2: 1700, 3: 1500, 4: 1300, 5: 1000,
  6: 900,  7: 700,  8: 500,  9: 300,  10: 100
};
const LIMIT = 50;

function prizeFor(rank) {
  return RANK_PRIZES[rank] || 0;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

// NOTE: assumes your login flow sets a cookie named "session" holding the
// sessions.id value. If your /api/auth/login endpoint uses a different
// cookie name, change it here to match.
async function getSessionUser(env, request) {
  const sessionId = getCookie(request, 'session');
  if (!sessionId) return null;

  const row = await env.DB.prepare(
    `SELECT u.id, u.coins, u.created_at, u.is_private
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`
  ).bind(sessionId, Date.now()).first();

  return row || null;
}

export async function onRequestGet(context) {
  const { env, request } = context;

  try {
    // Top N public users, highest coins first.
    const { results } = await env.DB.prepare(
      `SELECT id, username, avatar, coins
       FROM users
       WHERE is_private = 0
       ORDER BY coins DESC, created_at ASC
       LIMIT ?`
    ).bind(LIMIT).all();

    const entries = results.map((u, i) => ({
      rank: i + 1,
      username: u.username,
      avatar: u.avatar,
      coins: u.coins,
      prize: prizeFor(i + 1)
    }));

    // Signed-in user's rank, even if they're outside the top LIMIT.
    // null if signed out or their profile is private.
    let your_rank = null;
    const me = await getSessionUser(env, request);
    if (me && me.is_private === 0) {
      const higherRow = await env.DB.prepare(
        `SELECT COUNT(*) as higher
         FROM users
         WHERE is_private = 0
           AND (coins > ? OR (coins = ? AND created_at < ?))`
      ).bind(me.coins, me.coins, me.created_at).first();
      your_rank = higherRow.higher + 1;
    }

    return Response.json({ your_rank, entries });
  } catch (err) {
    return Response.json({ error: 'Failed to load leaderboard' }, { status: 500 });
  }
}
