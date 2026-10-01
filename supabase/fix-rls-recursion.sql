-- Fix: "infinite recursion detected in policy for relation conversation_members"
--
-- Policies on conversation_members used to query conversation_members directly,
-- which re-evaluates the same policy forever. SECURITY DEFINER helper functions
-- read the table as its owner (RLS bypassed), breaking the cycle.
--
-- Run this in the Supabase SQL Editor if you already ran schema.sql.

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

-- conversations ------------------------------------------------
drop policy if exists "Members can view their conversations" on public.conversations;
create policy "Members can view their conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_member(id));

drop policy if exists "Members can update conversations" on public.conversations;
create policy "Members can update conversations"
  on public.conversations for update to authenticated
  using (public.is_conversation_member(id))
  with check (public.is_conversation_member(id));

-- conversation_members ----------------------------------------
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

-- messages -----------------------------------------------------
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

-- Cleanup: remove conversations that failed mid-creation (created but with
-- zero members). Real conversations always have at least one member.
delete from public.conversations
where id not in (select conversation_id from public.conversation_members);
