// functions/api/offers/primewall-postback.js
//
// Prime Wall postback receiver.
//
// Confirmed live param format (from the Postback Tester "Info" popup on
// 2026-08-25):
//   ?subId=<user id>&reward=<coins>&payout=<usd>&transId=<unique id>
//    &signature=<hash>&status=<1|other>&type=<optional>&company_id=<id>
//    &uuid=<offer/campaign id>&userIp=<ip>&country=<code>
//
// This replaces the earlier DEBUG version (which only console.log'd the
// request) now that the real param names are known. Structured the same
// way as offery-postback.js: duplicate-guard on transaction_id, then
// increment users.coins / completed_offers / total_earning together,
// insert a row into offer_completions, and handle chargebacks by
// decrementing (never below 0).
//
// ⚠️ SIGNATURE VERIFICATION: Prime Wall's exact signature algorithm
// (which fields + secret key are hashed, and with what algorithm) is not
// yet confirmed — the dashboard's "Read our detailed documentation" page
// hasn't been read yet. PRIMEWALL_SECRET_KEY is accepted as a Cloudflare
// secret and logged, but NOT enforced yet, so real postbacks aren't
// rejected on a guess. Once the doc is read, fill in verifySignature()
// below and flip REQUIRE_SIGNATURE to true.

const REQUIRE_SIGNATURE = false;

function verifySignature(params, secret) {
  // TODO: implement once Prime Wall's documented signature formula is
  // confirmed. Common pattern is something like:
  //   md5(`${params.subId}${params.transId}${params.payout}${secret}`)
  // Do not enable REQUIRE_SIGNATURE until this is verified against a real
  // test postback, or legitimate conversions could get rejected.
  return true;
}

export async function onRequest(context) {
  const { request, env } = context;

  let params;
  if (request.method === 'GET') {
    params = Object.fromEntries(new URL(request.url).searchParams.entries());
  } else {
    try {
      const body = await request.json().catch(() => null);
      params = body || Object.fromEntries(new URL(request.url).searchParams.entries());
    } catch {
      params = Object.fromEntries(new URL(request.url).searchParams.entries());
    }
  }

  console.log('===== Prime Wall postback =====');
  console.log('method:', request.method);
  console.log('params:', JSON.stringify(params));
  console.log('================================');

  const userId      = params.subId ?? null;
  const transId      = params.transId ?? null;
  const rewardCoins  = Math.round(parseFloat(params.reward ?? 0)) || 0;
  const payoutUsd    = parseFloat(params.payout ?? 0) || 0;
  const statusRaw    = params.status ?? '1';
  const type         = (params.type ?? '').toLowerCase();

  if (!userId || !transId) {
    return new Response('missing subId or transId', { status: 400 });
  }

  if (REQUIRE_SIGNATURE) {
    const secret = env.PRIMEWALL_SECRET_KEY;
    if (!secret || !verifySignature(params, secret)) {
      return new Response('invalid signature', { status: 403 });
    }
  }

  // Prime Wall's "reward" is meant to already be the coin amount, using the
  // Currency Conversion rate set on the Placement (same idea as Offery's
  // payout.reward). If that rate is still 0.0000 on the placement, reward
  // will come through as 0 — set the rate on the Prime Wall dashboard
  // (Edit Placement → Currency Conversion) before relying on this value.
  const coins = rewardCoins;

  // type=reversal / status values outside "1" are treated as a chargeback
  // until the real documented values are confirmed — adjust here once
  // Prime Wall's docs are read.
  const isChargeback = type === 'reversal' || type === 'chargeback' || statusRaw === '0';

  const db = env.DB;

  try {
    const existing = await db
      .prepare('SELECT id, status, coins_earned FROM offer_completions WHERE provider = ? AND transaction_id = ?')
      .bind('primewall', transId)
      .first();

    if (isChargeback) {
      if (!existing || existing.status === 'chargeback') {
        return new Response('ok');
      }
      const refund = existing.coins_earned || 0;
      await db.batch([
        db.prepare(
          `UPDATE users
           SET coins = MAX(0, coins - ?),
               completed_offers = MAX(0, completed_offers - 1),
               total_earning = MAX(0, total_earning - ?)
           WHERE id = ?`
        ).bind(refund, refund, userId),
        db.prepare('UPDATE offer_completions SET status = ? WHERE id = ?').bind('chargeback', existing.id),
      ]);
      return new Response('ok');
    }

    if (existing) {
      // duplicate — already credited (or already recorded), ignore
      return new Response('ok');
    }

    await db.batch([
      db.prepare(
        `UPDATE users
         SET coins = coins + ?,
             completed_offers = completed_offers + 1,
             total_earning = total_earning + ?
         WHERE id = ?`
      ).bind(coins, coins, userId),
      db.prepare(
        `INSERT INTO offer_completions
           (provider, user_id, offer_id, transaction_id, payout, coins_earned, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind('primewall', userId, params.uuid ?? '', transId, payoutUsd, coins, 'credited'),
    ]);

    return new Response('ok');
  } catch (err) {
    console.error('Prime Wall postback error:', err);
    return new Response('ok'); // Prime Wall should still see 200/"ok" so it doesn't keep retrying into a broken loop
  }
}
