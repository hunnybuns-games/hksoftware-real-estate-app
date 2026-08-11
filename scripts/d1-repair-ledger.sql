-- One-off repair: tell Wrangler about two migrations that were applied by hand.
--
-- WHY THIS EXISTS
--
-- The production schema was once rebuilt by pasting migration SQL into the D1
-- console. That creates the tables but writes nothing to `d1_migrations`, the
-- ledger Wrangler uses to decide what still needs running. The result is a
-- database whose schema is correct but whose bookkeeping claims nothing has ever
-- been applied — so `wrangler d1 migrations apply` starts from the first
-- migration, hits `CREATE TABLE "Organization"` on a table that already exists,
-- and stops without applying anything newer.
--
-- WHY IT'S SAFE TO CLAIM THESE TWO ARE APPLIED
--
-- Verified rather than assumed. The live schema was exported with
-- `wrangler d1 export --no-data` (the `schema` action in .github/workflows/d1.yml)
-- and diffed against a database built by running the migrations from scratch. The
-- only differences were the objects belonging to the *third* migration —
-- PasswordResetToken and its two indexes. Every table and all 40 indexes from
-- these two migrations were present and identical, which is what makes recording
-- them as applied a statement of fact rather than a guess.
--
-- INSERT OR IGNORE, because `name` is UNIQUE: running this twice is a no-op, and
-- it cannot disturb a ledger that is already correct.
--
-- Do not extend this file to cover future migrations. The correct way to record a
-- migration as applied is to let Wrangler apply it.

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('20260807134658_init.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('20260809011514_plaid_bank_connection.sql');
