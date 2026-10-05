import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/auth";
import { normalizeMembers } from "@/lib/members";
import { ConversationThread } from "@/components/chat/conversation-thread";
import type { Conversation, Message } from "@/lib/types";

export default async function ConversationPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;

  const supabase = await createClient();

  // Auth verification, conversation data, and messages all start together:
  // RLS gates every query (non-members simply get no rows), so nothing has to
  // wait for the identity check. This replaces an old chain of three serial
  // round trips (auth → membership/conversation → profile/members/messages).
  const userPromise = getCurrentUser();
  const [{ data: conversation }, { data: memberRows }, { data: messageRows }] =
    await Promise.all([
      supabase
        .from("conversations")
        .select("id, type, title, created_at, created_by")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("conversation_members")
        .select(
          "conversation_id, user_id, role, joined_at, profile:user_id(id, username, full_name, avatar_url)"
        )
        .eq("conversation_id", id),
      supabase
        .from("messages")
        .select("*, sender:sender_id(id, username, full_name, avatar_url)")
        .eq("conversation_id", id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const user = await userPromise;
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();
  if (!profile) notFound();

  // The conversations SELECT policy is member-only, so a missing row here
  // means "not a member" as well as "doesn't exist" → 404.
  if (!conversation) notFound();

  // Query is newest-first; render oldest-first.
  const messages = ((messageRows ?? []) as Message[]).slice().reverse();

  return (
    <ConversationThread
      key={conversation.id}
      conversation={conversation as Conversation}
      members={normalizeMembers(memberRows)}
      initialMessages={messages}
      user={profile}
    />
  );
}
