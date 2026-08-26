# earn-bangla.com — Offerwall Integration মাস্টার গাইড

> এই একটা ফাইলে earn-bangla.com-এ কীভাবে একটা offerwall provider (CPAGrip,
> Offery, Revtoo, PaidBucksy, RadiantWall, Prime Wall ইত্যাদি) যোগ করা হয়,
> কেন যেভাবে করা হয়, আর কোথায় কোথায় ভুল হতে পারে — সবকিছু আছে। নতুন কাউকে
> কাজ বোঝাতে বা নিজে ভবিষ্যতে রেফারেন্স হিসেবে ব্যবহার করার জন্য এটাই
> একমাত্র ফাইল দেখলেই যথেষ্ট হওয়া উচিত।

---

## ১. সিস্টেমটা কী করে (এক নজরে)

earn-bangla.com একটা GPT (Get-Paid-To) সাইট — ইউজাররা বিভিন্ন
"offerwall" পার্টনারের অফার/সার্ভে সম্পূর্ণ করে coins আয় করে। প্রতিটা
পার্টনারের দুইটা কাজ করতে হয়:

1. **ইউজারকে অফারগুলো দেখানো** (হয় আমাদের নিজের কার্ড-গ্রিড দিয়ে, নয়তো
   পার্টনারের নিজস্ব iframe embed করে)
2. **অফার সম্পূর্ণ হলে coins ক্রেডিট করা** — এটা পার্টনারের সার্ভার থেকে
   আমাদের সার্ভারে আসা একটা **postback (server-to-server callback)** দিয়ে
   হয়, ইউজারের ব্রাউজারের উপর ভরসা করে না (যাতে কেউ ফ্রন্টএন্ড থেকে
   জোর করে coins বাড়িয়ে নিতে না পারে)।

---

## ২. দুই ধরনের প্রোভাইডার প্যাটার্ন

### Type A — JSON Offer Feed (নিজেদের কার্ড-গ্রিড বানাই)

প্রোভাইডার একটা JSON API দেয় যেখানে অফারের লিস্ট থাকে (title, description,
image, reward, link)। আমরা backend-এ সেটা proxy করি (API key লুকানোর
জন্য) আর frontend-এ নিজেদের কার্ড ডিজাইনে দেখাই।

**উদাহরণ:** CPAGrip, Offery, Revtoo

**দুইটা ফাইল লাগে:**
- `functions/api/offers/<provider>-feed.js` — offers proxy
- `functions/api/offers/<provider>-postback.js` — coins ক্রেডিট

### Type B — Iframe-only (নিজস্ব offer-list UI দেয়, feed API নেই)

প্রোভাইডার শুধু একটা রেডিমেড iframe URL দেয়
(`https://provider.com/offer/[KEY]/[USER_ID]`) — পুরো অফার লিস্ট, ডিজাইন,
সবকিছু ওই iframe-এর ভেতরেই থাকে। আমরা শুধু iframe-টা মোডালে বসিয়ে দিই।

**উদাহরণ:** Prime Wall, RadiantWall, PaidBucksy

**একটাই ফাইল লাগে:**
- `functions/api/offers/<provider>-postback.js` — coins ক্রেডিট
  (feed.js লাগে না, কারণ offer দেখানোর কাজ প্রোভাইডার নিজেই করে)

---

## ৩. `earn.html`-এ কমন প্যাটার্ন (দুই টাইপেই একই কাঠামো)

```js
// 1. partners-grid-এ বাটন
<button class="partner-card" onclick="openOfferwall('ProviderName')">...</button>

// 2. dispatcher-এ কেস
function openOfferwall(partner){
  if(partner === 'ProviderName'){ openProviderNameOfferwall(); return; }
  ...
}

// 3a. Type A হলে — grid mode + normalize + card HTML ফাংশন
setOfferwallMode('grid');
fetch(`${API_BASE}/offers/<provider>-feed`) → normalize → card HTML

// 3b. Type B হলে — iframe mode
setOfferwallMode('iframe');
owIframe.src = `https://provider.com/offer/${PUBLIC_KEY}/${encodeURIComponent(currentUserId)}`;
```

`currentUserId` — সাইন-ইন করা ইউজারের `user.id`, `checkSession()`-এ সেট
হয় (`/api/auth/me` থেকে)। Type B প্রোভাইডারদের iframe URL-এ সরাসরি এটা
লাগে; Type A প্রোভাইডারদের লাগে না কারণ feed.js নিজেই session cookie
থেকে ইউজার লুকআপ করে server-side-এ।

`setOfferwallMode('grid' | 'iframe')` মোডালের ভেতরের `#owGrid` আর
`#owIframeWrap`-এর মধ্যে টগল করে। `closeOfferwall()` সবসময়
`owIframe.src = 'about:blank'` করে — Type B প্রোভাইডার ব্যাকগ্রাউন্ডে
চলতে থাকা বন্ধ করার জন্য।

---

## ৪. Backend postback ফাইলের কমন কাঠামো

সব `<provider>-postback.js` ফাইল একই কঙ্কালে বানানো (`offery-postback.js`
আসল টেমপ্লেট):

1. GET (কখনো কখনো POST-ও) রিকোয়েস্টের query params পড়া
2. **MD5 সিগনেচার ভেরিফাই করা** — `MD5(user_id + transaction_id + reward + SECRET)`
   (প্যারামিটারের নাম প্রোভাইডার-ভেদে ভিন্ন হতে পারে, সূত্র প্রায় একই)
3. `status` চেক — credit (নতুন coins যোগ) নাকি reversal/chargeback (আগের
   coins বাতিল)
4. `offer_completions` টেবিলে `provider + transaction_id` দিয়ে duplicate
   চেক — আগেই প্রসেস করা transaction হলে দ্বিতীয়বার coins না বাড়ানো
5. `users` টেবিলে `coins`, `completed_offers`, `total_earning` — তিনটাই
   আপডেট (শুধু `coins` না — এটা একটা পুরনো বাগ ছিল, নিচে দেখুন)
6. প্রোভাইডার-নির্দিষ্ট রেসপন্স স্ট্রিং রিটার্ন করা (নিচের টেবিল দেখুন)

### D1 schema — একবারই লাগে, সব প্রোভাইডারের জন্য শেয়ার্ড

```sql
ALTER TABLE offer_completions ADD COLUMN transaction_id TEXT;
ALTER TABLE offer_completions ADD COLUMN status TEXT NOT NULL DEFAULT 'credited';
CREATE INDEX IF NOT EXISTS idx_offer_completions_provider_transaction
  ON offer_completions (provider, transaction_id);
```

এটা প্রথম Offery integration-এর সময় একবার চালানো হয়েছিল। **নতুন কোনো
প্রোভাইডার যোগ করলে নতুন migration লাগে না** — শুধু `provider = '<নাম>'`
দিয়ে আলাদা রো হিসেবে সেভ হয়।

### `earnings_30d` লাইভ ক্যালকুলেট হয়

`functions/api/auth/me.js` কোনো static কলাম থেকে earnings_30d পড়ে না —
প্রতিবার `offer_completions` টেবিল থেকে "গত ৩০ দিনের coins_earned SUM"
হিসেবে লাইভ বের করে। তাই নতুন প্রোভাইডারের postback ফাইলে এই নিয়ে আলাদা
কিছু করার দরকার নেই, `offer_completions`-এ ঠিকমতো রো ঢুকলেই এটা
আপনাআপনি কাজ করবে।

---

## ৫. প্রোভাইডার-ভেদে যা যা আলাদা হতে পারে (এখানেই সবচেয়ে বেশি বাগ হয়)

| | Offery | Revtoo | RadiantWall | PaidBucksy | Prime Wall | CPAGrip |
|---|---|---|---|---|---|---|
| টাইপ | A (feed) | A (feed) | B (iframe) | B (iframe) | B (iframe) | A (feed) |
| Method | GET | GET | GET | GET | ? (অজানা) | POST (password-based, MD5 না) |
| ID param নাম | `subId`/`transId` | `subId`/`transId` | `subId`/`transId` | `user_id`/`transaction_id` | ? (অজানা) | `tracking_id` |
| Auth পদ্ধতি | MD5 signature | MD5 signature | MD5 signature | MD5 signature | ? (অজানা) | shared **password** (query/body param, signature না) |
| সফল রেসপন্স | `"ok"` (lowercase) | `"ok"` (lowercase) | `"OK"` (uppercase) | `"OK"` (uppercase) | ? (অজানা) | JSON (`{"status":"credited"}` টাইপ, ফাইল শেয়ার করা হয়নি) |
| ডুপ্লিকেট রেসপন্স | `"ok"` (idempotent, একই) | `"ok"` (idempotent) | `"DUP"` | `"DUP"` | ? (অজানা) | ? |

**⚠️ সবচেয়ে গুরুত্বপূর্ণ শিক্ষা:** কোনো প্রোভাইডারের রেসপন্স ফরম্যাট
আরেকটার মতো হবে ধরে নেওয়া যাবে না — case পর্যন্ত মিলতে হবে
(`"ok"` ≠ `"OK"`)। ভুল হলে প্রোভাইডার postback fail ধরে বারবার retry
করতে থাকবে। **সবসময় প্রোভাইডারের নিজস্ব ডকুমেন্টেশন থেকে কনফার্ম করে
নিতে হবে**, অন্য প্রোভাইডারের কোড কপি করে অনুমান করা যাবে না।

---

## ৬. প্রতিটা প্রোভাইডারের বর্তমান স্ট্যাটাস

### ✅ Offery — কোড রেডি, live test approval-এর অপেক্ষায়
ধাপ ১–৬ সম্পূর্ণ (feed.js, postback.js, D1 migration, tile, dispatcher,
API/Secret key বসানো)। placement তখনো "Pending" ছিল Offery টিমের
অনুমোদনের জন্য — approve হলে ধাপ ৭ (live curl test) বাকি।

### ✅ Revtoo — কোড রেডি ও deploy করা, live test কনফার্মেশন এই কথোপকথনে হয়নি
- Placement **Approved** — API Key + Secret Key স্ক্রিনশট থেকে কনফার্মড
  ও বসানো হয়েছে (`revtoo-feed.js`-এ API key, `REVTOO_SECRET_KEY` wrangler
  secret upload সফল হয়েছে — পরে PaidBucksy টেস্টের সময় tail log-এ
  `Success! Uploaded secret REVTOO_SECRET_KEY` দেখা গেছে)।
- Postback URL dashboard-এ বসানো হয়েছে কিনা, বা ধাপ ৮-এর live curl/sandbox
  test চালানো হয়েছে কিনা — এটা এই কথোপকথনে সরাসরি কনফার্ম করা হয়নি।
  **পরবর্তী সেশনে এটাই প্রথম চেক করার জিনিস।**

### ✅ PaidBucksy — সম্পূর্ণ টেস্টেড
Type B (iframe)। Public Key (`Uv2Cz8`) কোডে বসানো, Secret Key
(`Bv8Ad5Kq4Ny2Ak5`) wrangler-এ সেট করা। `paidbucksy-postback.js` production-এ
`curl.exe` দিয়ে সরাসরি টেস্ট করে কনফার্মড:
- সঠিক সিগনেচারে নতুন transaction → `"OK"` + real user-এ coins ক্রেডিট ✅
- একই `transaction_id` দ্বিতীয়বার → `"DUP"` + coins দ্বিতীয়বার বাড়েনি ✅
- ⚠️ টেস্টে ব্যবহৃত real user (`b928735d8ff14aaab7d68687c4e8c075`)-এর
  একাউন্টে ১০০ coins টেস্ট-ক্রেডিট রয়ে গেছে — যদি real ইউজার হয়ে থাকে,
  ম্যানুয়ালি বিয়োগ করে নেওয়া দরকার।

### ✅ RadiantWall — সম্পূর্ণ ও লাইভ টেস্টেড
Type B (iframe)। Public Key (`Sn2Ld6`) কোডে, Secret Key
(`Ad7Zt3Dy8Iw2Yb9`) wrangler-এ সেট করা। Production-এ curl দিয়ে টেস্ট
করে কনফার্মড: সঠিক সিগনেচারে `"OK"` + credit, ডুপ্লিকেটে `"DUP"`,
ভুল সিগনেচারে `403`। RadiantWall dashboard-এর নিজস্ব "Test Postback"
বাটন 500 error দিচ্ছিল বলে ম্যানুয়াল curl টেস্টেই ভরসা করা হয়েছে।

### ⏳ Prime Wall — ব্লকড, postback ফরম্যাট অজানা
Frontend (tile, iframe modal, `PRIMEWALL_PUBLIC_KEY = 'Il7Eo8'`) সম্পূর্ণ।
কিন্তু Prime Wall postback-এ ঠিক কোন প্যারামিটার কোন নামে পাঠায় সেটা
এখনো জানা যায়নি। **আনব্লক করার প্ল্যান:** একটা debug postback ফাইল
deploy করে (যেটা DB টাচ না করে শুধু আসা সবকিছু `console.log` করে আর
`"ok"` রিটার্ন করে) Prime Wall dashboard-এর Postback Tester দিয়ে একটা
টেস্ট postback পাঠিয়ে `wrangler pages deployment tail`-এ raw params
দেখে ফরম্যাট বের করা।

### CPAGrip — মূল/প্রথম প্রোভাইডার, বিস্তারিত ফাইল এই কথোপকথনে শেয়ার করা হয়নি
`OFFERWALL-TROUBLESHOOTING.md`-এর উদাহরণ থেকে বোঝা যায় এটা অন্যদের মতো
MD5 signature-ভিত্তিক না — বরং একটা shared **password** query/body
param দিয়ে ভেরিফাই হয় (`password`, `payout`, `offer_id`, `tracking_id`
ফিল্ড, POST + `--data-urlencode`)। `cpagrip-postback.js`-এ profile.html-এর
`completed_offers`/`total_earning` বাগ ফিক্সটা এখনো apply করা হয়নি
বলে নোট আছে (offery-integration-tasks-prompt.md-এ) — এটা কনফার্ম করে
ফিক্স করা দরকার।

---

## ৭. জানা বাগ ও ফিক্স হিস্ট্রি

### ফিক্সড: profile.html-এ Completed Offers / Total Earning সবসময় 0 দেখাত
**কারণ:** postback ফাইল শুধু `users.coins` আপডেট করত, `completed_offers`
আর `total_earning` কলাম কখনো টাচ হতো না।
**ফিক্স:** credit ব্লকে তিনটা কলামই ইনক্রিমেন্ট, chargeback-এ তিনটাই
ডিক্রিমেন্ট (0-এর নিচে না)। **Offery আর নতুন সব প্রোভাইডারে এই ফিক্স
আছে। CPAGrip-এ এখনো apply করা হয়নি (⏳ বাকি)।**

---

## ৮. Troubleshooting — কমন সমস্যা ও সমাধান

### PowerShell-এ `curl` আসলে `curl` না
`curl` আসলে `Invoke-WebRequest`-এর alias — non-200 response পেলে এটা
exception throw করে, raw body দেখা যায় না, আর `\` দিয়ে line continuation
কাজ করে না। **সমাধান:** সবসময় `curl.exe` লিখুন (শুধু `curl` না), পুরো
কমান্ড এক লাইনে। প্রয়োজনে `-UseBasicParsing` ফ্ল্যাগও দেওয়া যায়।

### Password/secret-এ special character (`$`, `&`, `#`) থাকলে shell-এ ভুল যায়
ডাবল কোটের ভেতরে `$` PowerShell variable substitution ভেবে বদলে ফেলে।
**সমাধান:** সিঙ্গেল কোট (`'...'`) ব্যবহার করুন, অথবা শুরু থেকেই সহজ
(শুধু অক্ষর+সংখ্যা) password/secret বেছে নিন।

### Cloudflare env var নাম কোডের সাথে হুবহু না মিললে Access Denied
কোডে `env.XXX` যে নামে আছে, Cloudflare-এও ঠিক সেই বানানে (case-sensitive)
variable বানাতে হবে।

### Dashboard UI দিয়ে env var এডিট করলে পুরনো (লাইভ) deployment-এ কার্যকর হয় না
Cloudflare Pages-এ secret একটা নির্দিষ্ট deployment-এর সাথে bind হয়ে
যায়। **সমাধান:** সবসময় `wrangler pages secret put <NAME> --project-name=<project>`
ব্যবহার করুন dashboard UI-এর বদলে (production + `--env preview` দুই
জায়গাতেই আলাদা)। এরপরও পুরনো deployment লাইভ থাকলে জোর করে নতুন deploy
ট্রিগার করুন:
```powershell
git commit --allow-empty -m "trigger redeploy"
git push origin main
```
Deployments ট্যাবে "Success" (✓) কনফার্ম করার পরই টেস্ট করুন — push
করার সাথে সাথে না, ১-২ মিনিট লাগে।

### ফাইল ডাউনলোড করলেই deploy হয় না
আসল ফাইলে ম্যানুয়ালি কনটেন্ট বসিয়ে সেভ করে, তারপর commit+push করতে
হবে। "nothing to commit" মানে আসলে কোনো পরিবর্তনই ফাইলে হয়নি।

### PowerShell-এর পুরনো ভার্সনে `&&` চেইনিং কাজ করে না
প্রতিটা কমান্ড (যেমন প্রতিটা `git` কমান্ড) আলাদা লাইনে চালাতে হবে।

### Cloudflare-এর log tail sensitive-লাগা query param auto-redact করে ফেলে
সিগনেচার/সিক্রেট-এর মতো নাম দেখলে (key নামে) মান লুকিয়ে ফেলে। ডিবাগ করার
সময় সেগুলো object key হিসেবে না দিয়ে ভিন্ন নামে plain string log করলে
redact হয় না।

### Postback Tester-এর ডামি User ID দিয়ে coins ক্রেডিট না হওয়া
প্রোভাইডারের নিজস্ব dashboard Tester-এ User ID ফিল্ড খালি রাখলে অনেক
প্রোভাইডার নিজে থেকে একটা র‍্যান্ডম/ডামি ID বসিয়ে দেয় — সেই ID আমাদের
`users` টেবিলে নেই বলে postback সিগনেচার মিললেও `"User not found."`
রিটার্ন হয়, coins ক্রেডিট হয় না। **সমাধান:** টেস্ট করার সময় real
sign-in করা ইউজারের real `user.id` বসাতে হবে (D1 থেকে
`SELECT id FROM users LIMIT 5;` দিয়ে বের করা যায়)।

### দ্রুততম ডিবাগ পদ্ধতি: Live log tail
```powershell
wrangler pages deployment tail --project-name=earnbangla
```
এটা এক terminal-এ চালিয়ে রেখে আরেক terminal-এ curl কমান্ড চালান —
`console.log`/`console.error` মেসেজ সাথে সাথে দেখা যাবে, ঠিক কোথায়
সমস্যা সেটা guess না করে সরাসরি জানা যায়।

---

## ৯. নতুন প্রোভাইডার যোগ করার চেকলিস্ট (কপি-পেস্ট রেডি)

1. প্রোভাইডারের অফিসিয়াল ডকুমেন্টেশন খুঁজে বের করুন (docs./gitbook.io
   সাবডোমেইন সাধারণত থাকে) — feed API + postback দুটোই পড়ুন, অন্য
   প্রোভাইডারের সাথে মিলবে ধরে না নিয়ে।
2. Type A (JSON feed) নাকি Type B (iframe-only) — ঠিক করুন।
3. **Type A হলে:**
   - `functions/api/offers/<provider>-feed.js` — session cookie থেকে
     ইউজার লুকআপ, API key দিয়ে upstream fetch, response normalize করে
     পাঠানো
   - `earn.html`-এ `normalize<Provider>Offer()`, `<provider>CardHTML()`,
     `open<Provider>Offerwall()` — আগের Type A প্রোভাইডারের প্যাটার্নে,
     কিন্তু response shape নিজে থেকে ভিন্ন হতে পারে ধরে নিয়ে যাচাই করে
   - **Type B হলে:** `earn.html`-এ শুধু `<PROVIDER>_PUBLIC_KEY` কনস্ট্যান্ট
     + `open<Provider>Offerwall()` (Prime Wall/RadiantWall/PaidBucksy-এর
     প্যাটার্নে, `setOfferwallMode('iframe')` ব্যবহার করে)
4. `functions/api/offers/<provider>-postback.js` — MD5 সিগনেচার ফর্মুলা,
   param নাম, expected response string — সবকিছু প্রোভাইডারের
   ডকুমেন্টেশন থেকে হুবহু মিলিয়ে লিখুন (§৫-এর টেবিল দেখুন, নতুন সারি
   যোগ করুন)।
5. `earn.html`-এ partner tile + `openOfferwall()` dispatcher-এ কেস যোগ।
6. D1 migration — সাধারণত লাগে **না** (§৪ দেখুন), শুধু নতুন কোনো
   ভিন্নধর্মী কলাম দরকার হলে।
7. `wrangler pages secret put <PROVIDER>_SECRET_KEY --project-name=earnbangla`
   (production + `--env preview` দুই জায়গায়)
8. প্রোভাইডারের dashboard-এ Postback URL বসিয়ে **Update/Save** চাপা —
   ভুলে গেলে postback-ই আসবে না।
9. Exchange Rate / Currency ফিল্ড ঠিক আছে কিনা (অন্য প্রোভাইডারদের সাথে
   সাধারণত 1000 coins = $1 রেটে সিঙ্ক করা হয়) কনফার্ম করা।
10. Deploy → Deployments ট্যাবে "Success" কনফার্ম → `wrangler pages
    deployment tail` চালু রেখে real user ID দিয়ে curl.exe টেস্ট:
    - নতুন transaction → সঠিক সফল রেসপন্স স্ট্রিং + coins ক্রেডিট
    - একই transaction আবার → ডুপ্লিকেট রেসপন্স + coins দ্বিতীয়বার না
      বাড়া
    - ভুল সিগনেচার → 403 + এরর মেসেজ
11. সব ঠিক থাকলে এই ফাইলের §৬ (স্ট্যাটাস টেবিল) আপডেট করুন।
