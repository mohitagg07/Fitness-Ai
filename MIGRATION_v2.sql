-- ============================================================
-- VYRN  v2 Migration — run AFTER CRITICAL_RUN_THIS_SQL_FIRST.sql
-- ============================================================

-- 1. training_strategies  — persists every Adaptive Strategy Engine decision
-- ============================================================
create table if not exists training_strategies (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  decided_at   date not null default current_date,
  block        text not null,   -- "hypertrophy" | "strength" | "deload" | "peak" | "cut" | "maintenance"
  block_label  text not null,
  rationale    text,            -- LLM-generated one-sentence explanation
  predicted_outcome text,
  confidence   text,            -- "Low" | "Medium" | "High"
  recovery_pct int,
  cns_label    text,
  goal         text,
  created_at   timestamptz not null default now()
);

alter table training_strategies enable row level security;

-- CREATE POLICY has no IF NOT EXISTS in any Postgres version, unlike
-- CREATE TABLE/INDEX elsewhere in this file — so re-running this script
-- without the DROP first fails with "ERROR: 42710: policy ... already
-- exists" on the second run. DROP POLICY IF EXISTS is genuinely
-- idempotent (it only issues a notice, never an error, when the policy
-- isn't there yet), so the pair below makes this script safe to run
-- as many times as needed.
drop policy if exists "Users read own strategies" on training_strategies;
create policy "Users read own strategies"
  on training_strategies for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own strategies" on training_strategies;
create policy "Users insert own strategies"
  on training_strategies for insert
  with check (auth.uid() = user_id);

create index if not exists training_strategies_user_date
  on training_strategies (user_id, decided_at desc);


-- 2. notifications — add cta column (deep-link route for tap action)
-- ============================================================
-- The notifications table itself is now created in
-- CRITICAL_RUN_THIS_SQL_FIRST.sql (schema additions v2.2) — it was
-- previously missing entirely, which made the ALTER TABLE below fail
-- with "ERROR: 42P01: relation 'notifications' does not exist" no
-- matter what order these files ran in, since ALTER TABLE cannot
-- create the table it's altering. Run (or re-run)
-- CRITICAL_RUN_THIS_SQL_FIRST.sql first if you haven't already, then
-- this ALTER TABLE is now a true no-op safety net: the cta column is
-- already part of the table definition above, so IF NOT EXISTS will
-- simply skip it.
alter table notifications
  add column if not exists cta text;           -- e.g. "/workout", "/nutrition", "/recovery"


-- 3. Confirm new notification types are allowed
--    (existing check constraint may need updating)
-- If you have a check constraint on notifications.type, add these:
--   cns_very_high, motivation
-- Most installs have no constraint — safe to skip if so.
-- ============================================================

-- Done.
