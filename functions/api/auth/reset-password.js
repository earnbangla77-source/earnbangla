// functions/api/auth/reset-password.js
import { normalizeEmail, verifyPassword, hashPassword, json, errorJson } from "../../_lib/auth.js";

// One generic error for every failure mode (email not found, OTP wrong,
// OTP expired) — so a response can't be used to figure out which emails
// are registered.
const GENERIC_ERROR = "Invalid or expired code.";

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request body.");
  }

  const email = normalizeEmail(body.email);
  const otp = (body.otp || "").trim();
  const newPassword = body.newPassword || "";

  if (!email || !otp) {
    return errorJson(GENERIC_ERROR);
  }
  // Same minimum length as register.js, so both endpoints agree.
  if (!newPassword || newPassword.length < 6) {
    return errorJson("Password must be at least 6 characters.");
  }

  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    return errorJson(GENERIC_ERROR);
  }

  const now = Date.now();
  const reset = await db
    .prepare(
      `SELECT * FROM password_resets
       WHERE user_id = ? AND used = 0 AND expires_at >= ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(user.id, now)
    .first();

  if (!reset) {
    return errorJson(GENERIC_ERROR);
  }

  const ok = await verifyPassword(otp, reset.otp_salt, reset.otp_hash);
  if (!ok) {
    return errorJson(GENERIC_ERROR);
  }

  const { hash, salt } = await hashPassword(newPassword);

  await db
    .prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?")
    .bind(hash, salt, user.id)
    .run();

  await db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").bind(reset.id).run();

  // Security bonus: kill every existing session for this user, so anyone
  // who had a session going (e.g. an account hijacker) gets logged out too.
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();

  return json({ message: "Password reset. Please sign in with your new password." });
}
