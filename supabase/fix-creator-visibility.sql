-- Fix: creator could not read back a conversation they had just created.
--
-- The app inserts a conversation and immediately reads it back
-- (.select().single()) to get its id. The SELECT policy required membership,
-- but no members exist at that moment — not even the creator — so the
-- read-back failed with "new row violates row-level security policy".
--
-- Run this in the Supabase SQL Editor.

drop policy if exists "Members can view their conversations" on public.conversations;
create policy "Members can view their conversations"
  on public.conversations for select to authenticated
  using (
    public.is_conversation_creator(id)
    or public.is_conversation_member(id)
  );

-- The app also deletes a conversation if adding its members fails halfway;
-- only the creator may delete (this also removes empty leftovers).
drop policy if exists "Creators can delete their conversations" on public.conversations;
create policy "Creators can delete their conversations"
  on public.conversations for delete to authenticated
  using (public.is_conversation_creator(id));

-- Remove conversations left behind with zero members by earlier failures.
delete from public.conversations
where id not in (select conversation_id from public.conversation_members);
