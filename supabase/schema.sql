-- Chatter — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- ============================================================
-- Profiles (public info about each auth user)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Auto-create a profile whenever a new auth user is registered.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_username text;
  final_username text;
begin
  base_username := coalesce(
    nullif(new.raw_user_meta_data ->> 'username', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );
  final_username := base_username;
  if exists (select 1 from public.profiles p where p.username = final_username) then
    final_username := base_username || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  insert into public.profiles (id, username, full_name)
  values (new.id, final_username, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Conversations (direct messages and group chats)
-- ============================================================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'dm' check (type in ('dm', 'group')),
  title text,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_id_idx
  on public.conversation_members (user_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null default '',
  image_url text,
  image_width integer,
  image_height integer,
  created_at timestamptz not null default now(),
  constraint messages_body_length_check check (char_length(body) <= 4000),
  -- A message is text, a photo, or a photo with a caption.
  constraint messages_body_or_photo_check check (char_length(body) > 0 or image_url is not null),
  constraint messages_image_url_host_check check (
    image_url is null
    or image_url ~ '^https://[^/]+/storage/v1/object/public/attachments/'
  )
);

create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at desc);

-- Photo-attachment columns/constraints for databases created before this feature.
alter table public.messages
  add column if not exists image_url text,
  add column if not exists image_width integer,
  add column if not exists image_height integer;
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages drop constraint if exists messages_body_length_check;
alter table public.messages drop constraint if exists messages_body_or_photo_check;
alter table public.messages drop constraint if exists messages_image_url_host_check;
alter table public.messages add constraint messages_body_length_check
  check (char_length(body) <= 4000);
alter table public.messages add constraint messages_body_or_photo_check
  check (char_length(body) > 0 or image_url is not null);
alter table public.messages add constraint messages_image_url_host_check
  check (
    image_url is null
    or image_url ~ '^https://[^/]+/storage/v1/object/public/attachments/'
  );

-- ============================================================
-- Row Level Security
-- ============================================================
-- Helper functions: policies on a table must not query that same table
-- (it re-evaluates its own policy → infinite recursion). SECURITY DEFINER
-- reads the tables as the owner, breaking the cycle.
create or replace function public.is_conversation_member(conv uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = conv
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_conversation_creator(conv uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations
    where id = conv
      and created_by = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
revoke all on function public.is_conversation_creator(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;
grant execute on function public.is_conversation_creator(uuid) to authenticated;

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

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Profiles ---------------------------------------------------
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Conversations ----------------------------------------------
drop policy if exists "Members can view their conversations" on public.conversations;
create policy "Members can view their conversations"
  on public.conversations for select to authenticated
  using (
    public.is_conversation_creator(id)
    or public.is_conversation_member(id)
  );

drop policy if exists "Users can create conversations" on public.conversations;
create policy "Users can create conversations"
  on public.conversations for insert to authenticated
  with check (auth.uid() = created_by);

drop policy if exists "Creators can delete their conversations" on public.conversations;
create policy "Creators can delete their conversations"
  on public.conversations for delete to authenticated
  using (public.is_conversation_creator(id));

drop policy if exists "Members can update conversations" on public.conversations;
create policy "Members can update conversations"
  on public.conversations for update to authenticated
  using (public.is_conversation_member(id))
  with check (public.is_conversation_member(id));

-- Conversation members ---------------------------------------
-- NOTE: deliberately no "insert yourself freely" clause — otherwise
-- anyone could join any conversation they guessed the id of.
drop policy if exists "Members can view conversation membership" on public.conversation_members;
create policy "Members can view conversation membership"
  on public.conversation_members for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_conversation_member(conversation_id)
  );

drop policy if exists "Creators and members can add members" on public.conversation_members;
create policy "Creators and members can add members"
  on public.conversation_members for insert to authenticated
  with check (
    public.is_conversation_creator(conversation_id)
    or public.is_conversation_member(conversation_id)
  );

drop policy if exists "Users can update own membership" on public.conversation_members;
create policy "Users can update own membership"
  on public.conversation_members for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Users can leave conversations" on public.conversation_members;
create policy "Users can leave conversations"
  on public.conversation_members for delete to authenticated
  using (user_id = auth.uid());

-- Messages ----------------------------------------------------
drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists "Senders can delete own messages" on public.messages;
create policy "Senders can delete own messages"
  on public.messages for delete to authenticated
  using (sender_id = auth.uid());

-- ============================================================
-- Conversation summaries view (last message + unread count)
-- security_invoker keeps RLS of the underlying tables in effect.
-- ============================================================
create or replace view public.conversation_summaries
with (security_invoker = true) as
select
  c.id,
  c.type,
  c.title,
  c.created_at,
  cm.user_id,
  cm.last_read_at,
  case
    when lm.body is null then null
    when lm.body <> '' then lm.body
    when lm.image_url ~* '\.(mp4|webm|mov|m4v|ogv|avi|mkv)([?#].*)?$'
      then '🎬 Video'
    else '📷 Photo'
  end as last_message,
  lm.created_at as last_message_at,
  lm.sender_id as last_message_sender_id,
  coalesce(lm.created_at, c.created_at) as last_activity,
  (
    select count(*)
    from public.messages m
    where m.conversation_id = c.id
      and m.created_at > cm.last_read_at
      and m.sender_id <> cm.user_id
  ) as unread_count
from public.conversations c
join public.conversation_members cm on cm.conversation_id = c.id
left join lateral (
  select m.body, m.image_url, m.created_at, m.sender_id
  from public.messages m
  where m.conversation_id = c.id
  order by m.created_at desc
  limit 1
) lm on true;

-- ============================================================
-- Storage: avatars + chat photos (public buckets, per-user folders)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
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

drop policy if exists "Chat photos are publicly readable" on storage.objects;
create policy "Chat photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'attachments');

drop policy if exists "Users can upload chat photos" on storage.objects;
create policy "Users can upload chat photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- Realtime (postgres changes are RLS-filtered per subscriber)
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.message_deliveries;
exception
  when duplicate_object then null;
end $$;
