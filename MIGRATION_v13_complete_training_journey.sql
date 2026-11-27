-- VYRN v13 — durable, versioned training journey.
-- Apply after CRITICAL_RUN_THIS_SQL_FIRST.sql and migrations v2-v12.
-- Additive and idempotent: existing plans, sessions and set logs are retained.

begin;

-- Dated daily recovery check-ins. Sleep values are actual athlete reports,
-- distinct from the static onboarding sleep baseline.
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
    check (sleep_hours is not null or soreness_level is not null or energy_level is not null or notes is not null)
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

create table if not exists public.workout_plan_versions (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.workout_plans(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    version_number integer not null check (version_number > 0),
    status text not null default 'draft'
        check (status in ('draft', 'approved', 'superseded', 'rejected')),
    snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
    change_reason text,
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (plan_id, version_number)
);

create index if not exists idx_workout_plan_versions_user
    on public.workout_plan_versions(user_id, plan_id, version_number desc);

alter table public.workout_plans
    add column if not exists current_version_id uuid;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'workout_plans_current_version_fk'
          and conrelid = 'public.workout_plans'::regclass
    ) then
        alter table public.workout_plans
            add constraint workout_plans_current_version_fk
            foreign key (current_version_id)
            references public.workout_plan_versions(id)
            on delete set null;
    end if;
end $$;

alter table public.workout_sessions
    add column if not exists completion_result jsonb,
    add column if not exists plan_version_id uuid,
    add column if not exists planned_workout_snapshot jsonb,
    add column if not exists status text not null default 'active',
    add column if not exists started_at timestamptz,
    add column if not exists paused_at timestamptz,
    add column if not exists paused_duration_seconds integer not null default 0,
    add column if not exists finished_at timestamptz,
    add column if not exists session_effort integer,
    add column if not exists energy_level integer,
    add column if not exists pain_status text,
    add column if not exists pain_notes text;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'workout_sessions_plan_version_fk'
          and conrelid = 'public.workout_sessions'::regclass
    ) then
        alter table public.workout_sessions
            add constraint workout_sessions_plan_version_fk
            foreign key (plan_version_id)
            references public.workout_plan_versions(id)
            on delete set null;
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'workout_sessions_status_check'
          and conrelid = 'public.workout_sessions'::regclass
    ) then
        alter table public.workout_sessions
            add constraint workout_sessions_status_check
            check (status in ('draft', 'approved', 'active', 'paused', 'completed', 'skipped', 'abandoned'));
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'workout_sessions_effort_check'
          and conrelid = 'public.workout_sessions'::regclass
    ) then
        alter table public.workout_sessions
            add constraint workout_sessions_effort_check
            check (session_effort is null or session_effort between 1 and 10);
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'workout_sessions_energy_check'
          and conrelid = 'public.workout_sessions'::regclass
    ) then
        alter table public.workout_sessions
            add constraint workout_sessions_energy_check
            check (energy_level is null or energy_level between 1 and 5);
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'workout_sessions_pain_status_check'
          and conrelid = 'public.workout_sessions'::regclass
    ) then
        alter table public.workout_sessions
            add constraint workout_sessions_pain_status_check
            check (pain_status is null or pain_status in ('none', 'mild', 'sharp', 'worsening'));
    end if;
end $$;

update public.workout_sessions
   set status = case when completed = true then 'completed' else 'active' end,
       started_at = coalesce(started_at, created_at),
       finished_at = case when completed = true then coalesce(finished_at, created_at) else finished_at end
 where started_at is null
    or (completed = true and status <> 'completed');

create table if not exists public.workout_session_exercise_events (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.workout_sessions(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    action text not null check (action in ('skip', 'replace')),
    exercise_name text not null check (char_length(btrim(exercise_name)) between 1 and 120),
    replacement_exercise text check (replacement_exercise is null or char_length(replacement_exercise) <= 120),
    reason text check (reason is null or char_length(reason) <= 300),
    created_at timestamptz not null default now(),
    check ((action = 'skip' and replacement_exercise is null) or (action = 'replace' and replacement_exercise is not null))
);

create index if not exists idx_workout_exercise_events_session
    on public.workout_session_exercise_events(session_id, created_at);

alter table public.workout_session_exercise_events enable row level security;
drop policy if exists "Users own workout exercise events" on public.workout_session_exercise_events;
create policy "Users own workout exercise events"
    on public.workout_session_exercise_events
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

alter table public.workout_sessions
    add column if not exists client_request_id text;
create unique index if not exists idx_workout_sessions_idempotency
    on public.workout_sessions(user_id, client_request_id)
    where client_request_id is not null;

alter table public.exercise_logs
    add column if not exists client_request_id text;

create unique index if not exists idx_exercise_logs_idempotency
    on public.exercise_logs(session_id, user_id, client_request_id)
    where client_request_id is not null;

alter table public.workout_plan_versions enable row level security;
drop policy if exists "Users own workout plan versions" on public.workout_plan_versions;
create policy "Users own workout plan versions"
    on public.workout_plan_versions
    for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create or replace function public.save_workout_plan_draft(
    p_user_id uuid,
    p_plan_id uuid,
    p_name text,
    p_phase text,
    p_weeks integer,
    p_schedule jsonb,
    p_snapshot jsonb,
    p_change_reason text
)
returns table (
    out_plan_id uuid,
    out_version_id uuid,
    out_version_number integer,
    out_status text,
    out_snapshot jsonb
)
language plpgsql
security definer
set search_path = public
as $
declare
    v_plan public.workout_plans;
    v_version public.workout_plan_versions;
    v_schedule jsonb;
    v_snapshot jsonb;
    v_next integer;
begin
    if p_user_id is null or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object' then
        raise exception 'A user and valid plan snapshot are required' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('workout-plan:' || p_user_id::text, 0));

    if p_plan_id is not null then
        select * into v_plan
          from public.workout_plans
         where id = p_plan_id and user_id = p_user_id
         for update;
        if not found then
            raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
        end if;
    else
        select * into v_plan
          from public.workout_plans
         where user_id = p_user_id and is_active = true
         order by created_at desc
         limit 1
         for update;
        if not found then
            insert into public.workout_plans(user_id, name, phase, weeks, schedule, is_active)
            values (p_user_id, coalesce(nullif(btrim(p_name), ''), 'VYRN Training Plan'),
                    p_phase, coalesce(p_weeks, 4), coalesce(p_schedule, '{}'::jsonb), false)
            returning * into v_plan;
        end if;
    end if;

    v_schedule := case
        when jsonb_typeof(p_schedule) = 'object' and p_schedule <> '{}'::jsonb then p_schedule
        else coalesce(v_plan.schedule, '{}'::jsonb)
    end;
    v_snapshot := p_snapshot || jsonb_build_object(
        'schedule', v_schedule,
        'name', coalesce(nullif(btrim(p_name), ''), v_plan.name),
        'phase', coalesce(p_phase, v_plan.phase),
        'weeks', coalesce(p_weeks, v_plan.weeks, 4)
    );

    select coalesce(max(version_number), 0) + 1
      into v_next
      from public.workout_plan_versions
     where plan_id = v_plan.id and user_id = p_user_id;

    insert into public.workout_plan_versions(
        plan_id, user_id, version_number, status, snapshot, change_reason
    ) values (
        v_plan.id, p_user_id, v_next, 'draft', v_snapshot,
        coalesce(nullif(btrim(p_change_reason), ''), 'New workout plan draft')
    ) returning * into v_version;

    return query select v_plan.id, v_version.id, v_version.version_number,
                        v_version.status, v_version.snapshot;
end;
$;

revoke all on function public.save_workout_plan_draft(uuid, uuid, text, text, integer, jsonb, jsonb, text)
    from public, anon, authenticated;
grant execute on function public.save_workout_plan_draft(uuid, uuid, text, text, integer, jsonb, jsonb, text)
    to service_role;

create or replace function public.approve_workout_plan_version(
    p_user_id uuid,
    p_plan_id uuid,
    p_version_id uuid
)
returns setof public.workout_plan_versions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_version public.workout_plan_versions;
begin
    if p_user_id is null or p_plan_id is null or p_version_id is null then
        raise exception 'Plan approval identifiers are required' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('workout-plan:' || p_user_id::text, 0));

    perform 1
      from public.workout_plans
     where id = p_plan_id and user_id = p_user_id
     for update;
    if not found then
        raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
    end if;

    select *
      into v_version
      from public.workout_plan_versions
     where id = p_version_id
       and plan_id = p_plan_id
       and user_id = p_user_id
     for update;
    if not found then
        raise exception 'PLAN_VERSION_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_version.status not in ('draft', 'approved') then
        raise exception 'PLAN_VERSION_NOT_APPROVABLE' using errcode = '22023';
    end if;

    update public.workout_plan_versions
       set status = 'superseded', updated_at = now()
     where plan_id = p_plan_id
       and user_id = p_user_id
       and status = 'approved'
       and id <> p_version_id;

    update public.workout_plan_versions
       set status = 'approved',
           approved_at = coalesce(approved_at, now()),
           updated_at = now()
     where id = p_version_id
       and user_id = p_user_id
     returning * into v_version;

    update public.workout_plans
       set is_active = (id = p_plan_id),
           current_version_id = case when id = p_plan_id then p_version_id else current_version_id end,
           name = case when id = p_plan_id then coalesce(v_version.snapshot->>'name', name) else name end,
           phase = case when id = p_plan_id then coalesce(v_version.snapshot->>'phase', phase) else phase end,
           weeks = case when id = p_plan_id then coalesce(nullif(v_version.snapshot->>'weeks', '')::integer, weeks) else weeks end,
           schedule = case when id = p_plan_id then coalesce(v_version.snapshot->'schedule', schedule) else schedule end
     where user_id = p_user_id;

    return next v_version;
end;
$$;

revoke all on function public.approve_workout_plan_version(uuid, uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.approve_workout_plan_version(uuid, uuid, uuid)
    to service_role;

create or replace function public.rollback_workout_plan_version(
    p_user_id uuid,
    p_plan_id uuid,
    p_source_version_id uuid,
    p_reason text default 'User requested rollback'
)
returns setof public.workout_plan_versions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_source public.workout_plan_versions;
    v_saved public.workout_plan_versions;
    v_next integer;
begin
    perform pg_advisory_xact_lock(hashtextextended('workout-plan:' || p_user_id::text, 0));

    perform 1
      from public.workout_plans
     where id = p_plan_id and user_id = p_user_id
     for update;
    if not found then
        raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
    end if;

    select * into v_source
      from public.workout_plan_versions
     where id = p_source_version_id
       and plan_id = p_plan_id
       and user_id = p_user_id
     for update;
    if not found then
        raise exception 'PLAN_VERSION_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_source.status not in ('approved', 'superseded') then
        raise exception 'PLAN_VERSION_NOT_ROLLBACKABLE' using errcode = '22023';
    end if;

    select coalesce(max(version_number), 0) + 1
      into v_next
      from public.workout_plan_versions
     where plan_id = p_plan_id;

    update public.workout_plan_versions
       set status = 'superseded', updated_at = now()
     where plan_id = p_plan_id and user_id = p_user_id and status = 'approved';

    insert into public.workout_plan_versions (
        plan_id, user_id, version_number, status, snapshot, change_reason, approved_at
    ) values (
        p_plan_id, p_user_id, v_next, 'approved', v_source.snapshot,
        coalesce(nullif(btrim(p_reason), ''), 'User requested rollback'), now()
    ) returning * into v_saved;

    update public.workout_plans
       set current_version_id = v_saved.id,
           is_active = true,
           name = coalesce(v_saved.snapshot->>'name', name),
           phase = coalesce(v_saved.snapshot->>'phase', phase),
           weeks = coalesce(nullif(v_saved.snapshot->>'weeks', '')::integer, weeks),
           schedule = coalesce(v_saved.snapshot->'schedule', schedule)
     where id = p_plan_id and user_id = p_user_id;

    update public.workout_plans
       set is_active = false
     where user_id = p_user_id and id <> p_plan_id;

    return next v_saved;
end;
$$;

revoke all on function public.rollback_workout_plan_version(uuid, uuid, uuid, text)
    from public, anon, authenticated;
grant execute on function public.rollback_workout_plan_version(uuid, uuid, uuid, text)
    to service_role;

create or replace function public.transition_workout_session(
    p_user_id uuid,
    p_session_id uuid,
    p_action text
)
returns setof public.workout_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.workout_sessions;
    v_now timestamptz := now();
begin
    select * into v_session
      from public.workout_sessions
     where id = p_session_id and user_id = p_user_id
     for update;
    if not found then
        raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
    end if;

    if p_action = 'pause' and v_session.status = 'active' then
        update public.workout_sessions
           set status = 'paused', paused_at = v_now
         where id = p_session_id and user_id = p_user_id
         returning * into v_session;
    elsif p_action = 'resume' and v_session.status = 'paused' then
        update public.workout_sessions
           set status = 'active',
               paused_duration_seconds = paused_duration_seconds +
                   greatest(0, floor(extract(epoch from (v_now - coalesce(paused_at, v_now))))::integer),
               paused_at = null
         where id = p_session_id and user_id = p_user_id
         returning * into v_session;
    elsif p_action = 'abandon' and v_session.status in ('active', 'paused') then
        update public.workout_sessions
           set status = 'abandoned',
               finished_at = v_now,
               paused_duration_seconds = paused_duration_seconds +
                   case when status = 'paused' and paused_at is not null
                        then greatest(0, floor(extract(epoch from (v_now - paused_at)))::integer)
                        else 0 end,
               paused_at = null
         where id = p_session_id and user_id = p_user_id
         returning * into v_session;
    else
        raise exception 'INVALID_SESSION_TRANSITION' using errcode = '22023';
    end if;

    return next v_session;
end;
$$;

revoke all on function public.transition_workout_session(uuid, uuid, text)
    from public, anon, authenticated;
grant execute on function public.transition_workout_session(uuid, uuid, text)
    to service_role;

create or replace function public.create_workout_session_idempotent(
    p_user_id uuid,
    p_client_request_id text,
    p_session_date date default null,
    p_plan_version_id uuid default null,
    p_day_label text default null,
    p_workout_type text default null,
    p_muscle_groups text[] default '{}'::text[]
)
returns setof public.workout_sessions
language plpgsql
security definer
set search_path = public
as $
declare
    v_existing public.workout_sessions;
    v_version public.workout_plan_versions;
    v_workout jsonb := '{}'::jsonb;
    v_saved public.workout_sessions;
    v_plan_id uuid := null;
    v_day_label text;
    v_workout_type text;
    v_muscle_groups text[];
begin
    if p_user_id is null or nullif(btrim(coalesce(p_client_request_id, '')), '') is null then
        raise exception 'SESSION_IDEMPOTENCY_KEY_REQUIRED' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended('workout-session:' || p_user_id::text || ':' || p_client_request_id, 0)
    );

    select * into v_existing
      from public.workout_sessions
     where user_id = p_user_id
       and client_request_id = p_client_request_id
     limit 1;
    if found then
        return next v_existing;
        return;
    end if;

    if p_plan_version_id is not null then
        select * into v_version
          from public.workout_plan_versions
         where id = p_plan_version_id
           and user_id = p_user_id
           and status = 'approved'
         for share;
        if not found then
            raise exception 'PLAN_VERSION_NOT_APPROVED' using errcode = '22023';
        end if;
        v_plan_id := v_version.plan_id;
        v_workout := coalesce(v_version.snapshot->'workout', '{}'::jsonb);
    end if;

    v_day_label := coalesce(nullif(v_workout->>'label', ''), nullif(btrim(p_day_label), ''), 'Training Session');
    v_workout_type := coalesce(nullif(v_workout->>'workout_type', ''), nullif(btrim(p_workout_type), ''));
    v_muscle_groups := case
        when jsonb_typeof(v_workout->'muscle_groups') = 'array' then
            array(select jsonb_array_elements_text(v_workout->'muscle_groups'))
        else coalesce(p_muscle_groups, '{}'::text[])
    end;

    insert into public.workout_sessions (
        user_id, plan_id, plan_version_id, planned_workout_snapshot,
        session_date, day_label, workout_type, muscle_groups, status,
        started_at, client_request_id
    ) values (
        p_user_id, v_plan_id, p_plan_version_id,
        nullif(v_workout, '{}'::jsonb),
        coalesce(p_session_date, current_date),
        v_day_label, v_workout_type, v_muscle_groups, 'active',
        now(), p_client_request_id
    )
    returning * into v_saved;

    return next v_saved;
end;
$;

revoke all on function public.create_workout_session_idempotent(uuid, text, date, uuid, text, text, text[])
    from public, anon, authenticated;
grant execute on function public.create_workout_session_idempotent(uuid, text, date, uuid, text, text, text[])
    to service_role;

create or replace function public.log_workout_set_idempotent(
    p_session_id uuid,
    p_user_id uuid,
    p_exercise_name text,
    p_set jsonb
)
returns setof public.exercise_logs
language plpgsql
security definer
set search_path = public
as $$
declare
    v_request_id text;
    v_existing public.exercise_logs;
    v_saved public.exercise_logs;
    v_session_status text;
begin
    v_request_id := nullif(btrim(coalesce(p_set->>'client_request_id', '')), '');

    if v_request_id is not null then
        perform pg_advisory_xact_lock(
            hashtextextended(p_session_id::text || ':' || v_request_id, 0)
        );

        select * into v_existing
          from public.exercise_logs
         where session_id = p_session_id
           and user_id = p_user_id
           and client_request_id = v_request_id
         limit 1;
        if found then
            return next v_existing;
            return;
        end if;
    end if;

    select status into v_session_status
      from public.workout_sessions
     where id = p_session_id and user_id = p_user_id
     for update;
    if not found then
        raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
    end if;
    if v_session_status <> 'active' then
        raise exception 'SESSION_NOT_ACTIVE' using errcode = '22023';
    end if;

    select * into v_saved
      from public.log_workout_set(
        p_session_id,
        p_user_id,
        p_exercise_name,
        coalesce(p_set, '{}'::jsonb) - 'client_request_id'
      )
     limit 1;

    if v_request_id is not null then
        update public.exercise_logs
           set client_request_id = v_request_id
         where id = v_saved.id
         returning * into v_saved;
    end if;

    return next v_saved;
end;
$$;

revoke all on function public.log_workout_set_idempotent(uuid, uuid, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.log_workout_set_idempotent(uuid, uuid, text, jsonb)
    to service_role;

commit;
