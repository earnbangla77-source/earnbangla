// functions/_lib/auth.js
// Shared helpers used by every /api/auth/* and /api/profile/* function.

const SESSION_COOKIE = "eb_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITERATIONS = 100000;

// ---------- ids ----------

export function newId() {
  // 32 hex chars, plenty unique for users/sessions in this app
  return crypto.randomUUID().replace(/-/g, "");
}

// ---------- password hashing (PBKDF2-SHA256) ----------

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

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
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = toHex(saltBytes);
  const hash = await pbkdf2(password, saltBytes);
  return { hash, salt };
}

export async function verifyPassword(password, salt, expectedHash) {
  const hash = await pbkdf2(password, fromHex(salt));
  // constant-time-ish compare
  if (hash.length !== expectedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return diff === 0;
}

// ---------- cookies ----------

export function parseCookies(request) {
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

export function sessionCookieHeader(sessionId, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${SESSION_COOKIE}=${sessionId}; Path=/; Expires=${expires}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookieHeader() {
  return `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`;
}

// ---------- sessions ----------

export async function createSession(db, userId) {
  const id = newId();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db
    .prepare(
      "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
    )
    .bind(id, userId, now, expiresAt)
    .run();
  return { id, expiresAt };
}

export async function deleteSession(db, sessionId) {
  if (!sessionId) return;
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

// Returns the user row for the current request's session cookie, or null.
export async function getUserFromRequest(request, db) {
  const cookies = parseCookies(request);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const session = await db
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .bind(sessionId)
    .first();
  if (!session) return null;

  if (session.expires_at < Date.now()) {
    await deleteSession(db, sessionId);
    return null;
  }

  const user = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(session.user_id)
    .first();
  return user || null;
}

// ---------- shaping ----------

// Converts a DB row (snake_case) into the camelCase shape the frontend expects.
export function publicUser(row) {
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
    createdAt: row.created_at,
  };
}

// ---------- misc ----------

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export function errorJson(message, status = 400) {
  return json({ error: message }, status);
}

export function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export { SESSION_COOKIE };
