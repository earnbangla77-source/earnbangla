// functions/api/withdraw/request.js
import { getUserFromRequest, publicUser, json, errorJson, newId } from "../../_lib/auth.js";

const VALID_METHODS = ["litecoin", "binance"];
const MIN_COINS = 200;
const COINS_PER_DOLLAR = 1000; // 200 coins = $0.20

export async function onRequestPost({ request, env }) {
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

    // Never trust the client's coin math — recompute from whichever value it sent.
    const coinsRequested = Math.round(Number(body.coinsUsed));
    if (!Number.isFinite(coinsRequested) || coinsRequested < MIN_COINS) {
      return errorJson(
        `Minimum withdrawal is ${MIN_COINS} coins ($${(MIN_COINS / COINS_PER_DOLLAR).toFixed(2)}).`
      );
    }

    if (coinsRequested > user.coins) {
      return errorJson("You don't have enough coins for this withdrawal.");
    }

    const amountUsd = coinsRequested / COINS_PER_DOLLAR;
    const id = newId();
    const now = Date.now();

    // Deduct coins first, guarded so it can't go negative under a race.
    const updateResult = await db
      .prepare("UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?")
      .bind(coinsRequested, user.id, coinsRequested)
      .run();

    if (!updateResult.meta || updateResult.meta.changes === 0) {
      return errorJson("You don't have enough coins for this withdrawal.");
    }

    await db
      .prepare(
        "INSERT INTO withdrawals (id, user_id, method, address, amount_usd, coins_used, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)"
      )
      .bind(id, user.id, method, addressTrimmed, amountUsd, coinsRequested, now)
      .run();

    const updatedUser = await db
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(user.id)
      .first();

    return json({
      user: publicUser(updatedUser),
      withdrawal: {
        id,
        method,
        address: addressTrimmed,
        amountUsd,
        coinsUsed: coinsRequested,
        status: "pending",
        createdAt: now,
      },
    });
  } catch (err) {
    // Surface the real reason as JSON instead of letting Cloudflare's default
    // HTML error page through — that's what was showing up as a generic
    // "Something went wrong" on the frontend with no clue what actually failed.
    console.error("withdraw/request POST error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}

// Lets a signed-in user list their own withdrawal history
// (handy for a future "My withdrawals" page / the profile Withdrawals tab).
export async function onRequestGet({ request, env }) {
  try {
    const db = env.DB;
    const user = await getUserFromRequest(request, db);
    if (!user) {
      return errorJson("Not signed in.", 401);
    }

    const { results } = await db
      .prepare(
        "SELECT id, method, address, amount_usd, coins_used, status, created_at FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50"
      )
      .bind(user.id)
      .all();

    const withdrawals = results.map((row) => ({
      id: row.id,
      method: row.method,
      address: row.address,
      amountUsd: row.amount_usd,
      coinsUsed: row.coins_used,
      status: row.status,
      createdAt: row.created_at,
    }));

    return json({ withdrawals });
  } catch (err) {
    console.error("withdraw/request GET error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
