-- ============================================================
-- VYRN v11 — protect server-managed profile application roles.
--
-- IMPORTANT: the base profiles RLS policy permits users to update their
-- own profile row. RLS alone therefore does NOT prevent a user from
-- changing their own app_role through the Supabase Data API.
--
-- This trigger permits role changes only for:
--   - the backend service_role JWT (used by the trusted API server), or
--   - database owners running a deliberate promotion in the SQL Editor.
--
-- Run after MIGRATION_v6_security_roles.sql and before exposing the new
-- admin endpoint publicly. Idempotent; does not modify existing roles.
-- ============================================================

begin;

create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
set search_path = public, auth
as $$
declare
    jwt_role text;
begin
    jwt_role := coalesce(auth.role(), '');

    -- The trusted backend service key may manage roles. Database owners
    -- may also promote an account deliberately in the Supabase SQL Editor.
    if jwt_role = 'service_role'
       or current_user in ('postgres', 'supabase_admin') then
        return new;
    end if;

    if tg_op = 'INSERT' then
        if coalesce(new.app_role, 'user') <> 'user' then
            raise exception 'app_role is server-managed'
                using errcode = '42501';
        end if;
    elsif tg_op = 'UPDATE' then
        if new.app_role is distinct from old.app_role then
            raise exception 'app_role is server-managed'
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists protect_profile_app_role on public.profiles;

create trigger protect_profile_app_role
before insert or update on public.profiles
for each row
execute function public.prevent_profile_role_escalation();

comment on function public.prevent_profile_role_escalation() is
    'Prevents authenticated profile owners from setting app_role. Only trusted service_role requests or database owners can manage admin promotion.';

commit;

-- Verify that the trigger is present:
-- select trigger_name, event_manipulation
--   from information_schema.triggers
--  where event_object_schema = 'public'
--    and event_object_table = 'profiles'
--    and trigger_name = 'protect_profile_app_role';
