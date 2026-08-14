-- earnbangla D1 schema
-- Apply with: wrangler d1 execute earnbangla-db --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT 'avc1',
  level INTEGER NOT NULL DEFAULT 1,
  is_private INTEGER NOT NULL DEFAULT 0,
  email_verified INTEGER NOT NULL DEFAULT 0,
  completed_offers INTEGER NOT NULL DEFAULT 0,
  users_referred INTEGER NOT NULL DEFAULT 0,
  total_earning REAL NOT NULL DEFAULT 0,
  earnings_30d REAL NOT NULL DEFAULT 0,
  coins INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Recent "user earned coins" events, used to drive the live activity ticker
-- on the homepage. Nothing writes to this table yet — it will start
-- filling in once the offer-complete system is built.
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coins_earned INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at);

-- Withdrawal requests placed from withdraw.html. One row per request.
-- method: 'litecoin' | 'binance'
-- status: 'pending' | 'completed' | 'rejected'  (starts 'pending', updated manually / by a future payout job)
CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  address TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  coins_used INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_created_at ON withdrawals(created_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- ============================================================
-- Admin panel (TASK-admin-panel.md) — added later, run separately
-- ============================================================
-- Tracks when a withdrawal's status last changed (needed for the Payments
-- "Last Updated" column). Unlike the CREATE TABLE statements above, SQLite's
-- ALTER TABLE ADD COLUMN has no "IF NOT EXISTS" — running this a second time
-- on a database that already has the column will error with
-- "duplicate column name". Run it ONCE against earnbangla-db, not as part
-- of routinely re-running the whole schema.sql file.
--
-- wrangler d1 execute earnbangla-db --remote --command="ALTER TABLE withdrawals ADD COLUMN updated_at INTEGER;"
--
-- ALTER TABLE withdrawals ADD COLUMN updated_at INTEGER;
