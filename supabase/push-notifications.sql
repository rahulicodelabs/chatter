-- Chatter — push notifications ("notify me when the app is closed")
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Prerequisite: app-lock.sql has already run (it adds profiles.passcode_hash).
--
-- What this adds:
--   1. push_subscriptions — one row per browser/device that opted in through
--      the app's "Notifications" toggle (RLS: strictly your own rows).
--   2. A trigger on messages INSERT that, once the insert commits, POSTs a
--      fan-out payload to the app's /api/push route using pg_net.
--
-- Failure safety: pg_net queues the request until COMMIT (nothing is sent
-- mid-transaction) and the entire trigger body sits in an exception handler,
-- so a broken notification pipeline only logs a warning — it can never stop
-- a message from being sent.

-- ============================================================
-- 1. Subscriptions
-- ============================================================
create table if not exists public.push_subscriptions (
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text primary key,   -- the browser's push endpoint (FCM)
  p256dh text not null,        -- per-subscription encryption keys
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can read own subscriptions" on public.push_subscriptions;
create policy "Users can read own subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can insert own subscriptions" on public.push_subscriptions;
create policy "Users can insert own subscriptions"
  on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

-- ON CONFLICT (endpoint) upsert. USING (true) lets a signed-in account claim
-- an endpoint it physically holds — e.g. after switching accounts on the same
-- browser — while WITH CHECK still forces the row to end up owned by them.
-- Endpoints are long random FCM URLs and never readable for other users
-- (select is own-rows only), so this can't be used to steal anyone's row.
drop policy if exists "Users can claim endpoints they hold" on public.push_subscriptions;
create policy "Users can claim endpoints they hold"
  on public.push_subscriptions for update to authenticated
  using (true)
  with check (user_id = auth.uid());

drop policy if exists "Users can delete own subscriptions" on public.push_subscriptions;
create policy "Users can delete own subscriptions"
  on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ============================================================
-- 2. Trigger: message inserted → POST /api/push (async via pg_net)
-- ============================================================
create extension if not exists pg_net with schema "extensions";

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
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'user_id', s.user_id,
        'endpoint', s.endpoint,
        'p256dh', s.p256dh,
        'auth', s.auth,
        'locked', (pr.passcode_hash is not null)
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

drop trigger if exists message_push_notify on public.messages;
create trigger message_push_notify
  after insert on public.messages
  for each row
  execute function public.notify_message_push();

comment on function public.notify_message_push() is
  'After a message commits, POSTs a fan-out payload to /api/push via pg_net. Failures log a warning only.';
