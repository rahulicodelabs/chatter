-- Chatter — app-icon badge support for push notifications.
-- Run this ONLY if you already ran push-notifications.sql before the badge
-- feature existed (it just re-creates the trigger function; nothing else
-- changes and no data is touched). Fresh setups: push-notifications.sql
-- already contains this.
--
-- What's new: every recipient in the fan-out payload now carries `unread`,
-- their total unread message count (same predicate as
-- conversation_summaries.unread_count — computed AFTER INSERT, so it
-- includes the message being sent). sw.js passes it to the Badging API to
-- put a dot/number on the installed app's icon while the app is closed.
-- If this step is skipped, everything else keeps working — badges simply
-- stay absent until it runs.

create or replace function public.notify_message_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender text;
  v_conv_type text;
  v_conv_title text;
  v_preview text;
  v_recipients jsonb;
begin
  -- Everything risky lives in ONE exception block: any failure (missing
  -- column, network trouble, malformed data) logs a warning and lets the
  -- message insert proceed normally.
  begin
    select coalesce(nullif(p.full_name, ''), p.username)
      into v_sender
    from public.profiles p
    where p.id = new.sender_id;

    select c.type, c.title
      into v_conv_type, v_conv_title
    from public.conversations c
    where c.id = new.conversation_id;

    -- Same preview wording as conversation_summaries.last_message.
    v_preview := case
      when char_length(new.body) > 0 then left(new.body, 140)
      when new.image_url ~* '\.(mp4|webm|mov|m4v|ogv|avi|mkv)([?#].*)?$' then '🎬 Video'
      else '📷 Photo'
    end;

    -- Every opted-in device of every member except the sender. `locked` is
    -- computed per recipient: accounts with app lock on get notifications
    -- that show only WHO sent it — the content stays behind the PIN.
    -- `unread` is that user's total unread messages (same predicate as
    -- conversation_summaries.unread_count) and drives the app-icon badge.
    -- This runs AFTER INSERT, so the count already includes this message.
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'user_id', s.user_id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth,
        'locked', (pr.passcode_hash is not null),
        'unread', (
          select count(*)
          from public.messages m
          join public.conversation_members cmm
            on cmm.conversation_id = m.conversation_id
           and cmm.user_id = s.user_id
          where m.created_at > cmm.last_read_at
            and m.sender_id <> s.user_id
        )
      )),
      '[]'::jsonb
    )
      into v_recipients
    from public.push_subscriptions s
    join public.conversation_members cm
      on cm.user_id = s.user_id
     and cm.conversation_id = new.conversation_id
    join public.profiles pr
      on pr.id = s.user_id
    where cm.user_id <> new.sender_id;

    if v_recipients is null or v_recipients = '[]'::jsonb then
      return new;
    end if;

    perform net.http_post(
      url := 'https://chatter-orpin-ten.vercel.app/api/push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-chatter-push-secret', 'd1b9180f9cf8148bd6edf1ea295a02eec32369cd1edd194f9753cc64580ea3b8'
      ),
      body := jsonb_build_object(
        'conversation_id', new.conversation_id,
        'conversation_type', v_conv_type,
        'conversation_title', v_conv_title,
        'sender_id', new.sender_id,
        'sender_name', coalesce(v_sender, 'Someone'),
        'preview', v_preview,
        'image_url', new.image_url,
        'recipients', v_recipients
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'push notify failed: %', sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.notify_message_push() is
  'After a message commits, POSTs a fan-out payload (incl. per-recipient unread counts for the icon badge) to /api/push via pg_net. Failures log a warning only.';
