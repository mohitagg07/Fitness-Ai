-- VYRN v13a — dated athlete recovery check-ins.
-- Apply after MIGRATION_v12_atomic_program_versions.sql and before deploying
-- the API/mobile build that reads /api/recovery/check-in/today.
-- Additive and idempotent; existing profiles and workouts are unchanged.

begin;

create table if not exists public.recovery_checkins (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    local_date date not null,
    sleep_hours double precision check (sleep_hours is null or sleep_hours between 0 and 24),
    soreness_level integer check (soreness_level is null or soreness_level between 1 and 5),
    energy_level integer check (energy_level is null or energy_level between 1 and 5),
    notes text check (notes is null or char_length(notes) <= 500),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, local_date),
    check (
        sleep_hours is not null or soreness_level is not null
        or energy_level is not null or nullif(btrim(notes), '') is not null
    )
);

create index if not exists idx_recovery_checkins_user_date
    on public.recovery_checkins(user_id, local_date desc);
alter table public.recovery_checkins enable row level security;

drop policy if exists "Users own recovery check-ins" on public.recovery_checkins;
create policy "Users own recovery check-ins"
    on public.recovery_checkins
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

comment on table public.recovery_checkins is
    'Dated, user-reported sleep, soreness, energy and notes. Profile sleep preferences are not daily recovery observations.';

commit;
