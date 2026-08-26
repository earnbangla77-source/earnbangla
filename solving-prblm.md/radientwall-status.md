# RadiantWall অফারওয়াল — earn.html ইন্টিগ্রেশন (স্ট্যাটাস)

> **স্ট্যাটাস: ✅ সম্পূর্ণ ও লাইভ টেস্টেড** — Frontend (`earn.html`) এবং
> Backend postback (`radientwall-postback.js`) দুটোই সম্পূর্ণ, deploy করা,
> এবং `curl.exe` দিয়ে production-এ সরাসরি টেস্ট করে কনফার্ম করা হয়েছে
> (২৬ আগস্ট ২০২৬)।

RadiantWall-ও Prime Wall-এর মতো Type B প্যাটার্নের — কোনো JSON offer feed
API নেই, শুধু একটা readymade iframe tracking link দেয়:

```
https://radientwall.com/offer/[SITE_KEY]/[USER_ID]
```

---

## Keys (RadiantWall dashboard → Sites)

- **Public/Site Key:** `Sn2Ld6` — কোডে সরাসরি বসানো (`earn.html`-এর
  `RADIANTWALL_PUBLIC_KEY`), secret না, tracking link-এর অংশ হিসেবে
  client-side-এ যাওয়ারই কথা।
- **Secret Key:** `Ad7Zt3Dy8Iw2Yb9` — Cloudflare env var হিসেবে সেট করা
  আছে (`RADIENTWALL_SECRET_KEY`, production + preview দুই জায়গাতেই)।
  Signature verify করতে ব্যবহার হয়।

## ধাপ ১ — ✅ `earn.html`-এ RadiantWall টাইল ও iframe মোডাল যোগ করা হয়েছে

- Partners grid-এ Offery/Prime Wall-এর পাশে "RadiantWall" টাইল
- `openOfferwall()` ডিসপ্যাচারে `partner === 'RadiantWall'` কেস →
  `openRadiantWallOfferwall()` (Prime Wall-এর হুবহু একই প্যাটার্নে,
  `setOfferwallMode('iframe')` ব্যবহার করে)
- `closeOfferwall()` আগের মতোই `owIframe.src = 'about:blank'` করে —
  Prime Wall আর RadiantWall দুটোরই জন্য কাজ করে (শেয়ার্ড iframe)

## ধাপ ২ — ✅ Postback প্যারামিটার ফরম্যাট (dashboard ডকুমেন্টেশন থেকে কনফার্মড)

RadiantWall **HTTP GET** রিকোয়েস্ট পাঠায় এই প্যারামিটারগুলো দিয়ে:

| Param | অর্থ |
|---|---|
| `subId` | earnbangla user id |
| `transId` | RadiantWall-এর transaction id |
| `reward` | reward amount (সবসময় absolute value) |
| `payout` | offer payout USD-এ |
| `signature` | `MD5(subId + transId + reward + SECRET_KEY)` |
| `status` | `1` = credit, `2` = reversal |
| `userIp` | user-এর IP (optional) |
| `offer_name` | অফারের নাম (optional) |
| `country` | ISO2 country code (optional) |

**Response যা RadiantWall আশা করে (Offery থেকে আলাদা!):**
- নতুন transaction সফলভাবে process হলে → **`"OK"`**
- আগে থেকেই process করা transaction হলে → **`"DUP"`** (এটা পাঠালে
  RadiantWall ওই transaction-এর জন্য retry বন্ধ করে দেয়)

## ধাপ ৩ — ✅ D1 schema — কোনো নতুন migration লাগেনি

আগের থেকেই থাকা `offer_completions` টেবিলের শেপ (`provider`, `user_id`,
`offer_id`, `transaction_id`, `payout`, `coins_earned`, `status`,
`created_at`) দিয়েই কাজ চলছে। RadiantWall কোনো numeric `offer_id` পাঠায়
না (শুধু `offer_name`, সেটাও optional) — তাই `offer_name`-টাই
`offer_id` কলামে রেফারেন্স হিসেবে রাখা হচ্ছে।

## ধাপ ৪ — ✅ Backend postback ফাইল লেখা ও production-এ টেস্ট করে কনফার্মড

`functions/api/offers/radientwall-postback.js` — `offery-postback.js`-এর
স্ট্রাকচারেই লেখা (duplicate-guard, reversal হ্যান্ডলিং, `users` টেবিলে
`coins`/`completed_offers`/`total_earning` আপডেট), শুধু RadiantWall-এর
নিজস্ব param নাম, signature ফর্মুলা, আর `"OK"`/`"DUP"` response string
ব্যবহার করে।

**Production-এ `curl.exe` দিয়ে সরাসরি যাচাই করা হয়েছে:**
1. Signature সঠিক হলে নতুন transaction → `"OK"` + coins credit ✅
2. একই `transId` দ্বিতীয়বার পাঠালে → `"DUP"` + coins দ্বিতীয়বার বাড়েনি ✅
3. Signature ভুল হলে → `403` + `"Signature doesn't match."` ✅

## ধাপ ৫ — ✅ Secret key সেটআপ সম্পন্ন

```
wrangler pages secret put RADIENTWALL_SECRET_KEY --project-name=earnbangla
wrangler pages secret put RADIENTWALL_SECRET_KEY --project-name=earnbangla --env preview
```
দুটোই সফলভাবে সেট করা হয়েছে।

## ধাপ ৬ — ✅ RadiantWall dashboard-এ Postback URL বসানো হয়েছে

Sites → Edit Your Site পেজে:
```
https://earn-bangla.com/api/offers/radientwall-postback
```
Exchange rate: `1000.0000` (1000 coins = $1, Offery-এর সাথে সিঙ্ক করা)।

## ধাপ ৭ — ✅ টেস্ট সম্পন্ন

RadiantWall dashboard-এর নিজস্ব "Test Postback" বাটন 500 error দিচ্ছিল
(তাদের সার্ভারের নিজস্ব সমস্যা মনে হয়েছে), তাই ম্যানুয়ালি `curl.exe` +
`wrangler pages deployment tail` দিয়ে সরাসরি production-এ টেস্ট করে
duplicate-guard সহ পুরো ফ্লো কনফার্ম করা হয়েছে (ধাপ ৪ দেখুন)।

---

## এই ইন্টিগ্রেশন থেকে শেখা (ভবিষ্যতের জন্য নোট)

- PowerShell-এ সবসময় `curl` না, **`curl.exe`** ব্যবহার করতে হবে —
  নাহলে `Invoke-WebRequest`-এর alias non-200 response-কে exception
  হিসেবে throw করে, raw body (error message) দেখা যায় না।
- PowerShell-এর পুরনো ভার্সনে `&&` চেইনিং কাজ করে না — প্রতিটা git
  কমান্ড আলাদা লাইনে চালাতে হবে।
- ফাইল আপডেট শুধু ডাউনলোড করলেই deploy হয় না — VS Code-এর আসল ফাইলে
  ম্যানুয়ালি কনটেন্ট বসিয়ে সেভ করে, তারপর commit+push করতে হবে;
  "nothing to commit" মানে ফাইলে আসলে কোনো পরিবর্তনই হয়নি।
- Cloudflare-এর log tail signature/secret-এর মতো sensitive-লাগা query
  param auto-redact করে ফেলে — ডিবাগ করার সময় সেগুলো object key হিসেবে
  না দিয়ে plain string-এ ভিন্ন key নামে লগ করলে redact হয় না।
- Provider-ভেদে postback-এর "সফল" response ভিন্ন হতে পারে (Offery-তে
  সবসময় `"ok"`, RadiantWall-এ `"OK"`/`"DUP"` — কেসটাও case-sensitive
  হতে পারে) — provider-এর নিজস্ব ডকুমেন্টেশন থেকেই কনফার্ম করে নেওয়া
  জরুরি, অন্য providerের প্যাটার্ন ধরে না নেওয়া ভালো।
