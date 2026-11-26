-- VYRN migration v3: workout set metadata
-- Run this in the Supabase SQL Editor for the vyrn-fitness project.
-- The API writes these fields on every set insert; without these columns,
-- PostgREST rejects the insert and the mobile app rolls back its optimistic row.

begin;

alter table public.exercise_logs
  add column if not exists is_warmup boolean not null default false,
  add column if not exists is_dropset boolean not null default false,
  add column if not exists superset_group text,
  add column if not exists tempo text,
  add column if not exists to_failure boolean not null default false,
  add column if not exists set_notes text;

commit;
