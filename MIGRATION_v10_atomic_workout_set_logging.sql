-- ============================================================
-- VYRN v10 — transaction-safe set-number allocation.
-- Run after CRITICAL_RUN_THIS_SQL_FIRST.sql and migrations v2-v9.
-- The API's service-role RPC serializes inserts by session/exercise.
-- No existing workout rows are modified.
-- ============================================================

begin;

create or replace function public.log_workout_set(
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
    v_set_number integer;
    v_exercise_name text;
begin
    if p_session_id is null or p_user_id is null then
        raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
    end if;

    v_exercise_name := btrim(coalesce(p_exercise_name, ''));
    if v_exercise_name = '' then
        raise exception 'Exercise name is required' using errcode = '22023';
    end if;

    if p_set is null or jsonb_typeof(p_set) is distinct from 'object' then
        raise exception 'Set payload must be a JSON object' using errcode = '22023';
    end if;

    -- Re-check ownership inside the same transaction as the insert. The API
    -- deliberately uses a backend service-role client, so RLS is not relied
    -- upon for this authorization boundary.
    if not exists (
        select 1
          from public.workout_sessions s
         where s.id = p_session_id
           and s.user_id = p_user_id
    ) then
        raise exception 'SESSION_NOT_FOUND' using errcode = 'P0002';
    end if;

    -- Concurrent requests for the same session and exact exercise name are
    -- serialized. Different exercises and sessions do not block each other.
    perform pg_advisory_xact_lock(
        hashtextextended(
            p_session_id::text || ':' || lower(v_exercise_name),
            0
        )
    );

    select coalesce(max(l.set_number), 0) + 1
      into v_set_number
      from public.exercise_logs l
     where l.session_id = p_session_id
       and l.user_id = p_user_id
       and lower(l.exercise_name) = lower(v_exercise_name);

    return query
    insert into public.exercise_logs (
        session_id,
        user_id,
        exercise_name,
        set_number,
        weight_kg,
        reps,
        rpe,
        equipment_modifiers,
        notes,
        is_warmup,
        is_dropset,
        superset_group,
        tempo,
        to_failure,
        set_notes
    )
    values (
        p_session_id,
        p_user_id,
        v_exercise_name,
        v_set_number,
        (p_set->>'weight_kg')::double precision,
        (p_set->>'reps')::integer,
        nullif(p_set->>'rpe', '')::double precision,
        array(
            select jsonb_array_elements_text(
                case
                    when jsonb_typeof(p_set->'equipment_modifiers') = 'array'
                    then p_set->'equipment_modifiers'
                    else '[]'::jsonb
                end
            )
        ),
        p_set->>'notes',
        coalesce((p_set->>'is_warmup')::boolean, false),
        coalesce((p_set->>'is_dropset')::boolean, false),
        p_set->>'superset_group',
        p_set->>'tempo',
        coalesce((p_set->>'to_failure')::boolean, false),
        p_set->>'set_notes'
    )
    returning *;
end;
$$;

revoke all on function public.log_workout_set(uuid, uuid, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.log_workout_set(uuid, uuid, text, jsonb)
    to service_role;

comment on function public.log_workout_set(uuid, uuid, text, jsonb) is
    'Atomically verifies workout session ownership, allocates the next exercise set_number under a transaction advisory lock, and inserts the set. Intended for backend service-role calls only.';

commit;
