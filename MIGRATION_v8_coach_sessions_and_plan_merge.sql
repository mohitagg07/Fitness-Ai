-- ============================================================
-- VYRN v8 — coach session metadata and safe workout-plan merging.
-- Run after the base schema and migrations v2-v7.
-- Idempotent. No existing conversation or workout plan data is deleted.
-- ============================================================

begin;

-- Persist structured coach output so restored conversations can reconstruct
-- the same rich response card rather than degrading to plain text.
alter table public.ai_conversations
    add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Merge one weekday recommendation into the current active plan. A
-- transaction-scoped advisory lock serializes coach plan updates per user.
-- All existing weekday entries are preserved. If legacy data contains
-- multiple active rows, the newest is retained and duplicates are deactivated.
create or replace function public.merge_coach_workout_day(
    p_user_id uuid,
    p_day_key text,
    p_workout_type text
)
returns setof public.workout_plans
language plpgsql
security definer
set search_path = public
as $$
declare
    v_plan public.workout_plans;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required';
    end if;

    if p_day_key is null
       or p_day_key not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
        raise exception 'Invalid weekday key: %', p_day_key;
    end if;

    if p_workout_type is null or p_workout_type not in (
        'push', 'pull', 'legs', 'upper', 'lower', 'full_body', 'cardio', 'rest'
    ) then
        raise exception 'Invalid workout type: %', p_workout_type;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

    select *
      into v_plan
      from public.workout_plans
     where user_id = p_user_id
       and is_active = true
     order by created_at desc
     limit 1
     for update;

    if found then
        update public.workout_plans
           set schedule = (
               case
                   when jsonb_typeof(schedule) = 'object' then schedule
                   else '{}'::jsonb
               end
           ) || jsonb_build_object(p_day_key, p_workout_type)
         where id = v_plan.id
           and user_id = p_user_id
         returning * into v_plan;
    else
        insert into public.workout_plans (
            user_id,
            name,
            is_active,
            schedule
        )
        values (
            p_user_id,
            initcap(replace(p_workout_type, '_', ' ')) || ' — Coach Generated',
            true,
            jsonb_build_object(p_day_key, p_workout_type)
        )
        returning * into v_plan;
    end if;

    -- Older versions of the app may have left more than one active plan.
    -- Keep the selected (newest) plan active and deactivate the duplicates.
    update public.workout_plans
       set is_active = false
     where user_id = p_user_id
       and is_active = true
       and id <> v_plan.id;

    return next v_plan;
end;
$$;

revoke all on function public.merge_coach_workout_day(uuid, text, text)
    from public, anon, authenticated;
grant execute on function public.merge_coach_workout_day(uuid, text, text)
    to service_role;

comment on function public.merge_coach_workout_day(uuid, text, text) is
    'Atomically merges a coach-generated workout into one weekday of the latest active user plan. Preserves the rest of the weekly schedule.';

commit;
