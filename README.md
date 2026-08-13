# earnbangla — Sign In / Sign Up with Cloudflare D1

This package is a static site (`index.html`, `profile.html`) plus Cloudflare
**Pages Functions** (`/functions`) that talk to a **D1** database for real
sign up / sign in / sessions / profile data. Nothing is hardcoded or fake —
once deployed, accounts are real rows in your D1 database.

## Files

```
index.html                     ← homepage, has the Sign In / Sign Up popup
profile.html                   ← profile page, gated behind sign-in
schema.sql                     ← D1 table definitions
wrangler.toml                  ← Pages + D1 binding config
functions/api/auth/register.js
functions/api/auth/login.js
functions/api/auth/logout.js
functions/api/auth/me.js
functions/api/profile/update.js
functions/_lib/auth.js         ← shared helpers (hashing, sessions, cookies)
```

## 1. Create the D1 database

```bash
npm install -g wrangler        # if you don't have it yet
wrangler login

wrangler d1 create earnbangla-db
```

Copy the `database_id` it prints into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "earnbangla-db"
database_id = "PASTE_THE_ID_HERE"
```

## 2. Apply the schema

```bash
wrangler d1 execute earnbangla-db --remote --file=./schema.sql
```

(Use `--local` first if you want to test with `wrangler pages dev` locally.)

## 3. Deploy to Cloudflare Pages

**Option A — CLI:**
```bash
wrangler pages deploy . --project-name=earnbangla
```

**Option B — Git:** push this folder to a GitHub repo, then in the
Cloudflare dashboard: Workers & Pages → Create → Pages → connect the repo.
Build command: none. Build output directory: `/`.

After the first deploy, go to your Pages project →
**Settings → Functions → D1 database bindings** → add binding
`DB` → `earnbangla-db` (needed for both Production and Preview environments).
Redeploy once the binding is added.

## 4. Test it

Visit `https://your-project.pages.dev/`:
- Click **Sign Up** in the top bar → creates a real user in D1, signs you in,
  sets an HttpOnly session cookie.
- Go to `/profile.html` → your real username, email, avatar, level and stats
  load from `/api/auth/me`.
- Edit your username/avatar on the profile page → saved via
  `/api/profile/update`.
- **Sign Out** clears the session both client- and server-side.

## How auth works

- Passwords are hashed with PBKDF2-SHA256 (100k iterations) + a random salt
  per user — the plaintext password is never stored.
- On sign in/up, a random session id is created in the `sessions` table and
  set as an `HttpOnly; Secure; SameSite=Lax` cookie, so JavaScript can't read
  it and it isn't sent cross-site.
- Every page checks `/api/auth/me` on load to decide whether to show the
  dashboard or the sign-in form — this is real server-side session
  validation, not a client-side "logged in" flag that can be spoofed.

## Extending it

- `completed_offers`, `users_referred`, `total_earning`, `earnings_30d`,
  `coins` all live on the `users` row — update them from your offerwall /
  referral / withdrawal logic the same way `functions/api/profile/update.js`
  updates `username`/`avatar`/`is_private`.
- Add `functions/api/auth/verify-email.js` + an email step if you want the
  "email verified" flag to become real (it currently defaults to
  unverified for every new signup, which is what drives the red alert icon
  next to the email on the profile page).
