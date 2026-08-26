# Revtoo অফারওয়াল — earn.html-এ ইন্টিগ্রেশন (বাকি কাজ)

> **স্ট্যাটাস:** ব্যাকএন্ড ফাইল দুটো (`revtoo-feed.js`, `revtoo-postback.js`)
> Revtoo-এর অফিসিয়াল ডকুমেন্টেশন (docs.revtoo.com) দেখে বানানো হয়েছে —
> সিগনেচার অ্যালগরিদম আর postback কন্ট্র্যাক্ট Offery-এর সাথে হুবহু মিলে
> যায় (দুটোই একই আন্ডারলাইং হোয়াইটলেবেল প্ল্যাটফর্ম), তাই দুশ্চিন্তার
> কিছু নেই সেই অংশে। কিন্তু **Offers API রেসপন্সের গঠন CPAGrip/Offery
> থেকে আলাদা** — নিচে "যা মেলেনি" সেকশনে বিস্তারিত।

CPAGrip আর Offery-এর ঠিক একই প্যাটার্নে **চতুর্থ প্রোভাইডার** হিসেবে
Revtoo (revtoo.com) যোগ করা হচ্ছে।

---

## ধাপ ১ — নতুন ফাইলগুলো সঠিক জায়গায় বসান

```
functions/api/offers/revtoo-feed.js
functions/api/offers/revtoo-postback.js
```

## ধাপ ২ — D1 মাইগ্রেশন — লাগবে না ✅

Offery যোগ করার সময় `offer_completions` টেবিলে যে `transaction_id` আর
`status` কলাম দুটো যোগ করা হয়েছিল, Revtoo সেই একই কলাম ব্যবহার করবে
(শুধু `provider = 'revtoo'` দিয়ে আলাদা রো হিসেবে সেভ হবে)। নতুন কোনো
`ALTER TABLE` চালানোর দরকার নেই।

## ধাপ ৩ — `earn.html`-এ partner tile যোগ করুন

`partners-grid` div-এর ভেতরে Offery বাটনের ঠিক পরে এই বাটনটা বসান:

```html
<button class="partner-card" onclick="openOfferwall('Revtoo')">
  <div class="partner-tile" style="background:linear-gradient(160deg,#132a1e,#0d1a14);">
    <span class="partner-wordmark">REVTOO</span>
  </div>
  <span class="partner-name">Revtoo</span>
</button>
```

## ধাপ ৪ — `openOfferwall()` ডিসপ্যাচারে Revtoo স্পেশাল-কেস যোগ করুন

```js
function openOfferwall(partner){
  if(partner === 'CPAGrip'){
    openCpagripOfferwall();
    return;
  }
  if(partner === 'Offery'){
    openOfferyOfferwall();
    return;
  }
  if(partner === 'Revtoo'){
    openRevtooOfferwall();
    return;
  }
  ...
```

## ধাপ ৫ — Offery-এর ফাংশনগুলোর ঠিক পরে এই নতুন ফাংশনগুলো বসান

⚠️ **এখানে Offery থেকে পার্থক্য আছে** — Revtoo-এর রেসপন্স ফরম্যাট
আলাদা (নিচে দেখুন), তাই `normalizeOfferyOffer`-এর মতো সরাসরি কপি করা
যাবে না:

```js
// ---------- Revtoo — real offer feed via our own backend ----------
function normalizeRevtooOffer(o){
  if(!o || typeof o !== 'object') return null;
  const id     = o.id ?? '';
  const title  = o.title ?? 'Offer';
  const desc   = o.description ?? '';
  const image  = o.image ?? '';
  const link   = o.url ?? '#';
  // Revtoo already sends the coin amount pre-converted using the Currency
  // Name/Exchange Rate set on the placement (Points / 1000.00) — keep those
  // in sync with functions/api/offers/revtoo-postback.js.
  // Some offers (mostly surveys) have a VARIABLE reward — Revtoo sends the
  // literal string "*" instead of a number for those, so coins stays null
  // and the card shows "Varies" instead of a fake 0.
  const coins  = (o.reward === '*' || o.reward == null) ? null : Math.round(parseFloat(o.reward)) || 0;
  if(!id || !link || link === '#') return null;
  return { id, title, desc, image, link, coins };
}

function revtooCardHTML(o, idx){
  const iconInner = o.image
    ? `<img src="${o.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:13px;" onerror="this.onerror=null;this.style.display='none';this.parentElement.textContent='🎯';">`
    : '🎯';
  const rewardHTML = o.coins === null
    ? `<div class="ow-reward">Varies</div>`
    : `<div class="ow-reward"><svg class="icon"><use href="#icon-coin"/></svg>${o.coins}</div>`;
  return `
    <div class="ow-card" onclick="openOfferDetail(currentOfferList[${idx}])">
      <div class="ow-icon" style="background:#161a1f;overflow:hidden;">${iconInner}</div>
      <div class="ow-info">
        <div class="ow-title">${o.title}</div>
        <div class="ow-desc">${o.desc}</div>
      </div>
      ${rewardHTML}
    </div>`;
}

async function openRevtooOfferwall(){
  owBrandName.textContent = 'Revtoo';
  owGrid.innerHTML = '<div class="ow-empty">Loading offers…</div>';
  owOverlay.classList.add('show');
  document.body.style.overflow = 'hidden';

  try{
    const res = await fetch(`${API_BASE}/offers/revtoo-feed`);

    if(res.status === 401){
      owGrid.innerHTML = '<div class="ow-empty">অফার দেখতে আগে সাইন ইন করুন।</div>';
      return;
    }
    if(!res.ok) throw new Error('revtoo feed request failed: ' + res.status);

    const data = await res.json();
    console.log('Revtoo feed — raw response:', data.raw ?? data);

    const offers = (data.offers || []).map(normalizeRevtooOffer).filter(Boolean);
    currentOfferList = offers;
    owGrid.innerHTML = offers.length
      ? offers.map((o, idx) => revtooCardHTML(o, idx)).join('')
      : '<div class="ow-empty">No offers available at the moment</div>';
  }catch(err){
    console.error('Revtoo offerwall error:', err);
    owGrid.innerHTML = '<div class="ow-empty">অফার লোড করা যায়নি, একটু পর আবার চেষ্টা করুন।</div>';
  }
}
```

## ধাপ ৬ — Revtoo ড্যাশবোর্ডের প্লেসমেন্ট ফর্মে যা বসাতে হবে

স্ক্রিনশটে দেখা "Edit" ট্যাবের ফর্মে এখনো দুটো ফিল্ড অসম্পূর্ণ/ভুল —
এগুলো ঠিক করে **Update** চাপতে হবে:

1. **Placement URL** — এখন খালি। এখানে আপনার সাইটের URL বসান:
   ```
   https://earn-bangla.com
   ```
2. **Postback URL** — এখন শুধু `https://earn-bangla.com` বসানো আছে,
   যেটা আসলে কোনো এন্ডপয়েন্ট না। এটা মুছে এই পুরো URL-টা বসান
   (Revtoo-এর নিজস্ব `{macro}` সিনট্যাক্স অনুযায়ী, আর
   `revtoo-postback.js` যে ফিল্ডগুলো পড়ে তার সাথে মিলিয়ে):
   ```
   https://earn-bangla.com/api/offers/revtoo-postback?subId={subId}&transId={transId}&offer_id={offer_id}&offer_name={offer_name}&reward={reward}&payout={payout}&status={status}&signature={signature}
   ```
3. **Currency Name / Currency Round / Exchange Rate / Postback Method** —
   স্ক্রিনশটে যা আছে (Points, 0, 1000.00, GET) সেগুলো ঠিকই আছে,
   `revtoo-postback.js`-এর কমেন্টের সাথে মিলে যায়, কিছু বদলানোর দরকার
   নেই।

## ধাপ ৭ — Revtoo অনুমোদন হওয়ার পর (API Key + Secret Key পাওয়ার পর)

1. Revtoo-এর "Integration" ট্যাব থেকে **API Key** আর **Secret Key**
   কপি করুন (docs অনুযায়ী প্লেসমেন্ট approve হওয়ার ~24 ঘণ্টার মধ্যে
   পাওয়া যায়)।
2. `functions/api/offers/revtoo-feed.js`-এ `REVTOO_API_KEY`
   কনস্ট্যান্টে API Key বসান।
3. Secret Key দিয়ে wrangler secret সেট করুন (দুই জায়গাতেই):
   ```
   wrangler pages secret put REVTOO_SECRET_KEY --project-name=earnbangla
   wrangler pages secret put REVTOO_SECRET_KEY --project-name=earnbangla --env preview
   ```

## ধাপ ৮ — টেস্ট করুন

`OFFERWALL-TROUBLESHOOTING.md`-এর "লাইভ log tail" পদ্ধতিতে:

```
wrangler pages deployment tail --project-name=earnbangla
```

চালু রেখে Revtoo-এর প্লেসমেন্ট পেজের **Test** ট্যাব থেকে (স্ক্রিনশটের
পাশের ট্যাব) একটা sandbox postback পাঠিয়ে raw response **"ok"** আসছে
কিনা, আর duplicate `transId` দ্বিতীয়বার পাঠালে coins দ্বিতীয়বার না
বাড়ছে কিনা — দুটোই কনফার্ম করুন।

---

## যা এখনো লাগবে (আপনার কাছ থেকে)

- Revtoo প্লেসমেন্টের বর্তমান approval status — approve হয়ে গেছে, নাকি
  এখনো pending? (স্ক্রিনশটে শুধু Edit ফর্ম দেখা যাচ্ছে, approval
  status না)
- Approve হলে: **API Key** ও **Secret Key** (ধাপ ৭)
- Placement URL আর Postback URL ফিল্ড দুটো ধাপ ৬ অনুযায়ী ঠিক করে
  **Update** চাপা হয়েছে কিনা

## যা মেলেনি (Offery vs Revtoo — কেন `offery-feed.js` সরাসরি কপি করা যায়নি)

| | Offery | Revtoo |
|---|---|---|
| Offers array কোথায় থাকে | `data.data` (প্রতিটা row-এর ভেতর নেস্টেড `offer` অবজেক্ট) | `data.offers` (ফ্ল্যাট, সরাসরি) |
| Offer টাইটেল/বিবরণ | `row.offer.name` / `row.offer.description` | `o.title` / `o.description` |
| Reward | `row.payout.reward` | `o.reward` (সরাসরি, কিন্তু ভ্যারিয়েবল অফারে `"*"` স্ট্রিং হতে পারে) |
| USER_ID প্লেসহোল্ডার | URL-এ `USER_ID` টেক্সট বসিয়ে আমাদের নিজে replace করতে হতো | আমরা রিকোয়েস্টেই `user_id` পাঠাই, Revtoo নিজেই URL-এ বসিয়ে দেয় |

এই পার্থক্যগুলোর কারণেই `revtoo-feed.js` নতুন করে লেখা হয়েছে, `offery-feed.js`-এর সরাসরি কপি না করে।
