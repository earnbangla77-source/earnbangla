// functions/api/admin/activity-log.js
// GET /api/admin/activity-log?range=24h|today|7d|month&provider=&q=&page=1
// শুধু status='credited' (ইনকাম হওয়া) রো। সময় = বাংলাদেশ (UTC+6)।
// অ্যাডমিন চেক: আপনার বিদ্যমান /api/admin/me কে একই কুকি দিয়ে কল করে (আলাদা auth কোড লাগে না)।

const TZ = "+6 hours";
const PAGE = 50;

const RANGES = {
  "24h":   "oc.created_at >= datetime('now','-24 hours')",
  "today": `date(oc.created_at,'${TZ}') = date('now','${TZ}')`,
  "7d":    "oc.created_at >= datetime('now','-7 days')",
  "month": `strftime('%Y-%m',oc.created_at,'${TZ}') = strftime('%Y-%m','now','${TZ}')`,
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function onRequestGet({ request, env }) {
  // ---- admin auth ----
  try {
    const me = await fetch(new URL("/api/admin/me", request.url), {
      headers: { cookie: request.headers.get("cookie") || "" },
    });
    if (!me.ok) return json({ error: "Unauthorized" }, 401);
  } catch (e) {
    return json({ error: "Auth check failed" }, 401);
  }

  const url = new URL(request.url);
  const range = RANGES[url.searchParams.get("range")] ? url.searchParams.get("range") : "24h";
  const provider = (url.searchParams.get("provider") || "").trim();
  const q = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);

  // offer_completions-এ অফারের নামের কলাম কোনটা নিশ্চিত নই — একে একে চেষ্টা করবে
  const nameCandidates = ["oc.offer_name", "oc.offer_id", "NULL"];
  let lastErr = null;

  for (const nameExpr of nameCandidates) {
    try {
      const base = "oc.status = 'credited' AND oc.coins_earned > 0";
      const stat = (cond) =>
        env.DB.prepare(
          `SELECT COALESCE(SUM(oc.coins_earned),0) AS coins, COUNT(*) AS cnt,
                  COUNT(DISTINCT oc.user_id) AS users,
                  MAX(CAST(strftime('%s',oc.created_at) AS INTEGER)) AS last_ts
             FROM offer_completions oc WHERE ${base} AND ${cond}`
        );

      // লিস্টের ফিল্টার
      let where = `${base} AND ${RANGES[range]}`;
      const binds = [];
      if (provider) { where += " AND oc.provider = ?"; binds.push(provider); }
      if (q) {
        where += ` AND (u.username LIKE ? OR oc.user_id LIKE ? OR ${nameExpr} LIKE ?)`;
        const like = `%${q}%`;
        binds.push(like, like, like);
      }

      const [h24, today, month, hourly, provs, tot, list] = await env.DB.batch([
        stat(RANGES["24h"]),
        stat(RANGES["today"]),
        stat(RANGES["month"]),
        env.DB.prepare(
          `SELECT strftime('%Y-%m-%d %H',oc.created_at,'${TZ}') AS h,
                  SUM(oc.coins_earned) AS coins, COUNT(*) AS cnt
             FROM offer_completions oc
            WHERE ${base} AND ${RANGES["24h"]} GROUP BY h`
        ),
        env.DB.prepare(
          `SELECT DISTINCT provider FROM offer_completions oc WHERE ${base} AND ${RANGES["month"]} ORDER BY provider`
        ),
        env.DB.prepare(
          `SELECT COALESCE(SUM(oc.coins_earned),0) AS coins, COUNT(*) AS cnt
             FROM offer_completions oc LEFT JOIN users u ON u.id = oc.user_id WHERE ${where}`
        ).bind(...binds),
        env.DB.prepare(
          `SELECT oc.id AS id, ${nameExpr} AS offer, oc.provider AS provider,
                  COALESCE(u.username, oc.user_id) AS username, oc.coins_earned AS coins,
                  strftime('%d/%m/%Y',oc.created_at,'${TZ}') AS d,
                  strftime('%H:%M:%S',oc.created_at,'${TZ}') AS t,
                  CAST(strftime('%s',oc.created_at) AS INTEGER) AS ts
             FROM offer_completions oc LEFT JOIN users u ON u.id = oc.user_id
            WHERE ${where} ORDER BY oc.id DESC LIMIT ? OFFSET ?`
        ).bind(...binds, PAGE + 1, (page - 1) * PAGE),
      ]);

      // ২৪টা ঘণ্টার বাকেট (বাংলাদেশ সময়), খালি ঘণ্টায় ০
      const map = {};
      (hourly.results || []).forEach((r) => (map[r.h] = r));
      const now = Date.now() + 6 * 3600 * 1000;
      const buckets = [];
      for (let i = 23; i >= 0; i--) {
        const key = new Date(now - i * 3600 * 1000).toISOString().slice(0, 13).replace("T", " ");
        const r = map[key];
        buckets.push({ hour: Number(key.slice(11, 13)), coins: r ? Math.round(r.coins) : 0, count: r ? r.cnt : 0 });
      }

      const fix = (r) => ({
        coins: Math.round(r.results[0].coins), count: r.results[0].cnt,
        users: r.results[0].users, lastTs: r.results[0].last_ts || null,
      });
      const rows = list.results || [];

      return json({
        nowTs: Math.floor(Date.now() / 1000),
        summary: { h24: fix(h24), today: fix(today), month: fix(month) },
        hourly: buckets,
        providers: (provs.results || []).map((r) => r.provider),
        range: { coins: Math.round(tot.results[0].coins), count: tot.results[0].cnt },
        hasMore: rows.length > PAGE,
        list: rows.slice(0, PAGE).map((r) => ({
          id: r.id, offer: r.offer, provider: r.provider, username: String(r.username || "User"),
          coins: Math.round(r.coins), date: r.d, time: r.t, ts: r.ts,
        })),
      });
    } catch (e) {
      lastErr = e;
      if (!/no such column/i.test(String((e && e.message) || e))) break;
    }
  }
  console.log("activity-log error", lastErr && lastErr.message);
  return json({ error: String((lastErr && lastErr.message) || lastErr) }, 500);
}
