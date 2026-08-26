// functions/api/offers/admantum-feed.js
//
// Type A provider (JSON offer feed). Session cookie theke user lookup kore,
// tarpor Admantum-er Offers API theke offer list fetch kore normalize kore
// pathay. AppId/Secret ekhane hardcode kora, kintu secret kono client-facing
// response-e jay na — ei file "backend proxy" hisebe kaj kore.
//
// ⚠️ IMPORTANT: `getUserIdFromSession()` function-ta ekta PLACEHOLDER.
// Tomar existing session-lookup logic (jeta functions/api/auth/me.js-e
// ache) er sathe eta match kore niyo — table/column name ei repo onujayi
// vinno hote pare.

const ADMANTUM_APP_ID = '52189';

export async function onRequestGet({ request, env }) {
  try {
    const userId = await getUserIdFromSession(request, env);
    if (!userId) {
      return json({ success: false, error: 'Not authenticated' }, 401);
    }

    const ip = request.headers.get('CF-Connecting-IP') || '';
    const country = request.headers.get('CF-IPCountry') || '';

    const apiUrl =
      `https://admantum.com/api/offers/` +
      `?appid=${encodeURIComponent(ADMANTUM_APP_ID)}` +
      `&uid=${encodeURIComponent(userId)}` +
      (ip ? `&ip=${encodeURIComponent(ip)}` : '') +
      (country ? `&country=${encodeURIComponent(country)}` : '');

    const upstream = await fetch(apiUrl);
    const data = await upstream.json();

    if (!upstream.ok || data.success !== true) {
      console.error('Admantum feed upstream error:', JSON.stringify(data).slice(0, 500));
      return json({ success: false, error: 'Upstream error' }, 502);
    }

    const offers = (data.offers || []).map(normalizeAdmantumOffer);

    return json({
      success: true,
      currency: data.app_currency || 'Coins',
      count: offers.length,
      offers,
    });
  } catch (err) {
    console.error('Admantum feed exception:', err.message);
    return json({ success: false, error: 'Server error' }, 500);
  }
}

function normalizeAdmantumOffer(o) {
  return {
    id: o.offer_id,
    provider: 'admantum',
    title: o.offer_title,
    description: o.offer_description,
    requirements: o.offer_requirements,
    instructions: o.offer_instructions || [],
    image: o.offer_image,
    link: o.offer_link,
    reward: o.offer_virtual_currency,
    payout: o.offer_payout,
    type: o.offer_type,
    difficulty: o.offer_difficulty,
    devices: o.offer_devices || [],
    countries: o.offer_countries || [],
    events: (o.offer_events || []).map(e => ({
      name: e.event_name,
      reward: e.event_virtual_currency,
    })),
  };
}

// --- PLACEHOLDER: replace with your real session -> user_id lookup ---
async function getUserIdFromSession(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const token = match[1];

  const row = await env.DB.prepare(
    `SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')`
  ).bind(token).first();

  return row ? row.user_id : null;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
