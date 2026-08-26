// functions/api/offers/admantum-postback.js
//
// Admantum documentation (admantum.com/documentation) onujayi:
//   - Method: POST (only)
//   - Mandatory params: uid, virtual_currency (payout thakle virtual_currency
//     lagbe na bole documentation e bola ache, tobe amra virtual_currency
//     always pathate bolbo Admantum support-ke, na hoy fallback rakhlam)
//   - hash = MD5(uid + of_id + virtual_currency + SECRET_KEY)  -- NO separator
//   - status: "1" = completion (credit), "0" = reversal (chargeback)
//   - Expected response string: "OK"  (exact — lowercase na)
//
// ⚠️ Cloudflare Workers-er Web Crypto API-te MD5 নেই (শুধু SHA family), তাই
// নিচে একটা pure-JS MD5 implementation দেওয়া হলো (RFC1321 standard
// algorithm, কোনো proprietary/copyrighted লাইব্রেরি থেকে কপি করা না)।
//
// Setup korte hobe:
//   wrangler pages secret put ADMANTUM_SECRET_KEY --project-name=earnbangla
//   (production + --env preview duitao)
//   value: adm9267g3233e523   (screenshot theke — চাইলে dashboard theke
//   ghure abar confirm kore niyo, eta sensitive)

export async function onRequestPost({ request, env }) {
  return handlePostback(request, env);
}

// Admantum bole POST-only, kintu Postback Tester majhe majhe GET-o pathate
// pare — safety-r jonno GET support-o rakha holo.
export async function onRequestGet({ request, env }) {
  return handlePostback(request, env);
}

async function handlePostback(request, env) {
  try {
    const params = await readParams(request);

    const uid = params.uid || params.user_id;
    const transactionId = params.transaction_id;
    const status = String(params.status);
    const offerId = params.of_id || params.offer_id || '';
    const rawAmount = params.virtual_currency ?? params.payout ?? params.amount;
    const amount = parseInt(rawAmount, 10);
    const hash = params.hash;

    if (!uid || !hash || Number.isNaN(amount) || !transactionId) {
      console.log('admantum_postback_missing_params', JSON.stringify(params));
      return new Response('Missing required parameters', { status: 400 });
    }

    const secret = env.ADMANTUM_SECRET_KEY;
    if (!secret) {
      console.error('ADMANTUM_SECRET_KEY not configured');
      return new Response('Server misconfigured', { status: 500 });
    }

    // hash = MD5(uid + of_id + virtual_currency + Secret Key), no separators
    const stringToHash = `${uid}${offerId}${amount}${secret}`;
    const expectedHash = md5Hex(stringToHash);

    if (expectedHash.toLowerCase() !== String(hash).toLowerCase()) {
      console.log('admantum_postback_bad_signature', uid, transactionId);
      return new Response('Invalid signature', { status: 403 });
    }

    // Duplicate check — provider + transaction_id
    const existing = await env.DB.prepare(
      `SELECT id FROM offer_completions WHERE provider = 'admantum' AND transaction_id = ?`
    ).bind(transactionId).first();

    if (existing) {
      return new Response('OK', { status: 200 });
    }

    const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(uid).first();
    if (!user) {
      console.log('admantum_postback_user_not_found', uid);
      return new Response('User not found.', { status: 404 });
    }

    if (status === '1') {
      // Completion → credit
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE users SET coins = coins + ?, completed_offers = completed_offers + 1, total_earning = total_earning + ? WHERE id = ?`
        ).bind(amount, amount, uid),
        env.DB.prepare(
          `INSERT INTO offer_completions (user_id, provider, offer_id, transaction_id, coins_earned, status) VALUES (?, 'admantum', ?, ?, ?, 'credited')`
        ).bind(uid, offerId, transactionId, amount),
      ]);
    } else if (status === '0') {
      // Reversal / chargeback → decrement, never below 0
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE users SET coins = MAX(coins - ?, 0), completed_offers = MAX(completed_offers - 1, 0), total_earning = MAX(total_earning - ?, 0) WHERE id = ?`
        ).bind(amount, amount, uid),
        env.DB.prepare(
          `INSERT INTO offer_completions (user_id, provider, offer_id, transaction_id, coins_earned, status) VALUES (?, 'admantum', ?, ?, ?, 'reversed')`
        ).bind(uid, offerId, transactionId, -amount),
      ]);
    } else {
      console.log('admantum_postback_unknown_status', status);
      return new Response('Unknown status', { status: 400 });
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('admantum_postback_exception', err.message);
    return new Response('Server Error', { status: 500 });
  }
}

async function readParams(request) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    return Object.fromEntries(url.searchParams.entries());
  }
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return await request.json();
  }
  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

// ---------------------------------------------------------------------
// Pure-JS MD5 (RFC1321). Cloudflare Workers' Web Crypto has no MD5.
// ---------------------------------------------------------------------
function md5Hex(str) {
  function rotl(x, c) { return (x << c) | (x >>> (32 - c)); }
  function toBytesUtf8(s) {
    return new TextEncoder().encode(s);
  }

  const K = new Uint32Array([
    0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,
    0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,
    0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,
    0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,
    0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,
    0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,
    0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,
    0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391,
  ]);
  const S = [
    7,12,17,22, 7,12,17,22, 7,12,17,22, 7,12,17,22,
    5, 9,14,20, 5, 9,14,20, 5, 9,14,20, 5, 9,14,20,
    4,11,16,23, 4,11,16,23, 4,11,16,23, 4,11,16,23,
    6,10,15,21, 6,10,15,21, 6,10,15,21, 6,10,15,21,
  ];

  const msg = toBytesUtf8(str);
  const origLenBits = BigInt(msg.length) * 8n;

  let padded = Array.from(msg);
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  for (let i = 0; i < 8; i++) {
    padded.push(Number((origLenBits >> BigInt(8 * i)) & 0xffn));
  }

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let chunkStart = 0; chunkStart < padded.length; chunkStart += 64) {
    const M = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      const o = chunkStart + i * 4;
      M[i] = padded[o] | (padded[o+1] << 8) | (padded[o+2] << 16) | (padded[o+3] << 24);
    }

    let A = a0, B = b0, C = c0, D = d0;

    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }

      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const toHexLE = (n) => {
    let hex = '';
    for (let i = 0; i < 4; i++) {
      hex += ((n >>> (8 * i)) & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
  };

  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}
