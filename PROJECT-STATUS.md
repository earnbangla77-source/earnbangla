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
- [x] Profile পেজ ডিজাইন (`profile.html`)
- [x] D1 ডেটাবেসের schema (`schema.sql`) — `users` আর `sessions` টেবিল
- [x] আসল **backend API** (Cloudflare Pages Functions) — এর আগে এগুলো ছিলই না,
      নতুন বানানো হয়েছে:
  - `functions/api/auth/register.js` — নতুন অ্যাকাউন্ট বানায়
  - `functions/api/auth/login.js` — সাইন ইন করায়
  - `functions/api/auth/logout.js` — সাইন আউট করায়
  - `functions/api/auth/me.js` — বর্তমান লগইন করা ইউজারের তথ্য দেয়
  - `functions/api/profile/update.js` — ইউজারনেম/অ্যাভাটার/প্রাইভেসি আপডেট করে
  - `functions/_lib/auth.js` — পাসওয়ার্ড হ্যাশিং, সেশন কুকি — শেয়ার্ড কোড
- [x] Sign Up / Sign In / Sign Out — আসল D1 ডেটাবেসের সাথে কাজ করছে (টেস্ট করা হয়েছে)
- [x] লগইন করার পর হোমপেজে "Sign up for free" ফর্মটা লুকিয়ে যায়

**মানে এখন সাইটে রিয়েল অ্যাকাউন্ট সিস্টেম কাজ করছে** — কেউ সাইন আপ করলে সেটা
সত্যিকারের D1 ডেটাবেসে সেভ হয়, পাসওয়ার্ড হ্যাশ করা থাকে, সেশন কুকি দিয়ে লগইন
মনে রাখে।

---

## ৩. ফোল্ডার স্ট্রাকচার (এভাবেই থাকতে হবে)

```
incm website/
├── functions/
│   ├── _lib/
│   │   └── auth.js
│   └── api/
│       ├── auth/
│       │   ├── register.js
│       │   ├── login.js
│       │   ├── logout.js
│       │   └── me.js
│       └── profile/
│           └── update.js
├── index.html
├── earn.html
├── profile.html
├── schema.sql
├── wrangler.toml
└── README.md
```

⚠️ **ভুল করলে যা হবে:** `functions/` এর ভেতরের ফাইলগুলো যদি ভুল জায়গায় (যেমন
রুটে সরাসরি) থাকে, তাহলে Cloudflare সেগুলোকে API হিসেবে চিনবে না, সাইন-ইন কাজ
করবে না।

---

## ৪. নতুন কাজ শুরু করার আগে চেক করে নিন

1. Cloudflare Dashboard → Workers & Pages → `earnbangla` প্রজেক্ট → **Settings →
   Functions → D1 database bindings** এ `DB` নামে `earnbangla-db` bind করা আছে
   কিনা (Production আর Preview দুই জায়গাতেই)। এটা ছাড়া API কাজ করবে না।
2. কোনো পরিবর্তন করার পর সবসময়:
   ```
   git add .
   git commit -m "যা পরিবর্তন করলেন তার সংক্ষিপ্ত বর্ণনা"
   git push origin main
   ```
   পুশ করলেই Cloudflare Pages নিজে থেকে নতুন করে deploy করে দেয় (১-২ মিনিট
   সময় লাগে)।
3. সবসময় **deploy করা লিংকে** (`https://earnbangla.pages.dev`) টেস্ট করুন,
   কম্পিউটারে সরাসরি ফাইল ডাবল-ক্লিক করে (`file://...`) না — কারণ `file://`
   থেকে API কল করলে কাজ করবে না।

---

## ৫. পরবর্তী কাজ (এখনো বাকি) 🔧

এগুলো এখনো **আসল ডেটার সাথে সংযুক্ত না** — এখনো ডেমো/স্ট্যাটিক ডেটা দেখাচ্ছে:

- [ ] **Earn পেজ (`earn.html`)** — অফারগুলো (apps/games/surveys) এখনো
      hardcoded। কোনো অফারওয়াল প্রোভাইডার (যেমন OfferToro, AdGate, CPAlead)
      এর API এর সাথে যুক্ত করতে হবে, আর অফার সম্পূর্ণ হলে
      `completed_offers`, `coins`, `total_earning` আপডেট করার একটা নতুন
      `functions/api/offers/complete.js` (বা postback endpoint) বানাতে হবে।
- [ ] **রেফারেল সিস্টেম** — `users_referred` ফিল্ড ডেটাবেসে আছে, কিন্তু কেউ
      রেফার করলে সেটা count হওয়ার কোনো লজিক এখনো নেই।
- [ ] **Withdraw / Cash out** — ইউজার কীভাবে টাকা তুলবে (bKash/Nagad/PayPal
      ইত্যাদি) — এখনো কোনো ফিচার নেই। এর জন্য নতুন টেবিল আর ফাংশন লাগবে।
- [ ] **Email verification** — সাইন আপ করলে এখন `email_verified = 0` থাকে,
      কখনো `1` হয় না। ইমেইল পাঠানোর সার্ভিস (যেমন Resend/SendGrid) যুক্ত করে
      `functions/api/auth/verify-email.js` বানাতে হবে।
- [ ] **পাসওয়ার্ড রিসেট ("Forgot password")** — এখনো নেই।
- [ ] **Level সিস্টেম** — `level` ফিল্ড আছে কিন্তু কখন/কীভাবে বাড়বে তার লজিক
      এখনো নেই।
- [ ] প্রোফাইল পেজের "Activity" ট্যাব (Earnings / Withdrawals / Pending) —
      এখনো শুধু "কিছু নেই" মেসেজ দেখায়, আসল ডেটা লোড করে না।

---

## ৬. কমন সমস্যা ও সমাধান

| সমস্যা | কারণ | সমাধান |
|---|---|---|
| Sign in এ "Something went wrong" | Backend function নেই বা ভুল জায়গায় | `functions/` স্ট্রাকচার ৩নং সেকশনের মতো আছে কিনা চেক করুন |
| Console এ `403 Forbidden` `/api/...` | সাইট `file://` দিয়ে খোলা হয়েছে | Deploy করা `https://earnbangla.pages.dev` লিংকে টেস্ট করুন |
| Sign up কাজ করে কিন্তু ডেটা সেভ থাকে না | D1 binding যোগ করা হয়নি | Cloudflare Dashboard → Settings → Functions → D1 bindings চেক করুন |
| GitHub এ push করলাম কিন্তু সাইটে পরিবর্তন দেখাচ্ছে না | Deploy এখনো শেষ হয়নি, বা browser cache | ১-২ মিনিট অপেক্ষা করুন, তারপর Ctrl+Shift+R দিয়ে হার্ড রিফ্রেশ করুন |

---

## ৭. দরকারি কমান্ড

```bash
# ডেটাবেসে টেবিল আছে কিনা চেক করা
wrangler d1 execute earnbangla-db --remote --command="SELECT name FROM sqlite_master WHERE type='table';"

# সব ইউজার দেখা (টেস্টের জন্য)
wrangler d1 execute earnbangla-db --remote --command="SELECT id, username, email, created_at FROM users;"

# পরিবর্তন পুশ করা
git add .
git commit -m "বার্তা লিখুন"
git push origin main
```
