// functions/api/admin/dashboard-stats.js
// TODO: admin-only auth check here (this endpoint is public until admin auth is added — see PROJECT-STATUS.md)
import { json, errorJson } from "../../_lib/auth.js";

// Must match COINS_PER_DOLLAR in functions/api/withdraw/request.js.
// If that rate ever changes, change it here too.
const COINS_PER_DOLLAR = 1000;

export async function onRequestGet({ env }) {
  try {
    const db = env.DB;

    const pendingRow = await db
      .prepare(
        "SELECT COALESCE(SUM(coins_used), 0) AS coins, COUNT(*) AS cnt FROM withdrawals WHERE status = 'pending'"
      )
      .first();

    const totalUsersRow = await db
      .prepare("SELECT COUNT(*) AS cnt FROM users")
      .first();

    const paidOutRow = await db
      .prepare(
        "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM withdrawals WHERE status = 'completed'"
      )
      .first();

    // "Top Earner (All-time)" — activity_log isn't written to yet (see
    // PROJECT-STATUS.md), so we can't do a real "today's top earner" until
    // the offer-complete system fills it in. This is Option A from
    // TASK-admin-panel.md section 3.
    const topEarnerRow = await db
      .prepare(
        "SELECT username, total_earning FROM users ORDER BY total_earning DESC LIMIT 1"
      )
      .first();

    const { results: recentRows } = await db
      .prepare(
        `SELECT w.id, w.method, w.address, w.amount_usd, w.coins_used, w.status, w.created_at,
                u.username, u.email
         FROM withdrawals w
         JOIN users u ON w.user_id = u.id
         ORDER BY w.created_at DESC
         LIMIT 10`
      )
      .all();

    const recentWithdrawals = recentRows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      method: row.method,
      address: row.address,
      amountUsd: row.amount_usd,
      coinsUsed: row.coins_used,
      status: row.status,
      createdAt: row.created_at,
    }));

    return json({
      pendingPayoutUsd: pendingRow.coins / COINS_PER_DOLLAR,
      pendingCount: pendingRow.cnt,
      totalUsers: totalUsersRow.cnt,
      totalPaidOutUsd: paidOutRow.total,
      topEarner: topEarnerRow
        ? { username: topEarnerRow.username, totalEarning: topEarnerRow.total_earning }
        : null,
      recentWithdrawals,
    });
  } catch (err) {
    console.error("admin/dashboard-stats GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
