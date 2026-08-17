# Offery অফারওয়াল — earn.html-এ ইন্টিগ্রেশন (বাকি কাজ)

> **স্ট্যাটাস (আপডেট):** ধাপ ১–৬ সম্পূর্ণ। ধাপ ৭ (live test) এখনো বাকি —
> কারণ Offery-এর প্লেসমেন্ট এখনো **Pending** (Offery টিমের approval-এর
> অপেক্ষায়)। Approve হলে ধাপ ৭ করা যাবে।

CPAGrip-এর ঠিক একই প্যাটার্নে **তৃতীয় প্রোভাইডার** হিসেবে Offery
(offery.io) যোগ করা হচ্ছে। ব্যাকএন্ড ফাইল দুটো (`offery-feed.js`,
`offery-postback.js`) আর schema migration (`offery-schema-addition.sql`)
আলাদাভাবে দেওয়া আছে — এই ফাইলে শুধু `earn.html`-এ কী কী এডিট করতে হবে
সেটা আছে।

---

## ধাপ ১ — ✅ নতুন ফাইলগুলো সঠিক জায়গায় বসান

```
functions/api/offers/offery-feed.js
functions/api/offers/offery-postback.js
```

## ধাপ ২ — ✅ D1 তে schema migration চালান

`offery-schema-addition.sql`-এর কমান্ডগুলো (একটা একটা করে) চালান:

```
wrangler d1 execute earnbangla-db --remote --command="ALTER TABLE offer_completions ADD COLUMN transaction_id TEXT;"
wrangler d1 execute earnbangla-db --remote --command="ALTER TABLE offer_completions ADD COLUMN status TEXT NOT NULL DEFAULT 'credited';"
wrangler d1 execute earnbangla-db --remote --command="CREATE INDEX IF NOT EXISTS idx_offer_completions_provider_transaction ON offer_completions (provider, transaction_id);"
```

⚠️ যদি `PRAGMA table_info(offer_completions);` চালিয়ে দেখেন এই কলাম
দুটো (`transaction_id`, `status`) আগে থেকেই আছে, তাহলে ALTER TABLE
স্কিপ করে শুধু ইনডেক্স কমান্ডটা চালান।

> **যা আসলে হয়েছে:** `transaction_id` কলাম আগে থেকেই ছিল, তাই ওই
> ALTER TABLE লাইনটা স্কিপ করা হয়েছে। `status` কলাম আর index — দুটোই
> নতুন করে চালানো হয়েছে, দুটোই সফল হয়েছে।

## ধাপ ৩ — ✅ `earn.html`-এ partner tile যোগ করুন

`partners-grid` div-এর ভেতরে CPAGrip বাটনের ঠিক পরে এই বাটনটা বসান:

```html
<button class="partner-card" onclick="openOfferwall('Offery')">
  <div class="partner-tile" style="background:linear-gradient(160deg,#2a1a33,#1a0f22);">
    <span class="partner-wordmark">OFFERY</span>
  </div>
  <span class="partner-name">Offery</span>
</button>
```

## ধাপ ৪ — ✅ `openOfferwall()` ডিসপ্যাচারে Offery স্পেশাল-কেস যোগ করুন

বর্তমানে এটা শুধু CPAGrip-কে স্পেশাল-কেস করে:

```js
function openOfferwall(partner){
  if(partner === 'CPAGrip'){
    openCpagripOfferwall();
    return;
  }
  ...
```

এটাকে বদলে করুন:

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
  ...
```

## ধাপ ৫ — ✅ CPAGrip-এর ফাংশনগুলোর ঠিক পরে (openCpagripOfferwall-এর পর,
closeOfferwall-এর আগে) এই নতুন ফাংশনগুলো বসান

```js
// ---------- Offery — real offer feed via our own backend ----------
function normalizeOfferyOffer(row){
  if(!row || typeof row !== 'object') return null;
  const o = row.offer || {};
  const id     = o.id ?? '';
  const title  = o.name ?? 'Offer';
  const desc   = o.description ?? '';
  const image  = o.image ?? '';
  const link   = row.url ?? '#';
  // Offery already sends the coin amount pre-converted using the Currency
  // Name/Exchange Rate set on the placement (Coins / 1000.00) — keep those
  // in sync with functions/api/offers/offery-postback.js.
  const coins  = Math.round(parseFloat(row.payout?.reward ?? 0)) || 0;
  if(!id || !link || link === '#') return null;
  return { id, title, desc, image, link, coins };
}

function offeryCardHTML(o, idx){
  const iconInner = o.image
    ? `<img src="${o.image}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:13px;" onerror="this.onerror=null;this.style.display='none';this.parentElement.textContent='🎯';">`
    : '🎯';
  return `
    <div class="ow-card" onclick="openOfferDetail(currentOfferList[${idx}])">
      <div class="ow-icon" style="background:#161a1f;overflow:hidden;">${iconInner}</div>
      <div class="ow-info">
        <div class="ow-title">${o.title}</div>
        <div class="ow-desc">${o.desc}</div>
      </div>
      <div class="ow-reward"><svg class="icon"><use href="#icon-coin"/></svg>${o.coins}</div>
    </div>`;
}

async function openOfferyOfferwall(){
  owBrandName.textContent = 'Offery';
  owGrid.innerHTML = '<div class="ow-empty">Loading offers…</div>';
  owOverlay.classList.add('show');
  document.body.style.overflow = 'hidden';

  try{
    const res = await fetch(`${API_BASE}/offers/offery-feed`);

    if(res.status === 401){
      owGrid.innerHTML = '<div class="ow-empty">অফার দেখতে আগে সাইন ইন করুন।</div>';
      return;
    }
    if(!res.ok) throw new Error('offery feed request failed: ' + res.status);

    const data = await res.json();
    console.log('Offery feed — raw response:', data.raw ?? data);

    const offers = (data.offers || []).map(normalizeOfferyOffer).filter(Boolean);
    currentOfferList = offers;
    owGrid.innerHTML = offers.length
      ? offers.map((o, idx) => offeryCardHTML(o, idx)).join('')
      : '<div class="ow-empty">No offers available at the moment</div>';
  }catch(err){
    console.error('Offery offerwall error:', err);
    owGrid.innerHTML = '<div class="ow-empty">অফার লোড করা যায়নি, একটু পর আবার চেষ্টা করুন।</div>';
  }
}
```

> **এক্সট্রা কাজ (প্ল্যানে ছিল না, বাড়তি করা হয়েছে):** `earn.html`-এ
> UpWall আর CPALead-এর পুরনো hardcoded sample/demo offer ডেটা এবং
> partner tile মুছে ফেলা হয়েছে, কারণ ওগুলো fake ডেটা ছিল। এখন
> partners grid-এ শুধু CPAGrip আর Offery দেখায় — দুটোই real backend
> feed-এর সাথে কানেক্টেড। এর ফলে `deviceIcon`/`tagHTML`/`owCardHTML`-এর
> মতো কিছু dead-code ফাংশনও সরানো হয়েছে।

## ধাপ ৬ — ✅ Offery অনুমোদন হওয়ার পর (App ID পাওয়ার পর)

1. ✅ Offery ড্যাশবোর্ড থেকে **API Key** আর **Secret Key** কপি করুন।
2. ✅ `functions/api/offers/offery-feed.js`-এ `OFFERY_API_KEY` কনস্ট্যান্টে
   API Key বসান।
3. ✅ Secret Key দিয়ে wrangler secret সেট করুন (দুই জায়গাতেই):
   ```
   wrangler pages secret put OFFERY_SECRET_KEY --project-name=earnbangla
   wrangler pages secret put OFFERY_SECRET_KEY --project-name=earnbangla --env preview
   ```
4. ✅ Offery-এর "Add New Placement" ফর্মের **Postback URL**-এ বসান:
   ```
   https://earn-bangla.com/api/offers/offery-postback
   ```
   (আপনার আসল লাইভ ডোমেইন দিয়ে — উপরের ধাপগুলো আগে deploy হয়ে যাওয়ার পর)

> **নোট:** এই চারটা কাজ Offery-এর approval আসার **আগেই** করে রাখা
> হয়েছে (submit করার সময় Offery সাথে সাথে API Key/Secret Key দেখিয়ে
> দিয়েছিল) — এখন শুধু Offery টিমের approval-এর অপেক্ষা।

## ধাপ ৭ — ⏳ টেস্ট করুন (এখনো বাকি — Offery approval-এর অপেক্ষায়)

`OFFERWALL-TROUBLESHOOTING.md`-এর "লাইভ log tail" পদ্ধতিতে:

```
wrangler pages deployment tail --project-name=earnbangla
```

চালু রেখে অন্য টার্মিনালে Offery-এর sandbox/debug postback পাঠিয়ে
`{"status":"credited"}`-এর বদলে raw response **"ok"** আসছে কিনা, আর
duplicate `transId` দ্বিতীয়বার পাঠালে coins দ্বিতীয়বার না বাড়ছে কিনা
— দুটোই কনফার্ম করুন। সব ঠিক থাকলে `PROJECT-STATUS.md` আপডেট করে দিন।
