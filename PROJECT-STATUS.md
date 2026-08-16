# earnbangla — প্রজেক্ট স্ট্যাটাস ও পরবর্তী কাজ

এই ফাইলটা যে কেউ পড়েই বুঝতে পারবে এখন পর্যন্ত কী কী কাজ হয়েছে, সাইট কীভাবে কাজ করে, আর
পরে কী কী করা বাকি। নতুন কেউ কাজ শুরু করলে প্রথমে এই ফাইলটা পড়ুন।

---

## ১. এই প্রজেক্টটা কী

**earnbangla** — একটা ওয়েবসাইট যেখানে ইউজাররা অ্যাপ টেস্ট করে, গেম খেলে, সার্ভে
পূরণ করে টাকা আয় করতে পারবে। এটা Cloudflare Pages এ হোস্ট করা, ডেটাবেস হিসেবে
Cloudflare D1 (SQLite) ব্যবহার করা হয়েছে।

- **লাইভ লিংক:** `https://earnbangla.pages.dev`
- **GitHub রিপো:** `github.com/earnbangla77-source/earnbangla`
- **হোস্টিং:** Cloudflare Pages (GitHub এ push করলেই auto-deploy হয়)
- **ডেটাবেস:** Cloudflare D1, নাম `earnbangla-db`

---

## ২. এখন পর্যন্ত যা যা কাজ হয়ে গেছে ✅

- [x] হোমপেজ ডিজাইন (`index.html`) — offers, sign up ফর্ম, ইত্যাদি
- [x] Earn পেজ ডিজাইন (`earn.html`)
- [x] Profile পেজ ডিজাইন (`profile.html`) — এখন Withdraw বাটনসহ (topbar + Account
      Information প্যানেল + sidebar), `withdraw.html` এ নিয়ে যায়
- [x] Leaderboard পেজ ডিজাইন (`leaderboard.html`) — podium + full ranking table,
      real API থেকে ডেটা লোড করে, API fail করলে placeholder ডেটা দেখায়
- [x] **Withdraw / Cash out পেজ ডিজাইন (`withdraw.html`)** — profile.html এর
      সাথে ডিজাইন/animation/sidebar মিলিয়ে বানানো নতুন পেজ। Cashout method
      হিসেবে **Litecoin** আর **Binance Pay** — tile আকারে দেখায়, ক্লিক করলে
      সেই মেথডের withdraw ফর্ম খোলে (address + amount + MAX বাটন + summary)।
      Minimum withdrawal: **200 coins = $0.20** — এর নিচে balance থাকলে warning
      দেখিয়ে ফর্ম disable করে দেয়।
- [x] D1 ডেটাবেসের schema (`schema.sql`) — `users`, `sessions`, `activity_log`,
      আর নতুন **`withdrawals`** টেবিল
- [x] আসল **backend API** (Cloudflare Pages Functions):
  - `functions/api/auth/register.js` — নতুন অ্যাকাউন্ট বানায়
  - `functions/api/auth/login.js` — সাইন ইন করায়
  - `functions/api/auth/logout.js` — সাইন আউট করায়
  - `functions/api/auth/me.js` — বর্তমান লগইন করা ইউজারের তথ্য দেয়
  - `functions/api/profile/update.js` — ইউজারনেম/অ্যাভাটার/প্রাইভেসি আপডেট করে
  - `functions/api/leaderboard.js` — `users.coins` অনুযায়ী রank করে (বেশি কয়েন
    আগে), top 50 রিটার্ন করে, সাইন-ইন করা ইউজারের নিজের rank বের করে (top 50 এর
    বাইরে থাকলেও), প্রতিটা rank এর জন্য static prize বসায়
  - **`functions/api/withdraw/request.js`** (নতুন) —
    - `POST` → withdraw রিকোয়েস্ট নেয় (method, address, coinsUsed), balance
      যথেষ্ট আছে কিনা guard করে চেক করে (`UPDATE ... WHERE coins >= ?`),
      coins deduct করে, `withdrawals` টেবিলে `status = 'pending'` সহ একটা
      রেকর্ড বসায়
    - `GET` → সাইন-ইন করা ইউজারের নিজের সব withdrawal history রিটার্ন করে
      (সর্বশেষ ৫০টা) — এখন `profile.html`-এর Activity ট্যাব থেকে সরাসরি call
      হচ্ছে (নিচে দেখুন)
  - **`functions/api/auth/forgot-password.js`** (নতুন) — ইমেইল নিয়ে ৬-ডিজিট
    OTP জেনারেট করে (PBKDF2 দিয়ে হ্যাশ করে `password_resets` টেবিলে সেভ),
    Resend দিয়ে ইমেইল পাঠায়। প্রতি ইমেইলে ২৪ ঘণ্টায় সর্বোচ্চ ২টা OTP —
    রেট লিমিট আছে। ইমেইল না পেলেও same generic success দেখায় (email
    enumeration প্রোটেকশন)।
  - **`functions/api/auth/reset-password.js`** (নতুন) — email + OTP + নতুন
    পাসওয়ার্ড একসাথে নিয়ে ভেরিফাই করে পাসওয়ার্ড আপডেট করে, আর সিকিউরিটি
    বোনাস হিসেবে ওই ইউজারের সব পুরনো session ডিলিট করে দেয় (সব ডিভাইস থেকে
    লগ-আউট)।
  - `functions/_lib/auth.js` — পাসওয়ার্ড হ্যাশিং, সেশন কুকি, `normalizeEmail()`
    হেল্পার — শেয়ার্ড কোড
  - `functions/_lib/email.js` (নতুন) — Resend API দিয়ে ইমেইল পাঠানোর শেয়ার্ড
    হেল্পার (`sendEmail`) + OTP ইমেইলের HTML টেমপ্লেট
- [x] Sign Up / Sign In / Sign Out — আসল D1 ডেটাবেসের সাথে কাজ করছে (টেস্ট করা হয়েছে)
- [x] লগইন করার পর হোমপেজে "Sign up for free" ফর্মটা লুকিয়ে যায়
- [x] **`schema.sql`-এর `withdrawals` টেবিল লাইভ D1 তে বসানো হয়ে গেছে** —
      D1 Studio তে গিয়ে ভেরিফাই করা হয়েছে (আসল রেকর্ড দেখা গেছে)
- [x] **Leaderboard সেশন কুকি নাম মিলিয়ে ঠিক করা হয়েছে** — `leaderboard.js`
      এখন `functions/_lib/auth.js`-এর আসল কুকি `eb_session` ব্যবহার করে, "Your
      rank" ঠিকমতো দেখায়
- [x] **Profile পেজের "Activity" ট্যাব — Withdrawals ও Pending এখন লাইভ ডেটা
      দেখায়** — `functions/api/withdraw/request.js`-এর `GET` কল করে
      status অনুযায়ী ভাগ করা হয়েছে:
  - **Pending ট্যাব** → `status = 'pending'` request গুলো (badge count সহ)
  - **Withdrawals ট্যাব** → resolved request গুলো (`completed`/`rejected`),
      প্রতিটার সাথে method, address (shortened), তারিখ-সময়, coins + $ amount,
      আর রঙিন status pill দেখায়
  - dashboard লোড হওয়ার সাথেই দুই ট্যাবের badge count চুপচাপ preload হয়ে যায়
  - **Earnings ট্যাব এখনো বাকি** — এটার জন্য আলাদা backend endpoint লাগবে
    (নিচে "পরবর্তী কাজ" দেখুন)
- [x] **Forgot Password (Email OTP) — সম্পূর্ণ কাজ করছে** — Sign In ফর্মে
      "Forgot password?" লিংক, ২-স্টেপ মোডাল (email → OTP + নতুন পাসওয়ার্ড),
      `forgot-password.js`/`reset-password.js` ব্যাকএন্ড, `password_resets`
      টেবিল, Resend দিয়ে ইমেইল পাঠানো। ⚠️ কাজ করতে হলে Cloudflare env var-এ
      `RESEND_API_KEY` সেট করা থাকতে হবে (নিচে "৪. নতুন কাজ শুরু করার আগে
      চেক করে নিন" দেখুন) — না থাকলে code পাঠানো fail করবে।
- [x] **Earn পেজে UpWall অফারওয়াল ইন্টিগ্রেশন** — `earn.html`-এর "UpWall"
      টাইলে আসল `offerwall.upwall.io` iframe বসানো হয়েছে (সাইন-ইন করা
      ইউজারের id সহ), আর `functions/api/offers/postback.js` বানানো হয়েছে
      যেটা password ভেরিফাই করে, `transaction_id` দিয়ে ডুপ্লিকেট ক্রেডিট
      আটকায়, `users.coins` আপডেট করে, আর `offer_completions` টেবিলে লগ
      রাখে।
- [x] **CPAGrip অফারওয়াল ইন্টিগ্রেশন — সম্পূর্ণ, লাইভ কাজ করছে** (দ্বিতীয়
      প্রোভাইডার, CPAGrip AffID #2549531):
  - `functions/api/offers/cpagrip-postback.js` — CPAGrip-এর Global
    Postback (POST: password, payout, offer_id, tracking_id) রিসিভ করে,
    password ভেরিফাই করে, `users.coins` আপডেট করে ($1.00 = 1000 coins),
    `offer_completions` টেবিলে লগ রাখে। যেহেতু CPAGrip কোনো ইউনিক
    transaction id দেয় না, ডুপ্লিকেট-গার্ড করা হয়েছে
    `(provider, user_id, offer_id)` কম্বিনেশন দিয়ে — **লাইভ টেস্ট করে
    কনফার্ম করা হয়েছে**: একই offer_id দুইবার পাঠালে দ্বিতীয়বার
    `{"status":"duplicate_ignored"}` রিটার্ন করে, coins আর বাড়ে না।
  - `functions/api/offers/cpagrip-feed.js` — earn.html থেকে সরাসরি
    cpagrip.com-এ কল না করে নিজের ব্যাকএন্ড দিয়ে CPAGrip-এর JSON Offer
    Feed proxy করে (CORS সমস্যা এড়াতে, আর সাইন-ইন করা ইউজারের
    `tracking_id` সেশন থেকে সার্ভার-সাইডে বসানো হয় বলে devtools থেকে
    spoof করা যায় না)।
  - `earn.html`-এর Offers Partners সেকশনে UpWall-এর পাশে **CPAGrip টাইল**
    বসানো হয়েছে — ক্লিক করলে মোডাল খুলে `/api/offers/cpagrip-feed` থেকে
    আসল লাইভ অফার (title, description, ছবি, coin reward সহ) কার্ড আকারে
    দেখায়। **লাইভে টেস্ট করে কনফার্ম করা হয়েছে** — real offers (যেমন
    "Get $100 to Spend at Jersey Mikes!") ঠিকমতো লোড ও রেন্ডার হচ্ছে।
  - Cloudflare-এ `OFFERWALL_POSTBACK_PASSWORD` secret সেট করা আছে
    (Production + Preview, `wrangler pages secret put` দিয়ে সেট করা —
    ⚠️ dashboard UI দিয়ে env var এডিট করলে চলতি deployment-এ কার্যকর
    নাও হতে পারে, নতুন deploy লাগে; `wrangler pages secret put` দিয়ে
    সেট করাই সবচেয়ে নির্ভরযোগ্য)।
  - CPAGrip ড্যাশবোর্ডে Global Postback ফর্মে Postback URL আর password
    বসানো আছে। ⚠️ **Enabled টগল অন আছে কিনা মাঝে মাঝে যাচাই করে নেবেন।**
- [x] **ডুপ্লিকেট-অ্যাকাউন্ট বাগ তদন্ত করা হয়েছে — বাগ নেই** — `register.js`/
      `login.js` দুটোতেই email `.trim().toLowerCase()` করে normalize করা
      আছে, আর `schema.sql`-এ `users.email UNIQUE`। D1-এ কোয়েরি চালিয়ে কনফার্ম
      করা হয়েছে — কোনো case-mismatch বা exact ডুপ্লিকেট ইমেইল অ্যাকাউন্ট
      নেই। (`normalizeEmail()` হেল্পারটা এখন `auth.js`-এ আছে, ভবিষ্যতে নতুন
      auth এন্ডপয়েন্টে রিইউজ করার জন্য।)

**মানে এখন সাইটে রিয়েল অ্যাকাউন্ট সিস্টেম কাজ করছে** — কেউ সাইন আপ করলে সেটা
সত্যিকারের D1 ডেটাবেসে সেভ হয়, পাসওয়ার্ড হ্যাশ করা থাকে, সেশন কুকি দিয়ে লগইন
মনে রাখে। লিডারবোর্ডও এখন লাইভ ডেটার সাথে যুক্ত, "Your rank" ঠিকমতো দেখায়।
**Withdraw সিস্টেমও এখন সম্পূর্ণ এন্ড-টু-এন্ড কাজ করছে** — ফ্রন্টএন্ড, ব্যাকএন্ড,
D1 টেবিল সব লাইভ, আর profile.html-এর Activity ট্যাবেও (Pending/Withdrawals)
নিজের request history status অনুযায়ী দেখা যাচ্ছে।

---

## ৩. ফোল্ডার স্ট্রাকচার (এভাবেই থাকতে হবে)

```
incm website/
├── functions/
│   ├── _lib/
│   │   ├── auth.js
│   │   └── email.js
│   └── api/
│       ├── auth/
│       │   ├── register.js
│       │   ├── login.js
│       │   ├── logout.js
│       │   ├── me.js
│       │   ├── forgot-password.js
│       │   └── reset-password.js
│       ├── profile/
│       │   └── update.js
│       ├── withdraw/
│       │   └── request.js
│       ├── activity.js
│       └── leaderboard.js
├── index.html
├── earn.html
├── profile.html
├── withdraw.html
├── leaderboard.html
├── schema.sql
├── wrangler.toml
└── README.md
```

⚠️ **ভুল করলে যা হবে:** `functions/` এর ভেতরের ফাইলগুলো যদি ভুল জায়গায় (যেমন
রুটে সরাসরি, বা `withdraw/` ভুলে `profile/`কিংবা `auth/`এর ভেতরে ঢুকে গেলে)
থাকে, তাহলে Cloudflare সেগুলোকে সঠিক API রুট হিসেবে চিনবে না এবং সেই ফিচার কাজ
করবে না। `withdraw` ফোল্ডার অবশ্যই `api/`-এর সরাসরি ভেতরে, `auth`/`profile`-এর
**পাশাপাশি** (ভেতরে না) থাকতে হবে — কারণ `request.js`-এর ভেতরের
`import ... from "../../_lib/auth.js"` ঠিক এই depth ধরেই লেখা।

---

## ৪. নতুন কাজ শুরু করার আগে চেক করে নিন

1. Cloudflare Dashboard → Workers & Pages → `earnbangla` প্রজেক্ট → **Settings →
   Functions → D1 database bindings** এ `DB` নামে `earnbangla-db` bind করা আছে
   কিনা (Production আর Preview দুই জায়গাতেই)। এটা ছাড়া API কাজ করবে না।
2. **`RESEND_API_KEY` env var সেট করা আছে কিনা** — Settings → Environment
   variables এ secret হিসেবে (Production আর Preview দুই জায়গাতেই)। এটা ছাড়া
   Forgot Password-এর OTP ইমেইল পাঠানো যাবে না। Resend-এ ডোমেইন verify করা
   না থাকলে ডিফল্ট sender (`onboarding@resend.dev`) ব্যবহার হবে — নিজের
   ডোমেইন verify করা হলে `RESEND_FROM_EMAIL` env var সেট করে বদলে নেওয়া যায়।
2. `schema.sql` এ পরিবর্তন হলে (যেমন নতুন `withdrawals` টেবিল) সেটা D1 তে বসাতে
   ভুলবেন না:
   ```
   wrangler d1 execute earnbangla-db --remote --file=./schema.sql
   ```
   (সব statement এ `IF NOT EXISTS` আছে, তাই পুরো ফাইল বারবার রান করলেও আগের
   ডেটার ক্ষতি হয় না।)
3. কোনো পরিবর্তন করার পর সবসময়:
   ```
   git add .
   git commit -m "যা পরিবর্তন করলেন তার সংক্ষিপ্ত বর্ণনা"
   git push origin main
   ```
   পুশ করলেই Cloudflare Pages নিজে থেকে নতুন করে deploy করে দেয় (১-২ মিনিট
   সময় লাগে)।
4. সবসময় **deploy করা লিংকে** (`https://earnbangla.pages.dev`) টেস্ট করুন,
   কম্পিউটারে সরাসরি ফাইল ডাবল-ক্লিক করে (`file://...`) না — কারণ `file://`
   থেকে API কল করলে কাজ করবে না।

---

## ৫. পরবর্তী কাজ (এখনো বাকি) 🔧

এগুলো এখনো **আসল ডেটার সাথে সংযুক্ত না** — এখনো ডেমো/স্ট্যাটিক ডেটা দেখাচ্ছে:

- [x] **UpWall** — সম্পূর্ণ, লাইভ কাজ করছে (উপরে ২নং সেকশন দেখুন)।
- [x] **CPAGrip** — সম্পূর্ণ, লাইভ কাজ করছে (postback + earn.html টাইল
      দুটোই টেস্ট করে কনফার্ম করা হয়েছে, উপরে ২নং সেকশন দেখুন)।
- [ ] অন্য আরও অফারওয়াল প্রোভাইডার (যেমন OfferToro, AdGate) যোগ করার
      দরকার হলে একই প্যাটার্নে (postback.js এর মতো) নতুন ফাইল বানানো যাবে।
- [ ] **রেফারেল সিস্টেম** — `users_referred` ফিল্ড ডেটাবেসে আছে, কিন্তু কেউ
      রেফার করলে সেটা count হওয়ার কোনো লজিক এখনো নেই।
- [ ] **Withdraw সিস্টেম — বাকি কাজ:**
  - Litecoin/Binance address ফরম্যাট এখনো সার্ভার সাইডে যাচাই হয় না (শুধু
    ৪ ক্যারেক্টারের বেশি হলেই গ্রহণ করে) — চাইলে প্রতিটা মেথডের জন্য প্রপার
    address regex validation যোগ করা যেতে পারে।
  - Withdrawal `status` (`pending` → `completed`/`rejected`) এখন হাতে
    আপডেট করা লাগবে (সরাসরি D1 কমান্ড দিয়ে) — কোনো admin প্যানেল বা payout
    automation এখনো নেই।
- [ ] **Email verification** — সাইন আপ করলে এখন `email_verified = 0` থাকে,
      কখনো `1` হয় না। ইমেইল পাঠানোর সার্ভিস (যেমন Resend/SendGrid) যুক্ত করে
      `functions/api/auth/verify-email.js` বানাতে হবে। (এখন `_lib/email.js`
      দিয়ে Resend ইতিমধ্যে যুক্ত আছে Forgot Password-এর জন্য, তাই এই ফিচারে
      একই হেল্পার রিইউজ করা যাবে — নতুন করে Resend সেটাপ লাগবে না।)
- [ ] **Level সিস্টেম** — `level` ফিল্ড আছে কিন্তু কখন/কীভাবে বাড়বে তার লজিক
      এখনো নেই।
- [ ] **প্রোফাইল পেজের "Earnings" ট্যাব** — এখনো শুধু "কিছু নেই" মেসেজ দেখায়।
      Withdrawals ও Pending ট্যাব লাইভ হয়ে গেছে, কিন্তু Earnings ট্যাবের জন্য
      আলাদা একটা endpoint লাগবে (offer সম্পূর্ণ হওয়া, রেফারেল বোনাস ইত্যাদি
      কয়েন-আয়ের ঘটনাগুলোর লগ) — এটা Earn পেজের অফারওয়াল ইন্টিগ্রেশনের সাথেই
      একসাথে করা যেতে পারে।

---

## ৬. কমন সমস্যা ও সমাধান

| সমস্যা | কারণ | সমাধান |
|---|---|---|
| Sign in এ "Something went wrong" | Backend function নেই বা ভুল জায়গায় | `functions/` স্ট্রাকচার ৩নং সেকশনের মতো আছে কিনা চেক করুন |
| Console এ `403 Forbidden` `/api/...` | সাইট `file://` দিয়ে খোলা হয়েছে | Deploy করা `https://earnbangla.pages.dev` লিংকে টেস্ট করুন |
| Sign up কাজ করে কিন্তু ডেটা সেভ থাকে না | D1 binding যোগ করা হয়নি | Cloudflare Dashboard → Settings → Functions → D1 bindings চেক করুন |
| GitHub এ push করলাম কিন্তু সাইটে পরিবর্তন দেখাচ্ছে না | Deploy এখনো শেষ হয়নি, বা browser cache | ১-২ মিনিট অপেক্ষা করুন, তারপর Ctrl+Shift+R দিয়ে হার্ড রিফ্রেশ করুন |
| Leaderboard এ "Your rank" সবসময় "Sign in to see your rank" দেখায়, যদিও সাইন-ইন করা আছে | `leaderboard.js` এর কুকির নাম `auth.js` এর সাথে মিলছে না | ব্রাউজার DevTools → Application → Cookies এ আসল কুকির নাম দেখে `leaderboard.js` এ মিলিয়ে দিন |
| Withdraw ফর্ম সাবমিট করলে "Not signed in" বা "Something went wrong" | `functions/api/withdraw/request.js` ভুল জায়গায় বসানো (যেমন `profile/` বা `auth/` এর ভেতরে ঢুকে গেছে), অথবা `withdrawals` টেবিল D1 তে বসানো হয়নি | `withdraw` ফোল্ডার সরাসরি `api/` এর ভেতরে (auth/profile এর পাশে) আছে কিনা চেক করুন, আর `schema.sql` D1 তে রান করা হয়েছে কিনা যাচাই করুন |
| Withdraw এ balance ঠিকমতো কমছে না বা negative হয়ে যাচ্ছে | `withdrawals` টেবিল ছাড়াই পুরনো `schema.sql` চলছে, বা `request.js` আপডেটেড ভার্শন না | নতুন `schema.sql` + `request.js` ঠিকমতো বসানো হয়েছে কিনা আর D1 তে টেবিল আছে কিনা `SELECT name FROM sqlite_master ...` দিয়ে চেক করুন |
| Forgot Password এ "Could not send the code right now" | `RESEND_API_KEY` env var সেট করা নেই, বা ভুল | Cloudflare Dashboard → Settings → Environment variables এ `RESEND_API_KEY` (Production আর Preview দুই জায়গাতেই) চেক করুন |

---

## ৭. দরকারি কমান্ড

```bash
# ডেটাবেসে টেবিল আছে কিনা চেক করা
wrangler d1 execute earnbangla-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"

# সব ইউজার দেখা (টেস্টের জন্য)
wrangler d1 execute earnbangla-db --remote --command="SELECT id, username, email, created_at FROM users;"

# schema.sql এর নতুন পরিবর্তন (যেমন withdrawals টেবিল) D1 তে বসানো
wrangler d1 execute earnbangla-db --remote --file=./schema.sql

# সব withdraw রিকোয়েস্ট দেখা (টেস্টের জন্য)
wrangler d1 execute earnbangla-db --remote --command="SELECT * FROM withdrawals ORDER BY created_at DESC;"

# অ্যাকটিভ (unused, non-expired) password reset OTP দেখা (টেস্টের জন্য)
wrangler d1 execute earnbangla-db --remote --command="SELECT * FROM password_resets WHERE used = 0 ORDER BY created_at DESC;"

# পরিবর্তন পুশ করা
git add .
git commit -m "বার্তা লিখুন"
git push origin main
```
