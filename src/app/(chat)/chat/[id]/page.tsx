import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeMembers } from "@/lib/members";
import { ConversationThread } from "@/components/chat/conversation-thread";
import type { Conversation, Message, Profile } from "@/lib/types";

export default async function ConversationPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  // Access check: you must be a member of this conversation.
  const [{ data: membership }, { data: conversation }] = await Promise.all([
    supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("conversation_id", id)
      .eq("user_id", authUser.id)
      .maybeSingle(),
    supabase
      .from("conversations")
      .select("id, type, title, created_at, created_by")
      .eq("id", id)
      .maybeSingle(),
  ]);

  if (!membership || !conversation) notFound();

  const [{ data: profile }, { data: memberRows }, { data: messageRows }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url, created_at")
        .eq("id", authUser.id)
        .single(),
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

  if (!profile) notFound();

  // Query is newest-first; render oldest-first.
  const messages = ((messageRows ?? []) as Message[]).slice().reverse();

  return (
    <ConversationThread
      key={conversation.id}
      conversation={conversation as Conversation}
      members={normalizeMembers(memberRows)}
      initialMessages={messages}
      user={profile as Profile}
    />
  );
}
