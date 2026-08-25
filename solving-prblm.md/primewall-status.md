# Prime Wall অফারওয়াল — earn.html ইন্টিগ্রেশন (স্ট্যাটাস)

> **স্ট্যাটাস (আপডেট):** Frontend (`earn.html`) সম্পূর্ণ — টাইল, iframe মোডাল,
> সবকিছু রেডি। ব্যাকএন্ড postback ফাইল (`primewall-postback.js`) এখনো
> লেখা যায়নি — **ব্লকড**, কারণ Prime Wall পোস্টব্যাকে ঠিক কোন প্যারামিটার
> কোন নামে পাঠায় সেটা এখনো জানা নেই (নিচে "যা এখনো লাগবে" দেখুন)।

CPAGrip/Offery-এর থেকে Prime Wall আলাদা প্যাটার্নের — ওদের কোনো JSON
offer feed API নেই, শুধু একটা রেডিমেড iframe embed URL দেয়:

```
https://primewall.io/offer/Il7Eo8/[USER_ID]
```

তাই earn.html-এ নিজের কার্ড না বানিয়ে সরাসরি এই URL-টা একটা iframe-এ
বসানো হয়েছে (অনেকটা আগের UpWall-এর মতো)।

---

## ধাপ ১ — ✅ `earn.html`-এ Prime Wall টাইল ও iframe মোডাল যোগ করা হয়েছে

- Partners grid-এ CPAGrip/Offery-এর পাশে **"Prime Wall"** টাইল
- `openOfferwall()` ডিসপ্যাচারে `partner === 'Prime Wall'` কেস →
  `openPrimeWallOfferwall()`
- `#owBody`-এর ভেতরে `#owGrid`-এর পাশে নতুন `#owIframeWrap` / `#owIframe`
  — `setOfferwallMode('grid' | 'iframe')` দিয়ে দুটো মোডের মধ্যে টগল হয়,
  যাতে CPAGrip/Offery খুললে কার্ড-গ্রিড আর Prime Wall খুললে iframe দেখায়
- `closeOfferwall()`-এ `owIframe.src = 'about:blank'` — মোডাল বন্ধ করলে
  Prime Wall ব্যাকগ্রাউন্ডে চলতে থাকবে না
- `PRIMEWALL_PUBLIC_KEY = 'Il7Eo8'` — Prime Wall dashboard-এর Public Key,
  কোডে সরাসরি বসানো (এটা secret না, iframe URL-এর অংশ হিসেবে ক্লায়েন্ট-সাইডে
  যাওয়ারই কথা)

## ধাপ ২ — ✅ USER_ID কোথা থেকে আসছে — কনফার্ম করা হয়েছে

`auth.js`-এর `publicUser()` দেখে কনফার্ম হলো `/api/auth/me` যে `user`
অবজেক্ট পাঠায় তাতে **`user.id`** ফিল্ডই আছে (আগের turn-এ এটা একটা
অনুমান ছিল, এখন কনফার্মড)। `earn.html`-এর `checkSession()`-এ
`currentUserId = user.id ?? null;` — এটা ঠিকই আছে, কোনো পরিবর্তন লাগবে না।

## ধাপ ৩ — ✅ D1 schema — নতুন migration সম্ভবত লাগবে না

`schema.sql` আর Offery migration থেকে দেখা যাচ্ছে `offer_completions`
টেবিলে ইতিমধ্যে `provider`, `user_id`, `offer_id`, `transaction_id`,
`payout`, `coins_earned`, `status`, `created_at` — এই কলামগুলো আছে।
Prime Wall-এর postback যদি এই একই শেপের ডেটা পাঠায় (যেটা প্রায় সব
offerwall-ই পাঠায়), তাহলে **নতুন কোনো migration লাগার কথা না** — শুধু
`primewall-postback.js` এই টেবিলে `provider = 'primewall'` দিয়ে ইনসার্ট
করবে, ঠিক `offery-postback.js`-এর প্যাটার্নেই।

## ধাপ ৪ — ⏳ ব্যাকএন্ড postback ফাইল — এখনো ব্লকড, কিন্তু unblock করার প্ল্যান রেডি

`functions/api/offers/primewall-postback.js` লেখার প্যাটার্ন (auth.js
ইমপোর্ট, duplicate-guard, coins/completed_offers/total_earning আপডেট,
chargeback হ্যান্ডলিং) — এই সব `offery-postback.js` থেকে পুরোপুরি
বোঝা গেছে। কিন্তু Prime Wall পোস্টব্যাকে ঠিক কোন প্যারামিটার কোন নামে
পাঠায় (user id, transaction id, payout, status, signature) — এটা
dashboard-এর স্ক্রিনশট থেকে এখনো বোঝা যায়নি (Postback Tester ফর্মটা
Payout-এর পরে কেটে গেছে, আর "Read our detailed documentation" লিংকের
কনটেন্ট এখনো দেখা হয়নি)।

**✅ তাই একটা DEBUG postback ফাইল বানানো হয়েছে (এখনই deploy করা যায়)** —
`primewall-postback.js` (এই কমিটে দেওয়া) কোনো coins/DB টাচ করে না,
শুধু Prime Wall যা যা পাঠায় (method, query params, body — সবকিছু)
`console.log` করে আর `"ok"` রিটার্ন করে।

**এটা দিয়ে আসল ফরম্যাট বের করার ধাপ:**
1. এই `primewall-postback.js` deploy করুন (যেমন সবসময় করেন — git push)
2. Prime Wall dashboard → Placement → Edit Placement-এ **Postback**
   ফিল্ডে বসান: `https://earn-bangla.com/api/offers/primewall-postback`
   (এখন ওখানে `null` লেখা আছে — খালি)
3. একটা টার্মিনালে চালু রাখুন: `wrangler pages deployment tail --project-name=earnbangla`
4. Integration পেজের **Postback Tester**-এ User ID + Payout (আর নিচে
   স্ক্রল করলে আরও ফিল্ড থাকলে সেগুলোও) ভরে একটা টেস্ট postback পাঠান
5. Tail-এ যা প্রিন্ট হয় (===== দাগের মাঝের অংশ) — সেটা কপি করে পাঠান

এই একটা লগ পেলেই আসল ফরম্যাট নিশ্চিত হয়ে যাবে, আর তখন এই ফাইলটা বদলে
আসল coin-crediting logic-সহ ফাইনাল `primewall-postback.js` লিখে দেওয়া
যাবে — offery-postback.js-এর হুবহু একই স্ট্রাকচারে।

**⚠️ আরেকটা জিনিস খেয়াল করা গেছে:** Edit Placement পেজে **Currency
Conversion** ফিল্ড এখনো `0.0000` — এটাও সেট করা লাগবে (Offery-তে যেমন
Exchange Rate = 1000.00 সেট করা ছিল, "1000 coins = $1" রেট মেলাতে)।
পাশের ⓘ আইকনে ক্লিক করে এটা ঠিক কীভাবে কাজ করে (গুণ নাকি ভাগ) সেটা
দেখে নেওয়া ভালো, না হলে coins ভুল হিসাব হতে পারে।

## ধাপ ৫ — Secret key সেটআপ (ফরম্যাট জানার পর)

```
wrangler pages secret put PRIMEWALL_SECRET_KEY --project-name=earnbangla
wrangler pages secret put PRIMEWALL_SECRET_KEY --project-name=earnbangla --env preview
```

(Prime Wall dashboard-এর Secret Key বসিয়ে — ধাপ ৪ শেষ হলে এই ভ্যালুটা
লাগবে সিগনেচার ভেরিফাই করতে, যদি Prime Wall সিগনেচার ভেরিফিকেশন ব্যবহার
করে থাকে।)

## ধাপ ৬ — Prime Wall dashboard-এ Postback URL বসানো

Prime Wall-এর "Add New Placement" বা Integration ফর্মের Postback URL
ফিল্ডে:

```
https://earn-bangla.com/api/offers/primewall-postback
```

## ধাপ ৭ — টেস্ট করুন

`OFFERWALL-TROUBLESHOOTING.md`-এর "লাইভ log tail" পদ্ধতিতে
(`wrangler pages deployment tail --project-name=earnbangla` চালিয়ে
রেখে) Prime Wall-এর Postback Tester দিয়ে একটা টেস্ট পোস্টব্যাক পাঠিয়ে
কনফার্ম করুন — coins/completed_offers/total_earning ঠিকমতো বাড়ছে
কিনা, আর duplicate transaction দ্বিতীয়বার পাঠালে দ্বিতীয়বার না বাড়ছে
কিনা।
