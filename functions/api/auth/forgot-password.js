// functions/api/auth/forgot-password.js
import { normalizeEmail, newId, hashPassword, json, errorJson } from "../../_lib/auth.js";
import { sendEmail, otpEmailHtml } from "../../_lib/email.js";

// Keep these as constants so they're easy to tune later.
const OTP_MAX_PER_WINDOW = 2;
const OTP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Same response whether the email exists or not — never confirm/deny an
// account's existence from this endpoint (email enumeration protection).
const GENERIC_SUCCESS = { message: "If that email exists, we've sent a code." };

function generateOtp() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  // 100000–999999 inclusive
  const num = 100000 + (arr[0] % 900000);
  return String(num);
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request body.");
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return errorJson("Please enter your email address.");
  }

  const user = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();

  // Don't reveal whether the account exists.
  if (!user) {
    return json(GENERIC_SUCCESS);
  }

  // Rate limit: max OTP_MAX_PER_WINDOW requests per user per OTP_WINDOW_MS.
  const windowStart = Date.now() - OTP_WINDOW_MS;
  const row = await db
    .prepare("SELECT COUNT(*) as count FROM password_resets WHERE user_id = ? AND created_at >= ?")
    .bind(user.id, windowStart)
    .first();

  if ((row?.count || 0) >= OTP_MAX_PER_WINDOW) {
    return errorJson(
      "You've reached the OTP request limit. Please try again in a few hours.",
      429
    );
  }

  // Invalidate any previous unused OTPs for this user so an old code in an
  // old email can't still be used.
  await db
    .prepare("UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0")
    .bind(user.id)
    .run();

  const otp = generateOtp();
  // Reuse the same PBKDF2 hashing used for passwords — never store the OTP
  // in plaintext, so a DB leak can't be used to read out live codes.
  const { hash, salt } = await hashPassword(otp);
  const now = Date.now();

  await db
    .prepare(
      `INSERT INTO password_resets (id, user_id, otp_hash, otp_salt, created_at, expires_at, used)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
    )
    .bind(newId(), user.id, hash, salt, now, now + OTP_EXPIRY_MS)
    .run();

  try {
    await sendEmail(env, {
      to: email,
      subject: "Your earnbangla verification code",
      html: otpEmailHtml(otp),
    });
  } catch (ex) {
    // The OTP row already exists — that's fine, it'll just expire unused.
    // Don't leak provider error details to the client.
    return errorJson("Could not send the code right now. Please try again shortly.", 502);
  }

  return json(GENERIC_SUCCESS);
}
