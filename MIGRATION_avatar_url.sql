-- ============================================================
-- VYRN — Add profile photo support
-- Run in Supabase SQL editor (Project Settings → SQL Editor)
-- ============================================================

-- 1. Add the column the backend now writes to (POST /api/profile/avatar)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Create the storage bucket avatars are uploaded to.
--    You must ALSO do this manually once, since bucket creation isn't
--    fully scriptable in every Supabase plan:
--      Dashboard → Storage → New Bucket
--        name: avatars
--        Public bucket: ON
--
--    If you'd rather do it via SQL, this works on most projects:
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- 3. Allow authenticated users to upload/update only their own folder
--    (paths are written as "{user_id}/{uuid}.ext" by the backend).
create policy "Users upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatars are publicly readable"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

-- Note: the backend uploads using the SERVICE ROLE key, which bypasses
-- RLS entirely — so the app will work even before you add these policies.
-- They matter if you ever let users upload directly from the client.
