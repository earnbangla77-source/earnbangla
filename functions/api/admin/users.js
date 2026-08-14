// functions/api/admin/users.js
// TODO: admin-only auth check here (this endpoint is public until admin auth is added — see PROJECT-STATUS.md)
import { json, errorJson, publicUser } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    const db = env.DB;
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").trim();
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "25", 10) || 25, 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    let where = "";
    const binds = [];
    if (search) {
      where = "WHERE (email LIKE ? OR username LIKE ?)";
      const like = `%${search}%`;
      binds.push(like, like);
    }

    const countRow = await db
      .prepare(`SELECT COUNT(*) AS cnt FROM users ${where}`)
      .bind(...binds)
      .first();

    const { results } = await db
      .prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all();

    // publicUser() already strips password_hash/salt — reuse it rather than
    // hand-picking columns again here.
    const users = results.map(publicUser);

    return json({ users, total: countRow.cnt, limit, offset });
  } catch (err) {
    console.error("admin/users GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
