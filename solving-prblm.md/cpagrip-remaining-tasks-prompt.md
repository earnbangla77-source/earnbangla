# earnbangla — CPAGrip Offerwall Integration: বাকি কাজ (handoff prompt)

আমি "earnbangla" নামে একটা GPT (get-paid-to) ওয়েবসাইট বানাচ্ছি — Cloudflare Pages
(Functions) + Cloudflare D1 (SQLite) দিয়ে বানানো। লাইভ লিংক:
`https://earnbangla.pages.dev`, GitHub রিপো: `github.com/earnbangla77-source/earnbangla`,
D1 ডেটাবেসের নাম `earnbangla-db`।

সাইটে ইউজাররা অফার (survey/app install ইত্যাদি) সম্পূর্ণ করে কয়েন আয় করে, আর
সেই কয়েন Binance/Litecoin দিয়ে withdraw করতে পারে (২০০ কয়েন = $0.20)।

## এখন পর্যন্ত যা হয়ে গেছে (CPAGrip নিয়ে)

CPAGrip কে দ্বিতীয় offerwall provider হিসেবে যুক্ত করা হচ্ছে (প্রথমটা UpWall,
সেটা আগে থেকেই কাজ করছে)। এই কাজগুলো **সম্পূর্ণ হয়ে গেছে এবং টেস্ট করে
কনফার্ম করা হয়েছে**:

- `functions/api/offers/cpagrip-postback.js` — নতুন backend endpoint, CPAGrip-এর
  Global Postback (POST: `password`, `payout`, `offer_id`, `tracking_id`) রিসিভ
  করে, password ভেরিফাই করে, `(provider, user_id, offer_id)` কম্বিনেশন দিয়ে
  ডুপ্লিকেট আটকায়, `users.coins` আপডেট করে, `offer_completions` টেবিলে লগ
  রাখে। **⚠️ গুরুত্বপূর্ণ:** earnbangla-এর user id গুলো সংখ্যা না, UUID-স্টাইল
  স্ট্রিং (যেমন `b928735d8ff14aaab7d68687c4e8c075`) — তাই কোডে `tracking_id`
  কে `parseInt` করা হয় না, স্ট্রিং হিসেবেই ব্যবহার করা হয়।
- Coin conversion rate: `$1.00 = 1000 coins` (COINS_PER_DOLLAR কনস্ট্যান্ট
  কোডে বসানো আছে) — withdraw সিস্টেমের ২০০ কয়েন = $0.20 রেটের সাথে মিলিয়ে।
- `offer_completions` টেবিল D1-তে বানানো হয়েছে (আগে এটা একদমই ছিল না —
  UpWall-এর জন্যও এই টেবিল বানানো হয়নি, এখন CPAGrip-এর সাথেই বানানো হলো,
  তাই UpWall-এর কয়েন-লগিংও এখন থেকে কাজ করবে):
  ```sql
  CREATE TABLE IF NOT EXISTS offer_completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    offer_id TEXT,
    transaction_id TEXT,
    payout REAL NOT NULL,
    coins_earned INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ```
  (কলাম `user_id INTEGER` হলেও UUID স্ট্রিং সেভ হচ্ছে ঠিকমতো, কারণ SQLite-এর
  type affinity — আলাদা করে বদলানোর দরকার হয়নি।)
- Cloudflare-এ `OFFERWALL_POSTBACK_PASSWORD` env var সেট করা হয়েছে
  (Production + Preview দুই জায়গাতেই) — CPAGrip-এর Global Postback ফর্মে যে
  password দেওয়া হয়েছে ঠিক সেটাই।
- CPAGrip-এর Global Postback পেজে (`panels_tools_gpostback.php`) Postback URL
  বসানো হয়েছে: `https://earnbangla.pages.dev/api/offers/cpagrip-postback`,
  Enabled টগল অন করা হয়েছে।
- **লাইভ টেস্ট সফল** — নিজের curl কমান্ড দিয়ে টেস্ট করে `200 OK` +
  `{"status":"ok"}` পাওয়া গেছে, আর D1-তে গিয়ে চেক করে দেখা গেছে সংশ্লিষ্ট
  ইউজারের `coins` কলামে ঠিক ৯৯০ কয়েন যোগ হয়েছে ($0.99 payout দিয়ে টেস্ট করা
  হয়েছিল)।
- CPAGrip-এর নিজস্ব "Postback Simulator" ফিচারটা তাদের সার্ভারেই সাময়িকভাবে
  বন্ধ আছে ("postback test feature has been paused temporarily") — এটা
  আমাদের কোডের সমস্যা না, তাই বদলে সরাসরি curl দিয়ে টেস্ট করা হয়েছিল।

## এখনো যা বাকি আছে (এই কাজগুলো করে দিতে হবে)

1. **Duplicate-guard ভেরিফাই করা** — একই `tracking_id` + `offer_id` দিয়ে
   postback আরেকবার পাঠিয়ে কনফার্ম করা যে দ্বিতীয়বার coins **বাড়ছে না**
   (রেসপন্সে `{"status":"duplicate_ignored"}` আসা উচিত)। কোনো বাগ পেলে ঠিক
   করা।

2. **`earn.html`-এ CPAGrip টাইল যোগ করা** — UpWall টাইলের পাশে একই ডিজাইনে
   একটা নতুন "CPAGrip" টাইল বসাতে হবে। CPAGrip-এর JSON Offer Feed ব্যবহার
   করে অফার লিস্ট আনতে হবে:
   ```
   https://www.cpagrip.com/common/offer_feed_json.php?user_id=2549531&pubkey=ea0cba2918d5147f28df6c3b2c342e55&tracking_id=<SIGNED_IN_USER_ID>
   ```
   সাইন-ইন করা ইউজারের id (যেটা `/api/auth/me` থেকে পাওয়া যায়) `tracking_id`
   হিসেবে বসাতে হবে। JS দিয়ে fetch/getJSON করে `offers` অ্যারে থেকে অফার
   কার্ড রেন্ডার করতে হবে (UpWall-এর মতো iframe না, কারণ এটা একটা JSON
   feed — নিজের ডিজাইনে অফার কার্ড বানাতে হবে)।

3. **`PROJECT-STATUS.md` আপডেট করা** — উপরের সব কাজ শেষ হলে (duplicate-guard
   টেস্ট + earn.html টাইল) সেই অনুযায়ী `PROJECT-STATUS.md`-এর CPAGrip
   সেকশনটা "সম্পূর্ণ" হিসেবে মার্ক করে দিতে হবে (আগে ওই ফাইলে "চলছে" হিসেবে
   লেখা ছিল)।

4. **(ঐচ্ছিক, ভবিষ্যতে)** — চাইলে আরও offerwall provider (OfferToro,
   AdGate ইত্যাদি) একই প্যাটার্নে (নতুন `functions/api/offers/<provider>-postback.js`
   ফাইল + `earn.html`-এ নতুন টাইল) যোগ করা যাবে।

## গুরুত্বপূর্ণ প্রজেক্ট নিয়ম (মনে রাখতে হবে)

- `functions/` ফোল্ডারের গঠন খুব কঠোর — `admin/`, `auth/`, `profile/`,
  `withdraw/`, `offers/` সবগুলো সরাসরি `functions/api/`-এর ভেতরে,
  একটা আরেকটার ভেতরে ঢুকে গেলে Cloudflare route চিনবে না।
- কোনো পরিবর্তনের পর সবসময় লাইভ লিংকে (`https://earnbangla.pages.dev`)
  টেস্ট করতে হবে, `file://` দিয়ে খোলা পেজে API কল কাজ করে না।
- schema পরিবর্তন করলে `wrangler d1 execute earnbangla-db --remote --file=./schema.sql`
  (বা নির্দিষ্ট কমান্ড) দিয়ে লাইভ D1-তে রান করা বাধ্যতামূলক — শুধু
  `schema.sql`-এ লিখলেই হয় না।
- পরিবর্তনের পর `git add . && git commit -m "..." && git push origin main`
  করলেই Cloudflare Pages অটো-ডিপ্লয় করে (১-২ মিনিট সময় লাগে)।
