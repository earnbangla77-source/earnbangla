// functions/api/auth/register.js
import {
  newId,
  hashPassword,
  createSession,
  sessionCookieHeader,
  publicUser,
  json,
  errorJson,
  isValidEmail,
} from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request body.");
  }

  const username = (body.username || "").trim();
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";

  if (!username || username.length < 3 || username.length > 24) {
    return errorJson("Username must be 3-24 characters.");
  }
  if (!isValidEmail(email)) {
    return errorJson("Please enter a valid email address.");
  }
  if (!password || password.length < 6) {
    return errorJson("Password must be at least 6 characters.");
  }

  const existing = await db
    .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
    .bind(email, username)
    .first();
  if (existing) {
    return errorJson("An account with that email or username already exists.");
  }

  const { hash, salt } = await hashPassword(password);
  const id = newId();
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO users
        (id, username, email, password_hash, salt, avatar, level, is_private,
         email_verified, completed_offers, users_referred, total_earning,
         earnings_30d, coins, created_at)
       VALUES (?, ?, ?, ?, ?, 'avc1', 1, 0, 0, 0, 0, 0, 0, 0, ?)`
    )
    .bind(id, username, email, hash, salt, now)
    .run();

  const { id: sessionId, expiresAt } = await createSession(db, id);

  const userRow = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();

  return json(
    { user: publicUser(userRow) },
    200,
    { "Set-Cookie": sessionCookieHeader(sessionId, expiresAt) }
  );
}
