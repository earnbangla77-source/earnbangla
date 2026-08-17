var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// _lib/auth.js
var SESSION_COOKIE = "eb_session";
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var PBKDF2_ITERATIONS = 1e5;
function newId() {
  return crypto.randomUUID().replace(/-/g, "");
}
__name(newId, "newId");
function toHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(toHex, "toHex");
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
__name(fromHex, "fromHex");
async function pbkdf2(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return toHex(bits);
}
__name(pbkdf2, "pbkdf2");
async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes);
  const hash = await pbkdf2(password, saltBytes);
  return { hash, salt };
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, salt, expectedHash) {
  const hash = await pbkdf2(password, fromHex(salt));
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}
__name(verifyPassword, "verifyPassword");
function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}
__name(parseCookies, "parseCookies");
function sessionCookieHeader(sessionId, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${SESSION_COOKIE}=${sessionId}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}
__name(sessionCookieHeader, "sessionCookieHeader");
function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}
__name(clearSessionCookieHeader, "clearSessionCookieHeader");
async function createSession(db, userId) {
  const id = newId();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(id, userId, now, expiresAt).run();
  return { id, expiresAt };
}
__name(createSession, "createSession");
async function deleteSession(db, sessionId) {
  if (!sessionId) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}
__name(deleteSession, "deleteSession");
async function getUserFromRequest(request, db) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const session = await db.prepare("SELECT * FROM sessions WHERE id = ?").bind(sessionId).first();
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    await deleteSession(db, sessionId);
    return null;
  }
  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(session.user_id).first();
  return user || null;
}
__name(getUserFromRequest, "getUserFromRequest");
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatar: row.avatar,
    level: row.level,
    isPrivate: !!row.is_private,
    emailVerified: !!row.email_verified,
    completedOffers: row.completed_offers,
    usersReferred: row.users_referred,
    totalEarning: row.total_earning,
    earnings30d: row.earnings_30d,
    coins: row.coins,
    createdAt: row.created_at
  };
}
__name(publicUser, "publicUser");
function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });
}
__name(json, "json");
function errorJson(message, status = 400) {
  return json({ error: message }, status);
}
__name(errorJson, "errorJson");
function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
__name(isValidEmail, "isValidEmail");
function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}
__name(normalizeEmail, "normalizeEmail");

// api/admin/dashboard-stats.js
var COINS_PER_DOLLAR = 1e3;
async function onRequestGet({ env }) {
  try {
    const db = env.DB;
    const pendingRow = await db.prepare(
      "SELECT COALESCE(SUM(coins_used), 0) AS coins, COUNT(*) AS cnt FROM withdrawals WHERE status = 'pending'"
    ).first();
    const totalUsersRow = await db.prepare("SELECT COUNT(*) AS cnt FROM users").first();
    const paidOutRow = await db.prepare(
      "SELECT COALESCE(SUM(amount_usd), 0) AS total FROM withdrawals WHERE status = 'completed'"
    ).first();
    const topEarnerRow = await db.prepare(
      "SELECT username, total_earning FROM users ORDER BY total_earning DESC LIMIT 1"
    ).first();
    const { results: recentRows } = await db.prepare(
      `SELECT w.id, w.method, w.address, w.amount_usd, w.coins_used, w.status, w.created_at,
                u.username, u.email
         FROM withdrawals w
         JOIN users u ON w.user_id = u.id
         ORDER BY w.created_at DESC
         LIMIT 10`
    ).all();
    const recentWithdrawals = recentRows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      method: row.method,
      address: row.address,
      amountUsd: row.amount_usd,
      coinsUsed: row.coins_used,
      status: row.status,
      createdAt: row.created_at
    }));
    return json({
      pendingPayoutUsd: pendingRow.coins / COINS_PER_DOLLAR,
      pendingCount: pendingRow.cnt,
      totalUsers: totalUsersRow.cnt,
      totalPaidOutUsd: paidOutRow.total,
      topEarner: topEarnerRow ? { username: topEarnerRow.username, totalEarning: topEarnerRow.total_earning } : null,
      recentWithdrawals
    });
  } catch (err) {
    console.error("admin/dashboard-stats GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
__name(onRequestGet, "onRequestGet");

// api/admin/users.js
async function onRequestGet2({ request, env }) {
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
    const countRow = await db.prepare(`SELECT COUNT(*) AS cnt FROM users ${where}`).bind(...binds).first();
    const { results } = await db.prepare(`SELECT * FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...binds, limit, offset).all();
    const users = results.map(publicUser);
    return json({ users, total: countRow.cnt, limit, offset });
  } catch (err) {
    console.error("admin/users GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
__name(onRequestGet2, "onRequestGet");

// api/admin/withdrawals.js
var VALID_STATUSES = ["pending", "completed", "rejected"];
async function onRequestGet3({ request, env }) {
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
      updatedAt: row.updated_at || null
    }));
    return json({ withdrawals });
  } catch (err) {
    console.error("admin/withdrawals GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
__name(onRequestGet3, "onRequestGet");

// api/admin/withdrawals-update.js
var VALID_STATUSES2 = ["completed", "rejected"];
async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    let body;
    try {
      body = await request.json();
    } catch {
      return errorJson("Invalid request body.");
    }
    const { id, status } = body;
    if (typeof id !== "string" || !id) {
      return errorJson("Missing withdrawal id.");
    }
    if (!VALID_STATUSES2.includes(status)) {
      return errorJson("Invalid status \u2014 must be 'completed' or 'rejected'.");
    }
    const withdrawal = await db.prepare("SELECT * FROM withdrawals WHERE id = ?").bind(id).first();
    if (!withdrawal) {
      return errorJson("Withdrawal request not found.", 404);
    }
    if (withdrawal.status !== "pending") {
      return errorJson(`This request is already ${withdrawal.status}.`);
    }
    const now = Date.now();
    if (status === "rejected") {
      await db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(withdrawal.coins_used, withdrawal.user_id).run();
    }
    const updateResult = await db.prepare(
      "UPDATE withdrawals SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
    ).bind(status, now, id).run();
    if (!updateResult.meta || updateResult.meta.changes === 0) {
      return errorJson("This request was already updated by someone else. Please refresh.");
    }
    const userRow = await db.prepare("SELECT username, email FROM users WHERE id = ?").bind(withdrawal.user_id).first();
    return json({
      withdrawal: {
        id: withdrawal.id,
        userId: withdrawal.user_id,
        username: userRow ? userRow.username : null,
        email: userRow ? userRow.email : null,
        method: withdrawal.method,
        address: withdrawal.address,
        amountUsd: withdrawal.amount_usd,
        coinsUsed: withdrawal.coins_used,
        status,
        createdAt: withdrawal.created_at,
        updatedAt: now
      }
    });
  } catch (err) {
    console.error("admin/withdrawals-update POST error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
__name(onRequestPost, "onRequestPost");

// _lib/email.js
async function sendEmail(env, { to, subject, html }) {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL || "earnbangla <support@earn-bangla.com>",
      to,
      subject,
      html
    })
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Resend API error (${res.status}): ${errBody}`);
  }
  return res.json();
}
__name(sendEmail, "sendEmail");
function otpEmailHtml(otp) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#0A0A0F;padding:32px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:420px;margin:0 auto;background:#14141F;border-radius:16px;overflow:hidden;">
    <tr>
      <td style="padding:28px 28px 8px;text-align:center;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-weight:800;font-size:20px;color:#F4F4F8;">
          earn<span style="color:#FF7A1A;">bangla</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 28px 4px;text-align:center;">
        <p style="color:#9A9AAD;font-size:14px;margin:0 0 20px;">Use this code to reset your password. It expires in 10 minutes.</p>
        <div style="display:inline-block;background:#0A0A0F;border:1px solid #232333;border-radius:12px;padding:16px 28px;">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:800;letter-spacing:8px;color:#FF7A1A;">${otp}</span>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 28px;text-align:center;">
        <p style="color:#67677A;font-size:12px;margin:0;">If you didn't request this, you can safely ignore this email \u2014 your password won't change.</p>
      </td>
    </tr>
  </table>
</div>`;
}
__name(otpEmailHtml, "otpEmailHtml");

// api/auth/forgot-password.js
var OTP_MAX_PER_WINDOW = 2;
var OTP_WINDOW_MS = 24 * 60 * 60 * 1e3;
var OTP_EXPIRY_MS = 10 * 60 * 1e3;
var GENERIC_SUCCESS = { message: "If that email exists, we've sent a code." };
function generateOtp() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  const num = 1e5 + arr[0] % 9e5;
  return String(num);
}
__name(generateOtp, "generateOtp");
async function onRequestPost2({ request, env }) {
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
  if (!user) {
    return json(GENERIC_SUCCESS);
  }
  const windowStart = Date.now() - OTP_WINDOW_MS;
  const row = await db.prepare("SELECT COUNT(*) as count FROM password_resets WHERE user_id = ? AND created_at >= ?").bind(user.id, windowStart).first();
  if ((row?.count || 0) >= OTP_MAX_PER_WINDOW) {
    return errorJson(
      "You've reached the OTP request limit. Please try again in a few hours.",
      429
    );
  }
  await db.prepare("UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0").bind(user.id).run();
  const otp = generateOtp();
  const { hash, salt } = await hashPassword(otp);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO password_resets (id, user_id, otp_hash, otp_salt, created_at, expires_at, used)
       VALUES (?, ?, ?, ?, ?, ?, 0)`
  ).bind(newId(), user.id, hash, salt, now, now + OTP_EXPIRY_MS).run();
  try {
    await sendEmail(env, {
      to: email,
      subject: "Your earnbangla verification code",
      html: otpEmailHtml(otp)
    });
  } catch (ex) {
    return errorJson("Could not send the code right now. Please try again shortly.", 502);
  }
  return json(GENERIC_SUCCESS);
}
__name(onRequestPost2, "onRequestPost");

// api/auth/login.js
async function onRequestPost3({ request, env }) {
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
  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    return errorJson("Invalid email or password.", 401);
  }
  const ok2 = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok2) {
    return errorJson("Invalid email or password.", 401);
  }
  const { id: sessionId, expiresAt } = await createSession(db, user.id);
  return json(
    { user: publicUser(user) },
    200,
    { "Set-Cookie": sessionCookieHeader(sessionId, expiresAt) }
  );
}
__name(onRequestPost3, "onRequestPost");

// api/auth/logout.js
async function onRequestPost4({ request, env }) {
  const db = env.DB;
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    await deleteSession(db, sessionId);
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
}
__name(onRequestPost4, "onRequestPost");

// api/auth/me.js
async function onRequestGet4({ request, env }) {
  const db = env.DB;
  const user = await getUserFromRequest(request, db);
  if (!user) {
    return errorJson("Not signed in.", 401);
  }
  return json({ user: publicUser(user) });
}
__name(onRequestGet4, "onRequestGet");

// api/auth/register.js
async function onRequestPost5({ request, env }) {
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
  const existing = await db.prepare("SELECT id FROM users WHERE email = ? OR username = ?").bind(email, username).first();
  if (existing) {
    return errorJson("An account with that email or username already exists.");
  }
  const { hash, salt } = await hashPassword(password);
  const id = newId();
  const now = Date.now();
  await db.prepare(
    `INSERT INTO users
        (id, username, email, password_hash, salt, avatar, level, is_private,
         email_verified, completed_offers, users_referred, total_earning,
         earnings_30d, coins, created_at)
       VALUES (?, ?, ?, ?, ?, 'avc1', 1, 0, 0, 0, 0, 0, 0, 0, ?)`
  ).bind(id, username, email, hash, salt, now).run();
  const { id: sessionId, expiresAt } = await createSession(db, id);
  const userRow = await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return json(
    { user: publicUser(userRow) },
    200,
    { "Set-Cookie": sessionCookieHeader(sessionId, expiresAt) }
  );
}
__name(onRequestPost5, "onRequestPost");

// api/auth/reset-password.js
var GENERIC_ERROR = "Invalid or expired code.";
async function onRequestPost6({ request, env }) {
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
  if (!newPassword || newPassword.length < 6) {
    return errorJson("Password must be at least 6 characters.");
  }
  const user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) {
    return errorJson(GENERIC_ERROR);
  }
  const now = Date.now();
  const reset = await db.prepare(
    `SELECT * FROM password_resets
       WHERE user_id = ? AND used = 0 AND expires_at >= ?
       ORDER BY created_at DESC LIMIT 1`
  ).bind(user.id, now).first();
  if (!reset) {
    return errorJson(GENERIC_ERROR);
  }
  const ok2 = await verifyPassword(otp, reset.otp_salt, reset.otp_hash);
  if (!ok2) {
    return errorJson(GENERIC_ERROR);
  }
  const { hash, salt } = await hashPassword(newPassword);
  await db.prepare("UPDATE users SET password_hash = ?, salt = ? WHERE id = ?").bind(hash, salt, user.id).run();
  await db.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").bind(reset.id).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id).run();
  return json({ message: "Password reset. Please sign in with your new password." });
}
__name(onRequestPost6, "onRequestPost");

// api/offers/cpagrip-feed.js
var CPAGRIP_USER_ID = "2549531";
var CPAGRIP_PUBKEY = "ea0cba2918d5147f28df6c3b2c342e55";
async function onRequestGet5(context) {
  const { request, env } = context;
  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }
  const feedUrl = `https://www.cpagrip.com/common/offer_feed_json.php?user_id=${CPAGRIP_USER_ID}&pubkey=${CPAGRIP_PUBKEY}&tracking_id=${encodeURIComponent(me.id)}`;
  try {
    const res = await fetch(feedUrl, {
      headers: {
        // Some CPA network feeds reject requests with no browser-like UA.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy"
      }
    });
    if (!res.ok) {
      console.error("cpagrip-feed: upstream status", res.status);
      return errorJson("CPAGrip feed request failed.", 502);
    }
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("cpagrip-feed: non-JSON response:", raw.slice(0, 300));
      return errorJson("CPAGrip returned an unexpected response.", 502);
    }
    const offers = data.offers || data.Offers || (Array.isArray(data) ? data : []);
    return json({ offers, raw: data });
  } catch (err) {
    console.error("cpagrip-feed error:", err);
    return errorJson("Could not reach CPAGrip.", 502);
  }
}
__name(onRequestGet5, "onRequestGet");

// api/offers/cpagrip-postback.js
function json2(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}
__name(json2, "json");
function errorJson2(message, status = 400) {
  return json2({ error: message }, status);
}
__name(errorJson2, "errorJson");
var COINS_PER_DOLLAR2 = 1e3;
async function onRequestPost7(context) {
  const { request, env } = context;
  try {
    const contentType = request.headers.get("content-type") || "";
    let params;
    if (contentType.includes("application/json")) {
      params = await request.json();
    } else {
      const formData = await request.formData();
      params = Object.fromEntries(formData.entries());
    }
    const password = params.password || "";
    const payout = parseFloat(params.payout);
    const offerId = String(params.offer_id || "");
    const trackingId = String(params.tracking_id || "");
    const expectedPassword = env.OFFERWALL_POSTBACK_PASSWORD || "";
    if (!expectedPassword || password !== expectedPassword) {
      console.error("cpagrip-postback: bad password");
      return errorJson2("Access Denied.", 403);
    }
    if (!trackingId || !offerId || !Number.isFinite(payout) || payout <= 0) {
      return errorJson2("Missing or invalid parameters.", 400);
    }
    const userId = trackingId;
    const coinsEarned = Math.round(payout * COINS_PER_DOLLAR2);
    const existing = await env.DB.prepare(
      `SELECT id FROM offer_completions WHERE provider = ? AND user_id = ? AND offer_id = ?`
    ).bind("cpagrip", userId, offerId).first();
    if (existing) {
      return json2({ status: "duplicate_ignored" });
    }
    const update = await env.DB.prepare(
      `UPDATE users SET coins = coins + ? WHERE id = ?`
    ).bind(coinsEarned, userId).run();
    if (!update.success || update.meta.changes === 0) {
      return errorJson2("User not found.", 404);
    }
    await env.DB.prepare(
      `INSERT INTO offer_completions (provider, user_id, offer_id, payout, coins_earned, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind("cpagrip", userId, offerId, payout, coinsEarned).run();
    return json2({ status: "ok" });
  } catch (err) {
    console.error("cpagrip-postback error:", err);
    return errorJson2(err.message || "Server error", 500);
  }
}
__name(onRequestPost7, "onRequestPost");

// api/offers/offery-feed.js
var OFFERY_API_KEY = "PASTE_YOUR_API_KEY_HERE";
async function onRequestGet6(context) {
  const { request, env } = context;
  const me = await getUserFromRequest(request, env.DB);
  if (!me) {
    return errorJson("Not signed in.", 401);
  }
  const feedUrl = `https://offery.io/api/?apikey=${encodeURIComponent(OFFERY_API_KEY)}`;
  try {
    const res = await fetch(feedUrl, {
      headers: {
        // Some offerwall feeds reject requests with no browser-like UA.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 earnbangla-offerwall-proxy"
      }
    });
    if (!res.ok) {
      console.error("offery-feed: upstream status", res.status);
      return errorJson("Offery feed request failed.", 502);
    }
    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error("offery-feed: non-JSON response:", raw.slice(0, 300));
      return errorJson("Offery returned an unexpected response.", 502);
    }
    const rows = Array.isArray(data.data) ? data.data : [];
    const offers = rows.map((row) => ({
      ...row,
      url: String(row.url || "").replace("USER_ID", encodeURIComponent(me.id))
    }));
    return json({ offers, raw: data });
  } catch (err) {
    console.error("offery-feed error:", err);
    return errorJson("Could not reach Offery.", 502);
  }
}
__name(onRequestGet6, "onRequestGet");

// api/offers/offery-postback.js
function ok() {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}
__name(ok, "ok");
function fail(message, status = 400) {
  console.error("offery-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}
__name(fail, "fail");
function md5(input) {
  function rotl(x, c) {
    return x << c | x >>> 32 - c;
  }
  __name(rotl, "rotl");
  function toHex2(num) {
    let s = "";
    for (let i = 0; i < 4; i++) s += (num >> i * 8 & 255).toString(16).padStart(2, "0");
    return s;
  }
  __name(toHex2, "toHex");
  const K = new Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const S = [
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21
  ];
  const utf8 = new TextEncoder().encode(input);
  const bitLen = utf8.length * 8;
  const bytes = Array.from(utf8);
  bytes.push(128);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 255);
  let a0 = 1732584193, b0 = 4023233417, c0 = 2562383102, d0 = 271733878;
  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const M = new Array(16);
    for (let j = 0; j < 16; j++) {
      const o = chunk + j * 4;
      M[j] = bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16 | bytes[o + 3] << 24;
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = B & C | ~B & D;
        g = i;
      } else if (i < 32) {
        F = D & B | ~D & C;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = 7 * i % 16;
      }
      F = F + A + K[i] + M[g] | 0;
      A = D;
      D = C;
      C = B;
      B = B + rotl(F, S[i]) | 0;
    }
    a0 = a0 + A | 0;
    b0 = b0 + B | 0;
    c0 = c0 + C | 0;
    d0 = d0 + D | 0;
  }
  return toHex2(a0) + toHex2(b0) + toHex2(c0) + toHex2(d0);
}
__name(md5, "md5");
async function handlePostback(request, env) {
  const url = new URL(request.url);
  let params = Object.fromEntries(url.searchParams.entries());
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") || "";
    let bodyParams = {};
    if (contentType.includes("application/json")) {
      bodyParams = await request.json();
    } else {
      const formData = await request.formData();
      bodyParams = Object.fromEntries(formData.entries());
    }
    params = { ...params, ...bodyParams };
  }
  const subId = String(params.subId || "");
  const transId = String(params.transId || "");
  const offerId = String(params.offer_id || "");
  const offerName = String(params.offer_name || "");
  const rewardRaw = params.reward;
  const reward = parseFloat(rewardRaw);
  const status = String(params.status || "1");
  const signature = String(params.signature || "");
  const secret = env.OFFERY_SECRET_KEY || "";
  if (!secret) return fail("Server not configured (missing OFFERY_SECRET_KEY).", 500);
  const expected = md5(subId + transId + rewardRaw + secret);
  if (!signature || signature !== expected) {
    return fail("Signature doesn't match.", 403);
  }
  if (!subId || !transId || !Number.isFinite(reward)) {
    return fail("Missing or invalid parameters.", 400);
  }
  const userId = subId;
  const coins = Math.round(Math.abs(reward));
  console.log("offery-postback:", { userId, transId, offerId, offerName, coins, status });
  if (status === "2") {
    const existing = await env.DB.prepare(
      `SELECT id, coins_earned FROM offer_completions WHERE provider = 'offery' AND transaction_id = ? AND status = 'credited'`
    ).bind(transId).first();
    if (!existing) {
      return ok();
    }
    await env.DB.prepare(`UPDATE users SET coins = MAX(coins - ?, 0) WHERE id = ?`).bind(existing.coins_earned, userId).run();
    await env.DB.prepare(`UPDATE offer_completions SET status = 'chargeback' WHERE id = ?`).bind(existing.id).run();
    return ok();
  }
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'offery' AND transaction_id = ?`
  ).bind(transId).first();
  if (dup) {
    return ok();
  }
  const update = await env.DB.prepare(`UPDATE users SET coins = coins + ? WHERE id = ?`).bind(coins, userId).run();
  if (!update.success || update.meta.changes === 0) {
    return fail("User not found.", 404);
  }
  await env.DB.prepare(
    `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES ('offery', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerId, transId, parseFloat(params.payout) || 0, coins).run();
  return ok();
}
__name(handlePostback, "handlePostback");
async function onRequestPost8(context) {
  try {
    return await handlePostback(context.request, context.env);
  } catch (err) {
    return fail(err.message || "Server error", 500);
  }
}
__name(onRequestPost8, "onRequestPost");
async function onRequestGet7(context) {
  try {
    return await handlePostback(context.request, context.env);
  } catch (err) {
    return fail(err.message || "Server error", 500);
  }
}
__name(onRequestGet7, "onRequestGet");

// api/profile/update.js
var VALID_AVATARS = ["avc1", "avc2", "avc3", "avc4", "avc5", "avc6"];
async function onRequestPost9({ request, env }) {
  const db = env.DB;
  const user = await getUserFromRequest(request, db);
  if (!user) {
    return errorJson("Not signed in.", 401);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return errorJson("Invalid request body.");
  }
  const updates = [];
  const values = [];
  if (typeof body.username === "string") {
    const username = body.username.trim();
    if (username.length < 3 || username.length > 24) {
      return errorJson("Username must be 3-24 characters.");
    }
    if (username !== user.username) {
      const clash = await db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").bind(username, user.id).first();
      if (clash) {
        return errorJson("That username is already taken.");
      }
    }
    updates.push("username = ?");
    values.push(username);
  }
  if (typeof body.avatar === "string") {
    if (!VALID_AVATARS.includes(body.avatar)) {
      return errorJson("Invalid avatar.");
    }
    updates.push("avatar = ?");
    values.push(body.avatar);
  }
  if (typeof body.isPrivate === "boolean") {
    updates.push("is_private = ?");
    values.push(body.isPrivate ? 1 : 0);
  }
  if (updates.length === 0) {
    return errorJson("Nothing to update.");
  }
  values.push(user.id);
  await db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).bind(...values).run();
  const updated = await db.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
  return json({ user: publicUser(updated) });
}
__name(onRequestPost9, "onRequestPost");

// api/withdraw/request.js
var VALID_METHODS = ["litecoin", "binance"];
var MIN_COINS = 200;
var COINS_PER_DOLLAR3 = 1e3;
async function onRequestPost10({ request, env }) {
  try {
    const db = env.DB;
    const user = await getUserFromRequest(request, db);
    if (!user) {
      return errorJson("Not signed in.", 401);
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return errorJson("Invalid request body.");
    }
    const { method, address } = body;
    if (!VALID_METHODS.includes(method)) {
      return errorJson("Invalid withdrawal method.");
    }
    const addressTrimmed = typeof address === "string" ? address.trim() : "";
    if (addressTrimmed.length < 4) {
      return errorJson("Please enter a valid withdrawal address.");
    }
    const coinsRequested = Math.round(Number(body.coinsUsed));
    if (!Number.isFinite(coinsRequested) || coinsRequested < MIN_COINS) {
      return errorJson(
        `Minimum withdrawal is ${MIN_COINS} coins ($${(MIN_COINS / COINS_PER_DOLLAR3).toFixed(2)}).`
      );
    }
    if (coinsRequested > user.coins) {
      return errorJson("You don't have enough coins for this withdrawal.");
    }
    const amountUsd = coinsRequested / COINS_PER_DOLLAR3;
    const id = newId();
    const now = Date.now();
    const updateResult = await db.prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?").bind(coinsRequested, user.id, coinsRequested).run();
    if (!updateResult.meta || updateResult.meta.changes === 0) {
      return errorJson("You don't have enough coins for this withdrawal.");
    }
    await db.prepare(
      "INSERT INTO withdrawals (id, user_id, method, address, amount_usd, coins_used, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
    ).bind(id, user.id, method, addressTrimmed, amountUsd, coinsRequested, now).run();
    const updatedUser = await db.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first();
    return json({
      user: publicUser(updatedUser),
      withdrawal: {
        id,
        method,
        address: addressTrimmed,
        amountUsd,
        coinsUsed: coinsRequested,
        status: "pending",
        createdAt: now
      }
    });
  } catch (err) {
    console.error("withdraw/request POST error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
__name(onRequestPost10, "onRequestPost");
async function onRequestGet8({ request, env }) {
  try {
    const db = env.DB;
    const user = await getUserFromRequest(request, db);
    if (!user) {
      return errorJson("Not signed in.", 401);
    }
    const { results } = await db.prepare(
      "SELECT id, method, address, amount_usd, coins_used, status, created_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
    ).bind(user.id).all();
    const withdrawals = results.map((row) => ({
      id: row.id,
      method: row.method,
      address: row.address,
      amountUsd: row.amount_usd,
      coinsUsed: row.coins_used,
      status: row.status,
      createdAt: row.created_at
    }));
    return json({ withdrawals });
  } catch (err) {
    console.error("withdraw/request GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
__name(onRequestGet8, "onRequestGet");

// api/activity.js
async function onRequestGet9({ env }) {
  const db = env.DB;
  if (!db) return errorJson("DB not bound", 500);
  const { results } = await db.prepare(
    `SELECT u.username AS username, u.avatar AS avatar,
              a.coins_earned AS coinsEarned, a.created_at AS createdAt
       FROM activity_log a
       JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC
       LIMIT 12`
  ).all();
  return json({ activity: results || [] });
}
__name(onRequestGet9, "onRequestGet");

// api/leaderboard.js
var RANK_PRIZES = {
  1: 2e3,
  2: 1700,
  3: 1500,
  4: 1300,
  5: 1e3,
  6: 900,
  7: 700,
  8: 500,
  9: 300,
  10: 100
};
var LIMIT = 50;
function prizeFor(rank) {
  return RANK_PRIZES[rank] || 0;
}
__name(prizeFor, "prizeFor");
async function onRequestGet10(context) {
  const { env, request } = context;
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, username, avatar, coins
       FROM users
       WHERE is_private = 0
       ORDER BY coins DESC, created_at ASC
       LIMIT ?`
    ).bind(LIMIT).all();
    const entries = results.map((u, i) => ({
      rank: i + 1,
      username: u.username,
      avatar: u.avatar,
      coins: u.coins,
      prize: prizeFor(i + 1)
    }));
    let your_rank = null;
    const me = await getUserFromRequest(request, env.DB);
    if (me && me.is_private === 0) {
      const higherRow = await env.DB.prepare(
        `SELECT COUNT(*) as higher
         FROM users
         WHERE is_private = 0
           AND (coins > ? OR (coins = ? AND created_at < ?))`
      ).bind(me.coins, me.coins, me.created_at).first();
      your_rank = higherRow.higher + 1;
    }
    return json({ your_rank, entries });
  } catch (err) {
    return errorJson("Failed to load leaderboard", 500);
  }
}
__name(onRequestGet10, "onRequestGet");

// ../.wrangler/tmp/pages-OHBxib/functionsRoutes-0.1755323443045128.mjs
var routes = [
  {
    routePath: "/api/admin/dashboard-stats",
    mountPath: "/api/admin",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/admin/users",
    mountPath: "/api/admin",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet2]
  },
  {
    routePath: "/api/admin/withdrawals",
    mountPath: "/api/admin",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet3]
  },
  {
    routePath: "/api/admin/withdrawals-update",
    mountPath: "/api/admin",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/auth/forgot-password",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/auth/login",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/auth/logout",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost4]
  },
  {
    routePath: "/api/auth/me",
    mountPath: "/api/auth",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet4]
  },
  {
    routePath: "/api/auth/register",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost5]
  },
  {
    routePath: "/api/auth/reset-password",
    mountPath: "/api/auth",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost6]
  },
  {
    routePath: "/api/offers/cpagrip-feed",
    mountPath: "/api/offers",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet5]
  },
  {
    routePath: "/api/offers/cpagrip-postback",
    mountPath: "/api/offers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost7]
  },
  {
    routePath: "/api/offers/offery-feed",
    mountPath: "/api/offers",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet6]
  },
  {
    routePath: "/api/offers/offery-postback",
    mountPath: "/api/offers",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet7]
  },
  {
    routePath: "/api/offers/offery-postback",
    mountPath: "/api/offers",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost8]
  },
  {
    routePath: "/api/profile/update",
    mountPath: "/api/profile",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost9]
  },
  {
    routePath: "/api/withdraw/request",
    mountPath: "/api/withdraw",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet8]
  },
  {
    routePath: "/api/withdraw/request",
    mountPath: "/api/withdraw",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost10]
  },
  {
    routePath: "/api/activity",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet9]
  },
  {
    routePath: "/api/leaderboard",
    mountPath: "/api",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet10]
  }
];

// ../../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// ../../../../AppData/Roaming/npm/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");
export {
  pages_template_worker_default as default
};
