import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/supabase/auth";
import { normalizeMembers } from "@/lib/members";
import { ConversationThread } from "@/components/chat/conversation-thread";
import type { Conversation, Message, Profile } from "@/lib/types";

export default async function ConversationPage(props: PageProps<"/chat/[id]">) {
  const { id } = await props.params;

  const supabase = await createClient();

  // ONE parallel phase: identity verification, our own profile (keyed off
  // the local session id and re-checked against the verified user below),
  // the conversation, members, and messages. RLS gates every query while
  // they run, so a non-member simply receives no rows. Previously this was
  // three serial phases (auth → conversation chain → profile).
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const userPromise = getCurrentUser();
  const profilePromise = session
    ? supabase
        .from("profiles")
        .select("id, username, full_name, avatar_url, created_at")
        .eq("id", session.user.id)
        .maybeSingle()
    : Promise.resolve({ data: null });

  const [{ data: conversation }, { data: memberRows }, { data: messageRows }, profileResult] =
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
      profilePromise,
    ]);

  const user = await userPromise;
  if (!user) redirect("/login");

  // Use the session-keyed row only when it matches the server-verified
  // user; otherwise (missing/tampered cookie) fall back to the verified id.
  let profile = profileResult.data as Profile | null;
  if (!profile || profile.id !== user.id) profile = await getCurrentProfile();
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
