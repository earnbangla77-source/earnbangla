// functions/api/admin/withdrawals.js
// TODO: admin-only auth check here (this endpoint is public until admin auth is added — see PROJECT-STATUS.md)
import { json, errorJson } from "../../_lib/auth.js";

// UI tab -> DB status. The Payments UI calls the resolved-good state "Approved"
// (matches TASK-admin-panel.md wording), but the DB/withdraw/request.js code
// calls it "completed" — this endpoint speaks DB status values.
const VALID_STATUSES = ["pending", "completed", "rejected"];

export async function onRequestGet({ request, env }) {
  try {
    const db = env.DB;
    const url = new URL(request.url);
    const statusParam = (url.searchParams.get("status") || "all").toLowerCase();
    const search = (url.searchParams.get("search") || "").trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);

    let where = "";
    const binds = [];

    if (statusParam !== "all") {
      if (!VALID_STATUSES.includes(statusParam)) {
        return errorJson("Invalid status filter.");
      }
      where += " AND w.status = ?";
      binds.push(statusParam);
    }

    if (search) {
      where += " AND (u.email LIKE ? OR u.username LIKE ?)";
      const like = `%${search}%`;
      binds.push(like, like);
    }

    const query = `
      SELECT w.id, w.user_id, w.method, w.address, w.amount_usd, w.coins_used, w.status,
             w.created_at, w.updated_at,
             u.username, u.email
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE 1=1 ${where}
      ORDER BY w.created_at DESC
      LIMIT ?
    `;
    binds.push(limit);

    const { results } = await db.prepare(query).bind(...binds).all();

    const withdrawals = results.map((row) => ({
      id: row.id,
      userId: row.user_id,
      username: row.username,
      email: row.email,
      method: row.method,
      address: row.address,
      amountUsd: row.amount_usd,
      coinsUsed: row.coins_used,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at || null,
    }));

    return json({ withdrawals });
  } catch (err) {
    console.error("admin/withdrawals GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
