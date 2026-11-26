-- ============================================================
-- VYRN v12 — atomic, idempotent program-version writes.
--
-- Repeated scheduler / monthly-review / coach calls can detect the same
-- unresolved pattern. This RPC prevents identical rewrites for the same
-- plan from creating duplicate version rows within a seven-day window.
-- Version allocation and insertion are serialized in one transaction.
--
-- Run after CRITICAL_RUN_THIS_SQL_FIRST.sql and migrations v2-v11.
-- Existing program_versions rows are preserved.
-- ============================================================

begin;

create or replace function public.save_program_version_idempotent(
    p_user_id uuid,
    p_trigger text,
    p_changes jsonb,
    p_explanation text,
    p_plan_id uuid default null
)
returns table (
    version_id uuid,
    version_number integer,
    changes jsonb,
    explanation text,
    already_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_existing public.program_versions;
    v_saved public.program_versions;
    v_next_version integer;
begin
    if p_user_id is null then
        raise exception 'p_user_id is required' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_trigger, '')), '') is null then
        raise exception 'p_trigger is required' using errcode = '22023';
    end if;
    if p_changes is null or jsonb_typeof(p_changes) is distinct from 'array' then
        raise exception 'p_changes must be a JSON array' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p_explanation, '')), '') is null then
        raise exception 'p_explanation is required' using errcode = '22023';
    end if;

    -- One writer per athlete at a time. This prevents two worker/API calls
    -- from both observing the same max(version_number) and inserting the
    -- same next value.
    perform pg_advisory_xact_lock(
        hashtextextended('program_versions:' || p_user_id::text, 0)
    );

    -- Reuse an identical rewrite for the same active plan for seven days.
    -- The time window allows a genuinely recurring pattern to be addressed
    -- again later rather than suppressing it forever.
    select pv.*
      into v_existing
      from public.program_versions pv
     where pv.user_id = p_user_id
       and pv.plan_id is not distinct from p_plan_id
       and pv.trigger = p_trigger
       and pv.changes = p_changes
       and pv.created_at >= current_date - 7
     order by pv.version_number desc
     limit 1
     for update;

    if found then
        return query
        select
            v_existing.id,
            v_existing.version_number,
            v_existing.changes,
            v_existing.explanation,
            true;
        return;
    end if;

    select coalesce(max(pv.version_number), 0) + 1
      into v_next_version
      from public.program_versions pv
     where pv.user_id = p_user_id;

    insert into public.program_versions (
        user_id,
        plan_id,
        version_number,
        trigger,
        changes,
        explanation,
        created_at
    )
    values (
        p_user_id,
        p_plan_id,
        v_next_version,
        p_trigger,
        p_changes,
        p_explanation,
        current_date
    )
    returning * into v_saved;

    return query
    select
        v_saved.id,
        v_saved.version_number,
        v_saved.changes,
        v_saved.explanation,
        false;
end;
$$;

revoke all on function public.save_program_version_idempotent(uuid, text, jsonb, text, uuid)
    from public, anon, authenticated;
grant execute on function public.save_program_version_idempotent(uuid, text, jsonb, text, uuid)
    to service_role;

comment on function public.save_program_version_idempotent(uuid, text, jsonb, text, uuid) is
    'Atomically writes a program version, serializes version numbers per user, and reuses identical same-plan rewrites created within the previous seven days. Service-role only.';

commit;
