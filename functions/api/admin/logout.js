// functions/api/admin/logout.js
// POST /api/admin/logout
import { sessionCookie, json } from "../../_lib/admin-auth.js";

export async function onRequestPost() {
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}
