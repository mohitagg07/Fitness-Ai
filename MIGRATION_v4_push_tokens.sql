-- ============================================================
-- VYRN  v4 Migration — Push Notification Delivery
-- Run AFTER CRITICAL_RUN_THIS_SQL_FIRST.sql and MIGRATION_v2.sql
-- ============================================================
--
-- Backstory: services/notifications.py has generated real, data-driven
-- notification payloads (recovery %, protein gap, PR opportunity, CNS
-- deload) and saved them to `notifications` since v2 — but nothing ever
-- pushed them to the device. A user only ever saw them by opening the
-- app and pulling the list. This table stores the Expo push token per
-- device so backend/services/push.py can actually deliver them while
-- the app is closed, which is the whole point of "AI notifies user"
-- instead of "AI waits to be asked."
--
-- One user can have multiple tokens (phone + tablet, or a reinstalled
-- app that got a new token) — hence a token-keyed table rather than a
-- single column on profiles.

create table if not exists public.push_tokens (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    token       text not null,                 -- Expo push token, e.g. "ExponentPushToken[...]"
    platform    text,                          -- "ios" | "android" | "web"
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    unique (token)                             -- a token belongs to exactly one row; re-registering
                                                -- the same token (app reopen) upserts instead of duplicating
);

alter table public.push_tokens enable row level security;

drop policy if exists "Users manage own push tokens" on public.push_tokens;
create policy "Users manage own push tokens" on public.push_tokens
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists idx_push_tokens_user on public.push_tokens(user_id);

-- Done.
