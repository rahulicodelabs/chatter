-- Video attachments — run this in the Supabase SQL Editor.
--
-- Videos reuse messages.image_url (type detected from the file extension),
-- so uploads already work without any schema change. This patch only makes
-- the sidebar preview show "🎬 Video" instead of "📷 Photo" for
-- video-only messages.

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
