// functions/api/offers/adbreakmedia-postback.js
//
// ⚠️ Place this file at functions/api/offers/adbreakmedia-postback.js
//    (sibling to offery-postback.js)
//
// *** DEBUG VERSION *** — logs every step with the "adbreak-debug" prefix.
// Watch it live with:
//   npx wrangler pages deployment tail --project-name=earnbangla --environment production --format pretty
// Once everything works, remove the dbg() calls (or set DEBUG = false).
//
// Receives server-to-server postbacks from AdBreak Media when a user
// completes an offer. Postback URL to paste into the AdBreak placement:
//
//   https://earn-bangla.com/api/offers/adbreakmedia-postback?user=[YOUR_USER_ID]&reward=[REWARD_VALUE]&offerName=[OFFER_NAME]&offerId=[OFFER_ID]&ip=[USER_IP]&status=[STATUS]&transaction_id=[TXID]&country=[COUNTRY]&is_multi=[MULTI_EVENT]&ename=[EVENT_NAME]&eid=[EVENT_ID]&payout=[PAYOUT]&hash=[HASH]&sub1=[SUB1]&sub2=[SUB2]
//
// Params AdBreak sends:
//   user            - the earnbangla user's id
//   reward          - coins (already converted by the placement's Exchange Rate 1000)
//   offerName / offerId / ip / country / is_multi / ename / eid - info
//   status          - "completed" = credit, "rejected" = chargeback
//   transaction_id  - AdBreak's unique conversion id (TXID)
//   payout          - USD payout (stored for reference)
//   hash            - SHA256(user + offerId + txid + PUBLISHER_SECRET_KEY)
//
// Returns plain "ok" (HTTP 200) on success — body must not contain "fail"/"error".
//
// ⚠️ Requires env.ADBREAK_SECRET_KEY (AdBreak → Settings → Secret Credentials → Secret Key)
//    and a fresh deploy after setting it.
// ⚠️ Uses the shared offer_completions table, same as offery-postback.js.

const DEBUG = true;
const ENFORCE_IP_WHITELIST = false;
const ALLOWED_IPS = ["139.144.178.218"];

function dbg(label, data) {
  if (!DEBUG) return;
  try {
    console.log("adbreak-debug [" + label + "]", data === undefined ? "" : JSON.stringify(data));
  } catch (e) {
    console.log("adbreak-debug [" + label + "]", String(data));
  }
}

function ok(tag) {
  dbg("RESPOND ok", tag || "");
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
}

function reject(message, status = 400) {
  console.error("adbreakmedia-postback:", message);
  dbg("RESPOND " + status, message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handlePostback(request, env) {
  const url = new URL(request.url);
  let params = Object.fromEntries(url.searchParams.entries());

  dbg("1 received", {
    method: request.method,
    path: url.pathname,
    paramKeys: Object.keys(params),
    params, // full query (hash included; secret is never in the request)
    cfIp: request.headers.get("cf-connecting-ip"),
  });

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
    dbg("1b POST body merged", { contentType, bodyKeys: Object.keys(bodyParams) });
  }

  // Optional IP whitelist
  if (ENFORCE_IP_WHITELIST) {
    const ip =
      request.headers.get("cf-connecting-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    if (!ALLOWED_IPS.includes(ip)) {
      return reject("Access Denied", 403);
    }
  }

  const userId = String(params.user || "");
  const offerId = String(params.offerId || "");
  const offerName = String(params.offerName || "");
  const transId = String(params.transaction_id || params.txid || "");
  const reward = parseFloat(params.reward ?? params.coins);
  const status = String(params.status || "completed").toLowerCase();
  const receivedHash = String(params.hash || "").toLowerCase();

  dbg("2 parsed", {
    userId, offerId, transId, offerName, reward, status,
    receivedHash,
    missing: {
      user: !userId, offerId: !offerId, transId: !transId,
      hash: !receivedHash, reward: !Number.isFinite(reward),
    },
  });

  const secret = env.ADBREAK_SECRET_KEY || "";
  dbg("3 secret", {
    present: !!secret,
    length: secret.length,           // should be 64
    hasWhitespace: /\s/.test(secret), // should be false
    trimmedLength: secret.trim().length,
  });
  if (!secret) return reject("Server not configured (missing ADBREAK_SECRET_KEY).", 500);

  // Verify the hash: SHA256(user + offerId + txid + secret)
  const expected = await sha256Hex(userId + offerId + transId + secret);

  // Extra diagnostics (log only — none of these are accepted as valid).
  const trimmed = secret.trim();
  const variants = {
    exact: expected,
    trimmedSecret: await sha256Hex(userId + offerId + transId + trimmed),
    altOfferIdParam: await sha256Hex(userId + String(params.offer_id || "") + transId + trimmed),
    noOfferId: await sha256Hex(userId + transId + trimmed),
    withPayout: await sha256Hex(userId + offerId + transId + String(params.payout || "") + trimmed),
  };
  const matchedVariants = Object.keys(variants).filter((k) => variants[k] === receivedHash);

  dbg("4 hash check", {
    inputShape: "user + offerId + txid + secret",
    inputLengthWithoutSecret: (userId + offerId + transId).length,
    receivedHash,
    expected,
    exactMatch: receivedHash === expected,
    matchedVariants, // e.g. ["trimmedSecret"] → secret in wrangler has stray whitespace
  });

  if (!receivedHash || receivedHash !== expected) {
    return reject("Unauthorized", 403);
  }
  dbg("4b hash OK");

  // Validate required fields
  if (!userId || !transId || !Number.isFinite(reward)) {
    return reject("Missing or invalid parameters.", 400);
  }

  const coins = Math.round(Math.abs(reward));
  dbg("5 validated", { userId, transId, offerId, coins, status });
  console.log("adbreakmedia-postback:", {
    userId, transId, offerId, offerName, coins, status,
    country: params.country, ip: params.ip, multi: params.is_multi, event: params.ename,
  });

  if (status === "rejected") {
    // ---- Chargeback: reverse a previous credit, if one exists ----
    const existing = await env.DB.prepare(
      `SELECT id, user_id, coins_earned FROM offer_completions
       WHERE provider = 'adbreakmedia' AND transaction_id = ? AND status = 'credited'`
    ).bind(transId).first();
    dbg("6 chargeback lookup", { found: !!existing, existing });

    if (!existing) {
      return ok("chargeback: nothing to reverse");
    }

    const upd = await env.DB.prepare(
      `UPDATE users
       SET coins = MAX(coins - ?, 0),
           completed_offers = MAX(completed_offers - 1, 0),
           total_earning = MAX(total_earning - ?, 0)
       WHERE id = ?`
    ).bind(existing.coins_earned, existing.coins_earned, existing.user_id).run();
    dbg("7 chargeback user update", { changes: upd.meta && upd.meta.changes, userId: existing.user_id });

    await env.DB.prepare(`UPDATE offer_completions SET status = 'chargeback' WHERE id = ?`)
      .bind(existing.id).run();
    dbg("8 chargeback row marked", { id: existing.id });

    return ok("chargeback done");
  }

  if (status !== "completed") {
    dbg("6 unknown status ignored", { transId, status });
    return ok("unknown status ignored");
  }

  // ---- Credit ----
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'adbreakmedia' AND transaction_id = ?`
  ).bind(transId).first();
  dbg("6 duplicate check", { duplicate: !!dup });

  if (dup) {
    return ok("duplicate, already processed");
  }

  const update = await env.DB.prepare(
    `UPDATE users
     SET coins = coins + ?,
         completed_offers = completed_offers + 1,
         total_earning = total_earning + ?
     WHERE id = ?`
  ).bind(coins, coins, userId).run();

  const matched = update.success && update.meta.changes > 0;
  dbg("7 user update", { success: update.success, changes: update.meta && update.meta.changes, matched });
  if (!matched) {
    console.log("adbreakmedia-postback: no matching user, recorded anyway", { userId, transId });
  }

  await env.DB.prepare(
    `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES ('adbreakmedia', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(userId, offerId, transId, parseFloat(params.payout) || 0, coins).run();
  dbg("8 completion row inserted", { userId, transId, coins, payout: parseFloat(params.payout) || 0 });

  return ok(matched ? "credited" : "recorded (no matching user)");
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) {
    dbg("EXCEPTION", { message: err && err.message, stack: err && err.stack });
    return reject(err.message || "Server error", 500);
  }
}

export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) {
    dbg("EXCEPTION", { message: err && err.message, stack: err && err.stack });
    return reject(err.message || "Server error", 500);
  }
}
