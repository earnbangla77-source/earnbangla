// functions/api/activity.js
// GET /api/activity — আজকের (বাংলাদেশ সময় UTC+6) সব credited offer completion, হোম-পেজ টিকারের জন্য।
// is_private ফিল্টার নেই — সবার রো আসবে।
// LEFT JOIN: users টেবিলে ইউজার না মিললেও রো বাদ যাবে না (নাম না থাকলে offer_completions-এর user_id-ই নাম হিসেবে দেখাবে)।
// কোয়েরি fail করলে JSON-এর "error" ফিল্ডে কারণ দেখাবে (debug)।

const LIMIT = 0;
const TZ = "+6 hours"; // Bangladesh Standard Time

export async function onRequestGet(context) {
  const { env } = context;
  try {
    const { results } = await env.DB.prepare(
      `SELECT u.username AS username,
              oc.user_id AS user_id,
              oc.provider AS provider,
              oc.coins_earned AS coins,
              strftime('%m/%d/%Y', oc.created_at, '${TZ}') AS day
         FROM offer_completions oc
         LEFT JOIN users u ON u.id = oc.user_id
        WHERE oc.status = 'credited'
          AND oc.coins_earned > 0
          AND date(oc.created_at, '${TZ}') = date('now', '${TZ}')
        ORDER BY oc.id DESC
        LIMIT ?`
    ).bind(LIMIT).all();

    const activity = (results || []).map((r) => ({
      username: r.username || String(r.user_id || "User"), // username না মিললে offer_completions-এর user_id দেখাবে
      provider: r.provider,
      coinsEarned: Math.round(r.coins),
      date: r.day, // MM/DD/YYYY
    }));

    return new Response(JSON.stringify({ activity }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.log("activity error", e && e.message);
    return new Response(
      JSON.stringify({ activity: [], error: String((e && e.message) || e) }),
      { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  }
}
