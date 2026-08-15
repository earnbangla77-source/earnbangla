-- Run this against earnbangla-db BEFORE using cpagrip-postback.js.
--
-- First check whether offer_completions already has a "provider" column
-- (it might, if your UpWall postback.js was already written to share the
-- table across providers):
--
--   wrangler d1 execute earnbangla-db --remote --command="PRAGMA table_info(offer_completions);"
--
-- If "provider" is NOT in the list, run this:

ALTER TABLE offer_completions ADD COLUMN provider TEXT NOT NULL DEFAULT 'upwall';

CREATE INDEX IF NOT EXISTS idx_offer_completions_provider_user_offer
  ON offer_completions (provider, user_id, offer_id);

-- ⚠️ If your existing offer_completions table uses different column names
-- than user_id / offer_id / payout / coins_earned / created_at (for example
-- if UpWall's version used transaction_id instead of offer_id), tell me the
-- actual column names from your schema.sql / schema-addition.sql and I'll
-- adjust cpagrip-postback.js to match exactly instead of guessing.
