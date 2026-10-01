-- v2 features: read receipts + avatar uploads
-- Run this in the Supabase SQL Editor.

-- ============================================================
-- Read receipts: one row per (message, recipient)
-- ============================================================
create table if not exists public.message_deliveries (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);

create index if not exists message_deliveries_message_id_idx
  on public.message_deliveries (message_id);

alter table public.message_deliveries enable row level security;

-- Anyone in the conversation can see receipts (the sender needs them
-- to render ticks; group members could show "seen by" counts).
drop policy if exists "Members can read receipts" on public.message_deliveries;
create policy "Members can read receipts"
  on public.message_deliveries for select to authenticated
  using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

-- You may only record delivery/read for yourself.
drop policy if exists "Users can record own receipts" on public.message_deliveries;
create policy "Users can record own receipts"
  on public.message_deliveries for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id
        and public.is_conversation_member(m.conversation_id)
    )
  );

drop policy if exists "Users can update own receipts" on public.message_deliveries;
create policy "Users can update own receipts"
  on public.message_deliveries for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Live tick updates on the sender's screen.
do $$
begin
  alter publication supabase_realtime add table public.message_deliveries;
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- Avatars: public storage bucket + per-user folders
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
