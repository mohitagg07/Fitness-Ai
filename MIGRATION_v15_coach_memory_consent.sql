-- VYRN v15 — durable, explicit consent for automatic Coach memory.
-- Apply after MIGRATION_v14_complete_training_journey.sql and before deploying
-- the backend/mobile build that exposes /api/memory/settings.
-- New and existing users default to OFF. No existing saved facts are deleted.

begin;

alter table public.profiles
    add column if not exists coach_auto_memory_enabled boolean not null default false;

comment on column public.profiles.coach_auto_memory_enabled is
    'Explicit athlete consent for extracting durable facts from Coach conversations. Defaults off.';

commit;
