// functions/api/admin/login.js
// POST /api/admin/login  { email, password }
import { ADMIN_EMAIL, checkPassword, makeToken, sessionCookie, json } from "../../_lib/admin-auth.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.ADMIN_PASSWORD) {
      return json({ error: "ADMIN_PASSWORD is not set in Cloudflare variables." }, 500);
    }
    let body = {};
    try { body = await request.json(); } catch (e) {}
    const email = String(body.email || "").trim().toLowerCase();

    // দুটো চেকই সবসময় চালানো হয় (timing leak এড়াতে)
    const okPass = await checkPassword(env, body.password);
    const okEmail = email === ADMIN_EMAIL;

    if (!(okPass && okEmail)) {
      await new Promise((r) => setTimeout(r, 1000)); // brute-force ধীর করতে
      return json({ error: "Wrong email or password." }, 401);
    }
    const token = await makeToken(env);
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
  } catch (e) {
    console.log("admin login error", e && e.message);
    return json({ error: "Server error." }, 500);
  }
}
