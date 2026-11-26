-- ============================================================
-- VYRN v9 — supported coach styles
-- Run after the base schema and migrations v2-v8.
-- Adds style values already supported by the motivation engine and
-- coach prompt. No profile rows are rewritten.
-- ============================================================

begin;

alter table public.profiles
    drop constraint if exists profiles_coach_style_check;

alter table public.profiles
    add constraint profiles_coach_style_check
    check (
        coach_style is null
        or coach_style in ('friendly', 'supportive', 'scientific', 'strict', 'military')
    );

commit;
