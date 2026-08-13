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
