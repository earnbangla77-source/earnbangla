// functions/api/auth/login.js
import {
  verifyPassword,
  createSession,
  sessionCookieHeader,
  publicUser,
  json,
  errorJson,
} from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request body.");
  }

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!email || !password) {
    return errorJson("Please enter your email and password.");
  }

  const user = await db
    .prepare("SELECT * FROM users WHERE email = ?")
    .bind(email)
    .first();

  // Same generic error whether the email doesn't exist or the password is
  // wrong, so we don't leak which accounts exist.
  if (!user) {
    return errorJson("Invalid email or password.", 401);
  }

  const ok = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok) {
    return errorJson("Invalid email or password.", 401);
  }

  const { id: sessionId, expiresAt } = await createSession(db, user.id);

  return json(
    { user: publicUser(user) },
    200,
    { "Set-Cookie": sessionCookieHeader(sessionId, expiresAt) }
  );
}
