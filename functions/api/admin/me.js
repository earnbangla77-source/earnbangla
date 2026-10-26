// functions/api/admin/me.js
// GET /api/admin/me — লগইন আছে কিনা
import { ADMIN_EMAIL, isAdmin, json } from "../../_lib/admin-auth.js";

export async function onRequestGet(context) {
  if (await isAdmin(context.request, context.env)) return json({ ok: true, email: ADMIN_EMAIL });
  return json({ error: "Unauthorized" }, 401);
}
