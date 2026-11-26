-- ============================================================
-- VYRN v6 — application roles and admin authorization
-- Run in Supabase SQL Editor after CRITICAL_RUN_THIS_SQL_FIRST.sql.
--
-- Existing accounts remain ordinary users. This migration does not
-- promote any account and is safe to re-run.
-- ============================================================

begin;

alter table public.profiles
    add column if not exists app_role text not null default 'user';

-- Defensive repair for an installations where app_role was added manually
-- as nullable before this migration was applied.
update public.profiles
   set app_role = 'user'
 where app_role is null;

alter table public.profiles
    alter column app_role set default 'user',
    alter column app_role set not null;

do $$
begin
    if not exists (
        select 1
          from pg_constraint
         where conrelid = 'public.profiles'::regclass
           and conname = 'profiles_app_role_check'
           and contype = 'c'
    ) then
        alter table public.profiles
            add constraint profiles_app_role_check
            check (app_role in ('user', 'admin'));
    end if;
end
$$;

create index if not exists idx_profiles_admin_role
    on public.profiles (app_role)
    where app_role = 'admin';

comment on column public.profiles.app_role is
    'Server-managed application authorization role. Only user/admin are valid. Never accept this field from client profile updates.';

commit;

-- ============================================================
-- OPTIONAL: explicitly promote one verified administrator.
-- Replace the email below with the exact email of the account that
-- should have access to POST /api/admin/run-jobs-now.
-- Review the affected row before running this statement.
--
-- update public.profiles p
--    set app_role = 'admin',
--        updated_at = now()
--   from auth.users u
--  where u.id = p.id
--    and lower(u.email) = lower('YOUR_ADMIN_EMAIL@example.com');
--
-- Verify:
-- select u.email, p.app_role
--   from public.profiles p
--   join auth.users u on u.id = p.id
--  where p.app_role = 'admin';
-- ============================================================
