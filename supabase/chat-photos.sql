-- Chat photo attachments — run this in the Supabase SQL Editor.

-- ============================================================
-- messages: photo columns; body may be empty when a photo is attached
-- ============================================================
alter table public.messages
  add column if not exists image_url text,
  add column if not exists image_width integer,
  add column if not exists image_height integer;

-- Replace the old "body between 1 and 4000" check with:
-- text and/or photo, at least one required, photos only from our bucket.
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
-- Public storage bucket for chat photos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do update set public = true;

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
-- Summaries view: "📷 Photo" preview for image-only messages
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
