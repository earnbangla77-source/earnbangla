# TASK: earnbangla Admin Panel — বানানোর জন্য পূর্ণাঙ্গ prompt

এই ফাইলটা `PROJECT-STATUS.md`-এর সাথে দিলেই যে কেউ (মানুষ বা AI) পুরো admin panel
বানাতে পারবে — ডিজাইন, পেজ স্ট্রাকচার, backend API, schema পরিবর্তন সব এখানে
আছে। প্রথমে `PROJECT-STATUS.md` পড়ে প্রজেক্টের বর্তমান অবস্থা বুঝে নিন, তারপর
এই ফাইল অনুযায়ী কাজ শুরু করুন।

**লগইন/অথ এই স্কোপে নেই** — এটা পরে আলাদাভাবে করা হবে। এই টাস্কে শুধু panel-টা
বানানো হবে (ধরে নিন admin ইতিমধ্যে ভেতরে ঢুকে গেছে)। কিন্তু deploy করার আগে
নিচের ⚠️ সিকিউরিটি নোটটা অবশ্যই পড়ুন।

---

## ১. স্কোপ — কী বানাতে হবে

একটা নতুন **admin.html** পেজ (single file, profile.html-এর মতোই self-contained
HTML+CSS+JS), যেখানে sidebar drawer দিয়ে কয়েকটা সেকশনের মধ্যে ঘোরা যাবে
(client-side view switching — আলাদা আলাদা html পেজে যেতে হবে না, ঠিক
profile.html-এ authGate/dashboardView যেভাবে টগল হয় সেভাবেই)।

**Sidebar মেনু (ইউজার যা চেয়েছেন + কিছু যুক্তিসঙ্গত সংযোজন):**

| বাটন | দরকার | নোট |
|---|---|---|
| **Dashboard** | ✅ চাওয়া হয়েছে | overview stats |
| **Payments** | ✅ চাওয়া হয়েছে | All/Pending/Approved/Rejected ট্যাব + email সার্চ + edit |
| **Users** | ✅ চাওয়া হয়েছে ("total users") | সব ইউজার লিস্ট + সার্চ + ডিটেইল |
| **Activity Log** | 💡 সংযোজন | `activity_log` টেবিলের কয়েন-আয়ের ইভেন্টগুলো দেখার জন্য (future-ready) |
| **Offers** | 💡 সংযোজন | Earn পেজের অফার ম্যানেজ করার জন্য placeholder — অফারওয়াল যুক্ত হলে কাজে লাগবে |
| **Settings** | 💡 সংযোজন | min withdrawal, coin-to-dollar rate ইত্যাদি সাইট কনফিগ এক জায়গায় |

শেষ তিনটা (Activity Log / Offers / Settings) না বানালেও চলবে — চাইলে শুধু বাটন
রেখে "Coming soon" দেখিয়ে রাখতে পারেন, পরে ভরে দেওয়া যাবে।

---

## ২. ডিজাইন সিস্টেম — profile.html-এর সাথে মিলিয়ে বানাতে হবে

একই color palette, font, sidebar/topbar pattern ব্যবহার করুন যাতে admin panel
বাকি সাইটের সাথে না মেলা একটা আলাদা জিনিস মনে না হয়।

```css
:root{
  --bg:#0A0A0F;
  --bg-elev:#0F0F17;
  --panel:#14141F;
  --panel-2:#191926;
  --border:#232333;
  --orange:#FF7A1A;
  --orange-2:#FF3D1E;
  --violet:#8B5CF6;
  --green:#3AD07A;
  --red:#FF3D1E;          /* rejected status-এর জন্য orange-2 রিইউজ করাই যথেষ্ট */
  --text:#F4F4F8;
  --text-dim:#9A9AAD;
  --text-faint:#67677A;
  --radius:16px;
  --grad-orange:linear-gradient(135deg,var(--orange) 0%,var(--orange-2) 100%);
  --sh-sm:0 4px 14px rgba(0,0,0,0.28);
  --sh-md:0 12px 28px rgba(0,0,0,0.38);
  --sh-lg:0 24px 60px rgba(0,0,0,0.5);
  --sh-orange:0 10px 26px rgba(255,61,30,0.28);
}
```

- Font: Manrope (body) + Sora (headings/display) — Google Fonts, profile.html-এর
  `<link>` ট্যাগগুলো কপি করে নিন।
- Sidebar drawer, topbar, `.btn-primary`/`.btn-outline`, `.tab-btn`,
  `.status-pill` (st-pending/st-completed/st-rejected) — এই সব component
  profile.html-এ যেভাবে বানানো আছে ঠিক সেভাবেই রিইউজ করুন (কপি-পেস্ট করে
  দরকারমতো বাড়ান)। নতুন করে ডিজাইন সিস্টেম ভাবার দরকার নেই।
- Sidebar লোগো/ব্র্যান্ডিং এক থাকবে (`earn` + gradient `bangla`), তবে
  admin panel বোঝানোর জন্য sidebar top-এ ছোট্ট "Admin" ব্যাজ যোগ করতে পারেন।

---

## ৩. Dashboard সেকশন

**Stat cards (উপরে, ৪-৫টা কার্ড — profile.html-এর `.stats-grid` প্যাটার্নে):**

1. **Total Pending Payout ($)**
   `SUM(coins_used) FROM withdrawals WHERE status='pending'` → `/ 1000` করে $
   এ দেখাবে (200 coins = $0.20, মানে **1000 coins = $1** — এই রেট
   `functions/api/withdraw/request.js`-এর `COINS_PER_DOLLAR` কনস্ট্যান্টের
   সাথে মিলিয়ে রাখুন, ভবিষ্যতে রেট বদলালে দুই জায়গাতেই বদলাতে হবে)
2. **Pending Requests (count)** — কয়টা `status='pending'` আছে
3. **Total Users** — `COUNT(*) FROM users`
4. **Total Paid Out ($)** — `SUM(amount_usd) FROM withdrawals WHERE status='completed'`
5. **Today's Top Earner** — ⚠️ নিচের নোট পড়ুন

   > **সততার সাথে বলি:** এটা এখন সরাসরি বানানো যাবে না, কারণ `activity_log`
   > টেবিল আছে কিন্তু **কেউ এখনো এতে কিছু লেখে না** (schema.sql-এর কমেন্ট
   > অনুযায়ী — অফার-কমপ্লিট সিস্টেম বানানো হলে তখন এটা ভরা শুরু হবে)। তাই
   > "আজকের টপ আর্নার" সঠিকভাবে দেখানোর দুইটা অপশন:
   > - **অপশন A (এখনকার মতো):** কার্ডে "Top Earner (All-time)" নাম দিয়ে
   >   `users.total_earning` অনুযায়ী সবচেয়ে বেশি আর্নিং করা ইউজার দেখান —
   >   এটা এখনই কাজ করবে।
   > - **অপশন B (আসল "আজকের" ভার্সন):** যেদিন Earn পেজের অফার-কমপ্লিট সিস্টেম
   >   বানানো হবে (PROJECT-STATUS.md-এর "পরবর্তী কাজ" দেখুন) সেদিন
   >   `activity_log` ভরা শুরু হবে, তখন
   >   `SELECT user_id, SUM(coins_earned) FROM activity_log WHERE created_at >= <today start ms> GROUP BY user_id ORDER BY SUM(coins_earned) DESC LIMIT 1`
   >   দিয়ে আসল "আজকের টপ আর্নার" বানানো যাবে। কার্ডটা এখন থেকেই বানিয়ে
   >   রাখুন কিন্তু ডেটা খালি থাকলে "No activity yet today" ফলব্যাক দেখান।

**Recent activity প্যানেল (কার্ডগুলোর নিচে):**
- সর্বশেষ ৮–১০টা withdrawal request — user email, method, amount, status,
  সময় — সাথে ছোট Approve/Reject বাটন (শুধু pending হলে দেখাবে)। এটা
  মূলত Payments সেকশনের mini-preview, ক্লিক করলে পুরো Payments সেকশনে চলে যাবে।

---

## ৪. Payments সেকশন

**উপরে:**
- ট্যাব: **All / Pending / Approved / Rejected** (profile.html-এর `.tab-btn`
  প্যাটার্নেই — active ট্যাবে gradient background)
- ডানপাশে/উপরে একটা সার্চ ইনপুট — **email দিয়ে সার্চ** (username দিয়েও সার্চ
  করা যেতে দিলে ভালো, খরচ কম)

**টেবিল কলাম:**

| User | Method | Address | Coins | Amount ($) | Status | Requested | Last Updated | Action |
|---|---|---|---|---|---|---|---|---|
| avatar + username + email (দুই লাইনে) | litecoin/binance | shortened address, hover/click করলে ফুল address কপি হবে | কয়েন সংখ্যা | $ | রঙিন pill | তারিখ-সময় | তারিখ-সময় | Approve/Reject বাটন (pending হলে), নাহলে খালি |

- রো-তে ক্লিক করলে (বা "View" বাটনে) একটা **side panel / modal** খুলবে যেখানে
  সেই user-এর পুরো তথ্য দেখাবে: user id, username, email, join date, coins
  balance, level, completed offers, users referred, total earning,
  email verified কিনা, private কিনা — **আর সাথে তার বাকি সব withdrawal
  history-ও** (একই ইউজারের আগের রিকোয়েস্টগুলো)। এটা মূলত Users সেকশনের
  ডিটেইল ভিউ-টাই রিইউজ করা যায় (নিচে দেখুন)।
- Approve/Reject ক্লিক করলে **কনফার্মেশন** ছাড়া সরাসরি স্টেটাস বদলাবে না —
  ছোট একটা "আপনি নিশ্চিত?" কনফার্ম দেখান (এটা টাকা পাঠানোর ব্যাপার, ভুল ক্লিকে
  বদলে গেলে সমস্যা)।

**⚠️ Schema-তে যা যোগ করতে হবে:**

`withdrawals` টেবিলে এখন কোনো `updated_at` কলাম নেই, তাই "Last Updated" আর
"status কবে বদলালো" ট্র্যাক করার কোনো উপায় নেই। `schema.sql`-এ যোগ করুন:

```sql
ALTER TABLE withdrawals ADD COLUMN updated_at INTEGER;
```

(D1/SQLite-এ `ALTER TABLE ADD COLUMN` নিরাপদ — পুরনো রো-গুলোর জন্য `NULL`
থাকবে, নতুন করে স্ট্যাটাস বদলালে ভরে যাবে। `IF NOT EXISTS` প্যাটার্ন মেলাতে
`schema.sql`-এ আলাদা ব্লকে রাখুন, আগের কোনো `CREATE TABLE` স্টেটমেন্টে হাত
দেবেন না — PROJECT-STATUS.md সেকশন ৩/৪-এর নিয়ম মনে রাখুন।)

---

## ৫. Users সেকশন

- উপরে সার্চ ইনপুট (username/email)
- টেবিল কলাম: username, email, coins, level, completed offers, users referred,
  total earning, joined date, email verified (✓/✗ আইকন), private (✓/✗ আইকন)
- রো ক্লিক করলে detail panel — Payments সেকশনের user-detail panel-টাই এখানেও
  রিইউজ করুন (একই কম্পোনেন্ট, দুই জায়গা থেকেই খোলা যাবে)

---

## ৬. নতুন Backend API যা লাগবে

বাকি `functions/api/` স্ট্রাকচারের প্যাটার্ন মিলিয়ে একটা নতুন `admin/` ফোল্ডার,
সরাসরি `api/`-এর ভেতরে (`auth`/`profile`/`withdraw`-এর পাশেই):

```
functions/api/admin/
├── dashboard-stats.js      (GET)  → pending payout $, pending count, total users, total paid out, top earner
├── withdrawals.js          (GET)  → ?status=pending|completed|rejected|all & ?search=<email> — join users দিয়ে email/username আনবে
├── withdrawals-update.js   (POST) → { id, status } নিয়ে status + updated_at বসাবে (validate: status একটা VALID_METHODS-এর মতো fixed list এর মধ্যেই — 'completed'/'rejected' ছাড়া কিছু গ্রহণ করবে না)
└── users.js                (GET)  → ?search=<email বা username> — paginated user list
```

- এখনো auth middleware নেই (এই টাস্কের স্কোপের বাইরে), কিন্তু কোড লেখার সময়
  প্রতিটা endpoint-এর শুরুতে একটা `// TODO: admin-only auth check here` কমেন্ট
  রেখে দিন, যাতে পরে auth যোগ করার সময় ভুলে না যান।
- `withdrawals.js`-এর SQL-এ `JOIN users ON withdrawals.user_id = users.id`
  করে email/username একসাথে আনবেন — আলাদা কোয়েরি করে N+1 বানাবেন না।
- `functions/_lib/auth.js`-এর existing helper (`json`, `errorJson`, `newId`)
  গুলোই এখানেও রিইউজ করুন, নতুন করে বানানোর দরকার নেই।

---

## ৭. ফাইল প্ল্যান

```
incm website/
├── admin.html                       ← নতুন
├── functions/
│   └── api/
│       └── admin/                   ← নতুন ফোল্ডার
│           ├── dashboard-stats.js
│           ├── withdrawals.js
│           ├── withdrawals-update.js
│           └── users.js
```

একটাই `admin.html` — sidebar-এ ক্লিক করলে ভেতরে ভেতরে view বদলাবে
(Dashboard/Payments/Users div শো/হাইড হবে, ঠিক profile.html-এর
`authGate`/`dashboardView` টগলের মতো)। আলাদা আলাদা `.html` ফাইল বানানোর দরকার
নেই — একটা এন্ট্রি পয়েন্ট থাকলে পরে auth gate বসানোও সহজ হবে (একজায়গায়
বসালেই পুরো panel প্রোটেক্ট হয়ে যাবে)।

---

## ৮. ⚠️ সিকিউরিটি নোট (ভুলে যাবেন না)

`admin.html` আর `functions/api/admin/*` — এই সব ফাইল **এখন কোনো auth ছাড়াই
পাবলিক URL-এ থাকবে**। মানে `https://earnbangla.pages.dev/admin.html` লিংকটা
যে কেউ জানলেই সব ইউজারের ডেটা, withdrawal address, আর approve/reject বাটন
পর্যন্ত অ্যাক্সেস করতে পারবে। এটা শুধুই dev/preview করার জন্য ঠিক আছে —
**লগইন/অথ যোগ না করে এটা প্রোডাকশনে থাকতে দেবেন না।** লগইন সিস্টেম বসানোর সময়
`admin.html` লোড হওয়ার শুরুতেই (এখন profile.html-এর `checkSession()` যেভাবে
`/api/auth/me` চেক করে) admin session ভেরিফাই করে নিন, আর প্রতিটা
`functions/api/admin/*.js`-এও একই চেক বসান।

---

## ৯. দ্রুত চেকলিস্ট (বানানো শেষে)

- [ ] `admin.html` — sidebar-এ Dashboard/Payments/Users (+ চাইলে Activity Log/Offers/Settings placeholder)
- [ ] Dashboard কার্ড: Pending Payout $, Pending Count, Total Users, Total Paid Out, Top Earner
- [ ] Payments: All/Pending/Approved/Rejected ট্যাব + email সার্চ + approve/reject (কনফার্ম সহ) + user detail panel
- [ ] Users: লিস্ট + সার্চ + detail panel (Payments-এর সাথে শেয়ার্ড কম্পোনেন্ট)
- [ ] `schema.sql`-এ `withdrawals.updated_at` কলাম যোগ + D1-তে রান করা
- [ ] `functions/api/admin/` এর ৪টা ফাইল, প্রতিটাতে admin-auth TODO কমেন্ট
- [ ] ডিজাইন profile.html-এর সাথে মিলছে (color/font/component সব একই)
- [ ] deploy করার আগে auth ছাড়া লাইভ থাকার রিস্ক মাথায় রাখা (সেকশন ৮)
