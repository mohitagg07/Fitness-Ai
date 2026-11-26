-- ============================================================
-- VYRN v7 — schema synchronization for recovery, scheduler caches,
-- workout flags, and weekly review caching.
--
-- Run after CRITICAL_RUN_THIS_SQL_FIRST.sql and existing migrations
-- v2-v6. This file is idempotent and does not rewrite user data.
-- ============================================================

begin;

-- The Progress screen records recovery on a 0-100 scale.
alter table public.progress_metrics
    add column if not exists recovery_score numeric(5,2);

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conrelid = 'public.progress_metrics'::regclass
           and conname = 'progress_metrics_recovery_score_range_check'
           and contype = 'c'
    ) then
        alter table public.progress_metrics
            add constraint progress_metrics_recovery_score_range_check
            check (recovery_score is null or recovery_score between 0 and 100);
    end if;
end
$$;

-- Scheduler/agent cache fields. JSON payloads are per-user, not relational
-- records; dates are separate so stale caches can be invalidated cheaply.
alter table public.agent_states
    add column if not exists cached_patterns jsonb,
    add column if not exists cached_patterns_at date,
    add column if not exists cached_morning_brief jsonb,
    add column if not exists cached_morning_brief_at date,
    add column if not exists habit_profile jsonb,
    add column if not exists habit_profile_at date;

-- The API reads this flag to exclude warm-up sets from training volume,
-- personal records, and muscle recovery calculations.
alter table public.exercise_logs
    add column if not exists is_warmup boolean not null default false;

-- Weekly review cache used by /api/review/weekly and the Sunday scheduler.
create table if not exists public.weekly_reviews_cache (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    week_label text not null,
    payload jsonb not null default '{}'::jsonb,
    generated_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (user_id, week_label)
);

alter table public.weekly_reviews_cache enable row level security;

drop policy if exists "Users own their weekly review cache"
    on public.weekly_reviews_cache;
create policy "Users own their weekly review cache"
    on public.weekly_reviews_cache
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create index if not exists idx_weekly_reviews_cache_user_generated
    on public.weekly_reviews_cache (user_id, generated_at desc);

commit;
