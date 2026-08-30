/**
 * functions/api/offers/vortexwall-postback.js
 *
 * ⚠️ DEBUG-ONLY STAGE — DOES NOT TOUCH THE DATABASE YET.
 *
 * VortexWall's Placement modal (publisher.vortexwall.com/placement) gives
 * us the exact Callback URL Example macros:
 *
 *   ?identity_id={IDENTITY_ID}&campaign_id={CAMPAIGN_ID}
 *   &campaign_name={CAMPAIGN_NAME}&event_id={EVENT_ID}
 *   &event_name={EVENT_NAME}&payout={PAYOUT}&points={POINTS}
 *   &txid={TXID}&result={RESULT}&ipaddr={IPADDR}
 *   &sub1={SUB1}&sub2={SUB2}&hash={HASH}
 *
 * BUT two things are NOT confirmed anywhere in the dashboard screenshots
 * or in VortexWall's public docs (couldn't find a public postback doc
 * page for vortexwall.com):
 *
 *   1. The {hash} FORMULA — which fields, what order, what algorithm
 *      (MD5 like Offery/Revtoo/Admantum, or SHA-256 like some newer
 *      networks), and what the secret key even is / where it's shown.
 *   2. The {result} VALUES for a normal conversion vs. a chargeback/
 *      reversal (e.g. "approved"/"rejected", "1"/"0", something else).
 *
 * Per OFFERWALL-MASTER-GUIDE.md §৭ ("নতুন প্রোভাইডারের ... গেস করে লেখা →
 * সবসময় 500/ভুল সিগনেচার"), guessing either of these will just produce a
 * postback that always fails signature checks silently. So this file
 * intentionally does NOT verify a hash or credit any coins yet — it only
 * logs the raw request so we can see a REAL example.
 *
 * How to use this stage:
 *   1. Deploy this file.
 *   2. Paste this endpoint's URL as the Callback URL in the VortexWall
 *      placement modal and hit "Update Placement".
 *   3. Run: wrangler pages deployment tail --project-name=earnbangla
 *   4. Go to the "Test CallBack" tab in the same VortexWall modal and
 *      fire a test callback.
 *   5. Copy the full logged line (all params + the real {hash} value)
 *      back here — that's enough to pin down the hash formula (once we
 *      also have the secret key from VortexWall's dashboard) and finish
 *      the real, DB-touching postback.js.
 */

export async function onRequestGet(context) {
  return logAndAck(context.request);
}

export async function onRequestPost(context) {
  return logAndAck(context.request);
}

async function logAndAck(request) {
  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());

  let bodyText = "";
  try {
    // Don't assume GET-only — log body too in case VortexWall POSTs.
    bodyText = await request.clone().text();
  } catch {
    // ignore
  }

  // Log as a plain string, not as an object with a `hash`/`signature` key —
  // Cloudflare's log tail auto-redacts values under sensitive-looking keys
  // (see OFFERWALL-MASTER-GUIDE.md §৮).
  console.log(
    "VORTEXWALL_DEBUG_CALLBACK " +
      "method=" + request.method + " " +
      "query=" + JSON.stringify(params) + " " +
      "body=" + JSON.stringify(bodyText)
  );

  return new Response("ok", { status: 200 });
}
