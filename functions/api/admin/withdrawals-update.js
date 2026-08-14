// functions/api/admin/withdrawals-update.js
// TODO: admin-only auth check here (this endpoint is public until admin auth is added — see PROJECT-STATUS.md)
import { json, errorJson } from "../../_lib/auth.js";

// Fixed list — this endpoint only moves a request out of 'pending'.
// It never accepts 'pending' itself, so a request can't be reopened this way.
const VALID_STATUSES = ["completed", "rejected"];

export async function onRequestPost({ request, env }) {
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
    if (!VALID_STATUSES.includes(status)) {
      return errorJson("Invalid status — must be 'completed' or 'rejected'.");
    }

    const withdrawal = await db
      .prepare("SELECT * FROM withdrawals WHERE id = ?")
      .bind(id)
      .first();

    if (!withdrawal) {
      return errorJson("Withdrawal request not found.", 404);
    }
    if (withdrawal.status !== "pending") {
      return errorJson(`This request is already ${withdrawal.status}.`);
    }

    const now = Date.now();

    // Rejecting a request means the user never got paid, so the coins that
    // were deducted at request time (see withdraw/request.js) need to go
    // back to their balance — otherwise a rejection silently destroys coins.
    // Approving doesn't touch coins: they were already deducted, and
    // approval just confirms the payout actually happened.
    if (status === "rejected") {
      await db
        .prepare("UPDATE users SET coins = coins + ? WHERE id = ?")
        .bind(withdrawal.coins_used, withdrawal.user_id)
        .run();
    }

    const updateResult = await db
      .prepare(
        "UPDATE withdrawals SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending'"
      )
      .bind(status, now, id)
      .run();

    if (!updateResult.meta || updateResult.meta.changes === 0) {
      // Someone else resolved it between our read and write above.
      return errorJson("This request was already updated by someone else. Please refresh.");
    }

    const userRow = await db
      .prepare("SELECT username, email FROM users WHERE id = ?")
      .bind(withdrawal.user_id)
      .first();

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
        updatedAt: now,
      },
    });
  } catch (err) {
    console.error("admin/withdrawals-update POST error:", err);
    return errorJson("Server error: " + (err && err.message ? err.message : String(err)), 500);
  }
}
