# earnbangla — Offerwall Postback সেটআপ করার সময় যেসব সমস্যা হয়েছিল (ও সমাধান)

এই ফাইলটা রাখা হচ্ছে যাতে ভবিষ্যতে নতুন কোনো offerwall provider (CPAGrip-এর
মতো postback-based) যোগ করার সময় একই সমস্যায় পড়লে দ্রুত সমাধান করা যায়।

---

## সমস্যা ১: PowerShell-এ `curl` আসলে `curl` না

**লক্ষণ:** `curl -X POST ... \` লিখলে PowerShell এ
`CommandNotFoundException` আসে, `-d "..."` কে আলাদা কমান্ড ভাবে।

**কারণ:**
- PowerShell-এ `\` দিয়ে লাইন continuation কাজ করে না (এটা bash/Linux/Mac-এর
  নিয়ম) — ব্যাকটিক `` ` `` লাগে, অথবা পুরো কমান্ড এক লাইনে লিখতে হয়।
- PowerShell-এ `curl` আসলে `Invoke-WebRequest`-এর একটা alias — এটা
  `-d`/`--data-urlencode` ঠিকমতো সাপোর্ট করে না।

**সমাধান:**
- সবসময় `curl.exe` লিখতে হবে (শুধু `curl` না) — আসল curl প্রোগ্রাম চালাতে।
- পুরো কমান্ড এক লাইনে লিখতে হবে, `\` ব্যবহার করা যাবে না।

```powershell
curl.exe -X POST https://earnbangla.pages.dev/api/offers/<endpoint> --data-urlencode "password=..." --data-urlencode "payout=0.50" --data-urlencode "offer_id=..." --data-urlencode "tracking_id=..."
```

---

## সমস্যা ২: Password-এ special character (`$`, `&`, `#` ইত্যাদি) থাকলে shell এ ভুল যায়

**লক্ষণ:** সঠিক password দেওয়ার পরও `{"error":"Access Denied."}` আসে।

**কারণ:** PowerShell-এ ডাবল কোট (`"..."`) এর ভেতরে `$` special
character — PowerShell সেটাকে variable substitution ভেবে বদলে ফেলে।
`&`, `#` ইত্যাদিও shell-এ special meaning রাখতে পারে।

**সমাধান (২টা অপশন):**
1. সিঙ্গেল কোট (`'...'`) ব্যবহার করুন — PowerShell এর ভেতরে কিছুই বদলায় না।
   ```powershell
   --data-urlencode 'password=SA@#$@$#DC^%&$^$65r1724ac%^!4'
   ```
2. **সবচেয়ে নিরাপদ:** password-এ কোনো special character না রেখে শুধু
   অক্ষর+সংখ্যার সহজ password ব্যবহার করুন (যেমন `13242556`) — copy-paste
   আর shell-escaping দুই জায়গাতেই ভুল হওয়ার ঝুঁকি কমে যায়।

---

## সমস্যা ৩: Cloudflare Dashboard-এ env var-এর নাম ভুল বসানো

**লক্ষণ:** password ঠিক থাকা সত্ত্বেও `Access Denied`।

**কারণ:** Cloudflare Pages → Settings → Variables and secrets-এ যে নামে
variable বানানো হয়েছিল সেটা কোডে যেটা খোঁজে (`env.OFFERWALL_POSTBACK_PASSWORD`)
তার সাথে **হুবহু মিলছিল না** (যেমন `OFFERWALL_POSTBACK` বনাম
`OFFERWALL_POSTBACK_PASSWORD`)।

**সমাধান:** কোডে ঠিক যে নামে `env.XXX` ব্যবহার করা হয়েছে, Cloudflare-এও
ঠিক সেই নামেই variable বানাতে হবে — বানানসহ একদম হুবহু মিলতে হবে।

---

## সমস্যা ৪ (আসল কারণ): Dashboard UI দিয়ে env var এডিট করলে পুরনো deployment-এ কার্যকর হয় না

**লক্ষণ:** Cloudflare Dashboard-এ গিয়ে password ঠিকভাবে বসিয়ে Save করার
পরও, এমনকি নতুন করে variable delete করে আবার বানানোর পরও — বারবার
`Access Denied` আসছিল। `wrangler pages secret list` দিয়ে চেক করলে
variable-টা তালিকায় ঠিকই ছিল।

**আসল কারণ:** Cloudflare Pages-এ একটা secret/env var একটা **নির্দিষ্ট
deployment-এর সাথে bind হয়ে যায়**। Dashboard UI দিয়ে ভ্যালু আপডেট করলে
সেটা নতুন deployment-এ প্রযোজ্য হয়, কিন্তু **যেই deployment তখন লাইভ ছিল
সেটা পুরনো (bind হওয়া) ভ্যালু নিয়েই চলছিল** — নতুন ভ্যালু কার্যকর হতে একটা
আলাদা fresh deploy লাগে।

**সমাধান:**
1. `wrangler pages secret put <NAME> --project-name=<project>` দিয়ে
   secret সেট করা — dashboard UI-এর চেয়ে বেশি নির্ভরযোগ্য (production +
   `--env preview` দুই জায়গাতেই আলাদা করে চালাতে হবে)।
2. এরপরও যদি পুরনো deployment-ই লাইভ থাকে, **জোর করে নতুন deploy
   ট্রিগার করতে হবে**:
   ```powershell
   git commit --allow-empty -m "trigger redeploy"
   git push origin main
   ```
3. Cloudflare Dashboard → Deployments ট্যাবে গিয়ে নতুন deployment
   **"Success"** (✓) হয়েছে কিনা কনফার্ম করার পরই টেস্ট করা উচিত —
   push করার সাথে সাথেই না, কারণ deploy হতে ১-২ মিনিট সময় লাগে।

---

## দ্রুত ডিবাগ করার সবচেয়ে ভালো উপায়: Live log tail

Guess করার বদলে সরাসরি log দেখে ফেলা সবচেয়ে দ্রুত সমাধান দেয়:

```powershell
wrangler pages deployment tail --project-name=earnbangla
```

এই কমান্ড একটা terminal-এ চালিয়ে খোলা রাখুন, তারপর **অন্য একটা** terminal-এ
curl কমান্ড চালান — প্রথম terminal-এ সাথে সাথে `console.error`/`console.log`
মেসেজ দেখা যাবে (যেমন `cpagrip-postback: bad password`), যেটা নিশ্চিতভাবে
বলে দেবে সমস্যাটা ঠিক কোথায়।

---

## পরের বার নতুন offerwall provider (postback-based) যোগ করার চেকলিস্ট

1. `functions/api/offers/<provider>-postback.js` লিখুন এবং কোডে ব্যবহৃত
   env var-এর নাম নোট করে রাখুন।
2. `wrangler pages secret put <ENV_VAR_NAME> --project-name=earnbangla`
   দিয়ে Production-এ সেট করুন।
3. `wrangler pages secret put <ENV_VAR_NAME> --project-name=earnbangla --env preview`
   দিয়ে Preview-তেও সেট করুন।
4. `git add . && git commit -m "..." && git push origin main` করুন।
5. Cloudflare Dashboard → Deployments-এ গিয়ে নতুন deploy "Success" হওয়া
   পর্যন্ত অপেক্ষা করুন।
6. `wrangler pages deployment tail --project-name=earnbangla` চালু রেখে
   অন্য terminal-এ `curl.exe` দিয়ে (সিঙ্গেল কোট ব্যবহার করে, বা সহজ
   password দিয়ে) টেস্ট করুন।
7. Duplicate-guard যাচাই করুন — একই `offer_id` দুইবার পাঠিয়ে দেখুন coins
   দ্বিতীয়বার না বাড়ে।
8. Provider-এর নিজের dashboard-এ Postback URL + password বসিয়ে **Enabled
   টগল অন** আছে কিনা কনফার্ম করুন।
9. সব ঠিক থাকলে `PROJECT-STATUS.md` আপডেট করুন।
