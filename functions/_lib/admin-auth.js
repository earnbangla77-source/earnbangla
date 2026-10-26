// functions/_lib/admin-auth.js
// Admin লগইন হেল্পার — D1 টেবিল লাগে না।
// পাসওয়ার্ড থাকে Cloudflare Variable-এ: ADMIN_PASSWORD
// লগইন হলে একটা সই-করা (HMAC) কুকি সেট হয়; পাসওয়ার্ড বদলালে সব পুরনো লগইন নিজে থেকে বাতিল হয়ে যায়।

const enc = new TextEncoder();

export const ADMIN_EMAIL = "support@earn-bangla.com";
export const COOKIE_NAME = "admin_session";
export const SESSION_SECONDS = 60 * 60 * 24; // ২৪ ঘণ্টা

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

// ইনপুট পাসওয়ার্ড ADMIN_PASSWORD-এর সাথে মেলে কিনা (timing-safe)
export async function checkPassword(env, input) {
  const secret = String(env.ADMIN_PASSWORD || "");
  if (!secret) return false;
  const a = await hmacHex("admin-pw-check", String(input || ""));
  const b = await hmacHex("admin-pw-check", secret);
  return safeEqual(a, b);
}

export async function makeToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const sig = await hmacHex(String(env.ADMIN_PASSWORD), "admin|" + exp);
  return exp + "." + sig;
}

export function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = parseInt(expStr, 10);
  if (!exp || !sig || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(String(env.ADMIN_PASSWORD), "admin|" + exp);
  return safeEqual(sig, expected);
}

// প্রতিটা admin API-র শুরুতে ব্যবহার করো:
//   const denied = await requireAdmin(context);
//   if (denied) return denied;
export async function requireAdmin(context) {
  if (await isAdmin(context.request, context.env)) return null;
  return json({ error: "Unauthorized" }, 401);
}
