// functions/api/auth/logout.js
import {
  parseCookies,
  deleteSession,
  clearSessionCookieHeader,
  SESSION_COOKIE,
  json,
} from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];

  if (sessionId) {
    await deleteSession(db, sessionId);
  }

  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
}
