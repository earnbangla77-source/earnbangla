// functions/api/offers/adswedmedia-postback.js
//
// ⚠️ Place this file at functions/api/offers/adswedmedia-postback.js
//    (sibling to offery-postback.js, revtoo-postback.js, admantum-postback.js, etc.)
//
// Receives server-to-server postbacks from AdswedMedia when a user
// completes an offer. Confirmed against AdswedMedia's own official
// documentation (iFrame + S2S Postback page) shared in this conversation —
// NOT the same as the earlier taskwall-postback.js draft, which was
// written against the wrong (taskwall.io) spec. Key differences from that
// draft:
//   - Auth is a real MD5 SIGNATURE, not a plain shared password:
//       signature == MD5(subId + transId + reward + secret)
//     (no separator between the concatenated fields, per AdswedMedia's
//     own PHP example)
//   - There IS a real unique transaction id: `transId`. No synthetic
//     dedupe key needed — dedupe directly on transId.
//   - There IS a status/reversal param: `status` = 1 (credit) or
//     2 (subtract — advertiser cancellation/fraud/mistake). This file
//     must credit on 1 and reverse (never below 0) on 2.
//   - Expected response text is "OK" for a new transaction and "DUP" for
//     an already-processed one (matches RadiantWall/PaidBucksy, not the
//     old taskwall draft's OK-only/idempotent behavior).
//   - Method is GET (per docs) — this file reads querystring params
//     first, with POST body as a fallback only (see the
//     "Provider POST বললেও params URL query string-এ" note in the
//     master guide's troubleshooting section).
//
// Postback params (from AdswedMedia's own docs):
//   subId        - the earn-bangla.com user's id
//   transId      - AdswedMedia's unique transaction id (used for dedupe)
//   reward       - coins to credit (absolute value; already in your
//                   virtual currency per the Setup page config)
//   round_reward - reward rounded to configured decimals (not stored;
//                   we round `reward` ourselves for the coins column)
//   payout       - offer payout in USD, stored for reference
//   signature    - MD5(subId + transId + reward + secret)
//   status       - 1 = credit, 2 = subtract (reversal)
//   userIp       - logged only, not stored
//   offer_id     - AdswedMedia's offer id
//   offer_name   - logged only, not stored
//   country      - logged only, not stored
//   uuid         - AdswedMedia's click id, logged only, not stored
//   event_id     - logged only, not stored
//   event_name   - logged only, not stored
//
// Expected response: exact text "OK" (new transaction) or "DUP"
// (duplicate transaction) — per AdswedMedia's docs.
//
// ⚠️ Requires env.ADSWEDMEDIA_SECRET_KEY — set this to the SAME Secret Key
//    shown on the AdswedMedia Setup page for this placement
//    (screenshot value: Mc3Aj0Sg8Mo0Cv6):
//
//   wrangler pages secret put ADSWEDMEDIA_SECRET_KEY --project-name=earnbangla
//   wrangler pages secret put ADSWEDMEDIA_SECRET_KEY --project-name=earnbangla --env preview
//
// ⚠️ Reuses the same offer_completions table (provider, user_id, offer_id,
//    transaction_id, payout, coins_earned, status, created_at) already
//    used for the other providers — NO new D1 migration needed, this just
//    inserts rows with provider = 'adswedmedia'.
//
// Same earnings-tracking fix as the other providers: crediting a
// completion bumps users.coins AND users.completed_offers AND
// users.total_earning (and a reversal decrements all three, never below 0).

// Pure-JS MD5 (RFC1321) — Cloudflare's Web Crypto API only has
// SHA-1/256/384/512, no MD5. Verified against Node.js's built-in MD5.
function md5(input) {
  function rotateLeft(x, c) { return (x << c) | (x >>> (32 - c)); }
  function addUnsigned(x, y) {
    const x4 = x & 0x40000000, y4 = y & 0x40000000;
    const x8 = x & 0x80000000, y8 = y & 0x80000000;
    const result = (x & 0x3fffffff) + (y & 0x3fffffff);
    if (x4 & y4) return result ^ 0x80000000 ^ x8 ^ y8;
    if (x4 | y4) {
      if (result & 0x40000000) return result ^ 0xc0000000 ^ x8 ^ y8;
      return result ^ 0x40000000 ^ x8 ^ y8;
    }
    return result ^ x8 ^ y8;
  }
  function F(x, y, z) { return (x & y) | (~x & z); }
  function G(x, y, z) { return (x & z) | (y & ~z); }
  function H(x, y, z) { return x ^ y ^ z; }
  function I(x, y, z) { return y ^ (x | ~z); }
  function FF(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function GG(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function HH(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function II(a, b, c, d, x, s, ac) {
    a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
    return addUnsigned(rotateLeft(a, s), b);
  }
  function convertToWordArray(str) {
    let wordCount;
    const messageLength = str.length;
    const numberOfWordsTemp1 = messageLength + 8;
    const numberOfWordsTemp2 = (numberOfWordsTemp1 - (numberOfWordsTemp1 % 64)) / 64;
    const numberOfWords = (numberOfWordsTemp2 + 1) * 16;
    const wordArray = new Array(numberOfWords - 1);
    let bytePosition = 0, byteCount = 0;
    while (byteCount < messageLength) {
      wordCount = (byteCount - (byteCount % 4)) / 4;
      bytePosition = (byteCount % 4) * 8;
      wordArray[wordCount] = wordArray[wordCount] | (str.charCodeAt(byteCount) << bytePosition);
      byteCount++;
    }
    wordCount = (byteCount - (byteCount % 4)) / 4;
    bytePosition = (byteCount % 4) * 8;
    wordArray[wordCount] = wordArray[wordCount] | (0x80 << bytePosition);
    wordArray[numberOfWords - 2] = messageLength << 3;
    wordArray[numberOfWords - 1] = messageLength >>> 29;
    return wordArray;
  }
  function wordToHex(value) {
    let hex = "", byte, count;
    for (count = 0; count <= 3; count++) {
      byte = (value >>> (count * 8)) & 255;
      hex += ("0" + byte.toString(16)).slice(-2);
    }
    return hex;
  }
  function utf8Encode(str) {
    return unescape(encodeURIComponent(str));
  }

  let x = [];
  let k, AA, BB, CC, DD, a, b, c, d;
  const S11 = 7, S12 = 12, S13 = 17, S14 = 22;
  const S21 = 5, S22 = 9, S23 = 14, S24 = 20;
  const S31 = 4, S32 = 11, S33 = 16, S34 = 23;
  const S41 = 6, S42 = 10, S43 = 15, S44 = 21;

  const utfInput = utf8Encode(input);
  x = convertToWordArray(utfInput);
  a = 0x67452301; b = 0xefcdab89; c = 0x98badcfe; d = 0x10325476;

  for (k = 0; k < x.length; k += 16) {
    AA = a; BB = b; CC = c; DD = d;
    a = FF(a, b, c, d, x[k + 0], S11, 0xd76aa478);
    d = FF(d, a, b, c, x[k + 1], S12, 0xe8c7b756);
    c = FF(c, d, a, b, x[k + 2], S13, 0x242070db);
    b = FF(b, c, d, a, x[k + 3], S14, 0xc1bdceee);
    a = FF(a, b, c, d, x[k + 4], S11, 0xf57c0faf);
    d = FF(d, a, b, c, x[k + 5], S12, 0x4787c62a);
    c = FF(c, d, a, b, x[k + 6], S13, 0xa8304613);
    b = FF(b, c, d, a, x[k + 7], S14, 0xfd469501);
    a = FF(a, b, c, d, x[k + 8], S11, 0x698098d8);
    d = FF(d, a, b, c, x[k + 9], S12, 0x8b44f7af);
    c = FF(c, d, a, b, x[k + 10], S13, 0xffff5bb1);
    b = FF(b, c, d, a, x[k + 11], S14, 0x895cd7be);
    a = FF(a, b, c, d, x[k + 12], S11, 0x6b901122);
    d = FF(d, a, b, c, x[k + 13], S12, 0xfd987193);
    c = FF(c, d, a, b, x[k + 14], S13, 0xa679438e);
    b = FF(b, c, d, a, x[k + 15], S14, 0x49b40821);
    a = GG(a, b, c, d, x[k + 1], S21, 0xf61e2562);
    d = GG(d, a, b, c, x[k + 6], S22, 0xc040b340);
    c = GG(c, d, a, b, x[k + 11], S23, 0x265e5a51);
    b = GG(b, c, d, a, x[k + 0], S24, 0xe9b6c7aa);
    a = GG(a, b, c, d, x[k + 5], S21, 0xd62f105d);
    d = GG(d, a, b, c, x[k + 10], S22, 0x02441453);
    c = GG(c, d, a, b, x[k + 15], S23, 0xd8a1e681);
    b = GG(b, c, d, a, x[k + 4], S24, 0xe7d3fbc8);
    a = GG(a, b, c, d, x[k + 9], S21, 0x21e1cde6);
    d = GG(d, a, b, c, x[k + 14], S22, 0xc33707d6);
    c = GG(c, d, a, b, x[k + 3], S23, 0xf4d50d87);
    b = GG(b, c, d, a, x[k + 8], S24, 0x455a14ed);
    a = GG(a, b, c, d, x[k + 13], S21, 0xa9e3e905);
    d = GG(d, a, b, c, x[k + 2], S22, 0xfcefa3f8);
    c = GG(c, d, a, b, x[k + 7], S23, 0x676f02d9);
    b = GG(b, c, d, a, x[k + 12], S24, 0x8d2a4c8a);
    a = HH(a, b, c, d, x[k + 5], S31, 0xfffa3942);
    d = HH(d, a, b, c, x[k + 8], S32, 0x8771f681);
    c = HH(c, d, a, b, x[k + 11], S33, 0x6d9d6122);
    b = HH(b, c, d, a, x[k + 14], S34, 0xfde5380c);
    a = HH(a, b, c, d, x[k + 1], S31, 0xa4beea44);
    d = HH(d, a, b, c, x[k + 4], S32, 0x4bdecfa9);
    c = HH(c, d, a, b, x[k + 7], S33, 0xf6bb4b60);
    b = HH(b, c, d, a, x[k + 10], S34, 0xbebfbc70);
    a = HH(a, b, c, d, x[k + 13], S31, 0x289b7ec6);
    d = HH(d, a, b, c, x[k + 0], S32, 0xeaa127fa);
    c = HH(c, d, a, b, x[k + 3], S33, 0xd4ef3085);
    b = HH(b, c, d, a, x[k + 6], S34, 0x04881d05);
    a = HH(a, b, c, d, x[k + 9], S31, 0xd9d4d039);
    d = HH(d, a, b, c, x[k + 12], S32, 0xe6db99e5);
    c = HH(c, d, a, b, x[k + 15], S33, 0x1fa27cf8);
    b = HH(b, c, d, a, x[k + 2], S34, 0xc4ac5665);
    a = II(a, b, c, d, x[k + 0], S41, 0xf4292244);
    d = II(d, a, b, c, x[k + 7], S42, 0x432aff97);
    c = II(c, d, a, b, x[k + 14], S43, 0xab9423a7);
    b = II(b, c, d, a, x[k + 5], S44, 0xfc93a039);
    a = II(a, b, c, d, x[k + 12], S41, 0x655b59c3);
    d = II(d, a, b, c, x[k + 3], S42, 0x8f0ccc92);
    c = II(c, d, a, b, x[k + 10], S43, 0xffeff47d);
    b = II(b, c, d, a, x[k + 1], S44, 0x85845dd1);
    a = II(a, b, c, d, x[k + 8], S41, 0x6fa87e4f);
    d = II(d, a, b, c, x[k + 15], S42, 0xfe2ce6e0);
    c = II(c, d, a, b, x[k + 6], S43, 0xa3014314);
    b = II(b, c, d, a, x[k + 13], S44, 0x4e0811a1);
    a = II(a, b, c, d, x[k + 4], S41, 0xf7537e82);
    d = II(d, a, b, c, x[k + 11], S42, 0xbd3af235);
    c = II(c, d, a, b, x[k + 2], S43, 0x2ad7d2bb);
    b = II(b, c, d, a, x[k + 9], S44, 0xeb86d391);
    a = addUnsigned(a, AA); b = addUnsigned(b, BB); c = addUnsigned(c, CC); d = addUnsigned(d, DD);
  }
  return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

function respond(text, status = 200) {
  return new Response(text, { status, headers: { "content-type": "text/plain" } });
}

function fail(message, status = 400) {
  console.error("adswedmedia-postback:", message);
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

async function readParams(request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  if (Object.keys(params).length > 0) {
    return params;
  }

  if (request.method === "POST") {
    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await request.json();
      }
      if (contentType.includes("form")) {
        const formData = await request.formData();
        return Object.fromEntries(formData.entries());
      }
    } catch {
      // no/unparseable body — fine, fall through with empty params
    }
  }

  return params;
}

async function handlePostback(request, env) {
  const params = await readParams(request);

  // --- TEMP DEBUG: the dashboard's live postback preview shows different
  // param names (user_id/transid/userip/type) than the written docs
  // (subId/transId/userIp, no `type`, signature not shown at all). Log
  // everything raw on the first real test so we can confirm the exact
  // field names and whether/how `signature` actually arrives. Remove once
  // confirmed. ---
  console.log("adswedmedia-postback: DEBUG raw params", params);
  // --- END TEMP DEBUG ---

  // Accept both the documented names and the names shown in the live
  // dashboard preview, until confirmed which one AdswedMedia actually
  // sends in production.
  const subId = String(params.subId || params.user_id || "");
  const transId = String(params.transId || params.transid || "");
  const rewardRaw = params.reward;
  const reward = parseFloat(rewardRaw);
  const payout = parseFloat(params.payout) || 0;
  const signature = String(params.signature || params.sign || params.hash || "");
  let status = String(params.status || "");
  const type = String(params.type || "").toLowerCase();
  if (!status && type) {
    // Fallback if AdswedMedia sends `type=reversal`/`type=conversion`
    // instead of a numeric `status` in some flows.
    status = type === "reversal" || type === "chargeback" ? "2" : "1";
  }
  const offerId = String(params.offer_id || "");
  const offerName = String(params.offer_name || "");

  const secret = env.ADSWEDMEDIA_SECRET_KEY || "";
  if (!secret) {
    return fail("Server not configured (missing ADSWEDMEDIA_SECRET_KEY).", 500);
  }

  if (!subId || !transId || !Number.isFinite(reward) || !signature) {
    return fail("Missing or invalid parameters.", 400);
  }

  // 1. Verify MD5 signature: MD5(subId + transId + reward + secret).
  //    AdswedMedia's own PHP example concatenates the raw `reward` param
  //    exactly as received (a string), so we sign against rewardRaw, not
  //    the parsed float, to avoid formatting mismatches (e.g. "5.0" vs "5").
  const expectedSignature = md5(String(subId) + String(transId) + String(rewardRaw) + secret);
  if (!signature || expectedSignature !== signature.toLowerCase()) {
    // --- TEMP DEBUG: log what we expected vs what (if anything) arrived,
    // so a mismatch can be diagnosed instead of just failing blind. Remove
    // once the real signature param name/formula is confirmed live. ---
    console.log("adswedmedia-postback: DEBUG signature mismatch", {
      received: signature || "(none)",
      expected: expectedSignature,
      signedString: `${subId}${transId}${rewardRaw}<secret>`,
    });
    // --- END TEMP DEBUG ---
    return fail("Invalid signature.", 403);
  }

  const coins = Math.round(Math.abs(reward));

  // 2. Duplicate check — real transId this time, no synthetic key needed.
  const dup = await env.DB.prepare(
    `SELECT id FROM offer_completions WHERE provider = 'adswedmedia' AND transaction_id = ?`
  ).bind(transId).first();

  if (dup) {
    return respond("DUP");
  }

  // 3. status: "1" = credit, "2" = subtract (reversal). Anything else is
  //    unexpected — log it but don't guess; treat as credit only on "1".
  if (status === "2") {
    // Reversal — subtract, never going below 0, and still record the row
    // so a duplicate reversal doesn't double-subtract.
    await env.DB.prepare(
      `UPDATE users
       SET coins = MAX(coins - ?, 0),
           completed_offers = MAX(completed_offers - 1, 0),
           total_earning = MAX(total_earning - ?, 0)
       WHERE id = ?`
    ).bind(coins, coins, subId).run();

    await env.DB.prepare(
      `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
       VALUES ('adswedmedia', ?, ?, ?, ?, ?, 'reversed', datetime('now'))`
    ).bind(subId, offerId, transId, payout, coins).run();

    return respond("OK");
  }

  if (status !== "1") {
    console.error("adswedmedia-postback: unexpected status value", { status, subId, transId, offerId, offerName });
    return fail("Unexpected status value.", 400);
  }

  const update = await env.DB.prepare(
    `UPDATE users
     SET coins = coins + ?,
         completed_offers = completed_offers + 1,
         total_earning = total_earning + ?
     WHERE id = ?`
  ).bind(coins, coins, subId).run();

  if (!update.success || update.meta.changes === 0) {
    return fail("User not found.", 404);
  }

  await env.DB.prepare(
    `INSERT INTO offer_completions (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
     VALUES ('adswedmedia', ?, ?, ?, ?, ?, 'credited', datetime('now'))`
  ).bind(subId, offerId, transId, payout, coins).run();

  return respond("OK");
}

export async function onRequestGet(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}

export async function onRequestPost(context) {
  try { return await handlePostback(context.request, context.env); }
  catch (err) { return fail(err.message || "Server error", 500); }
}
