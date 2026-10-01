import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { normalizeMembers } from "@/lib/members";
import { ChatShell } from "@/components/chat/chat-shell";
import type { ConversationMember, ConversationSummary, Profile } from "@/lib/types";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  // The proxy normally redirects unauthenticated users; this is a safety net.
  if (!authUser) redirect("/login");

  const [{ data: profile }, { data: summaries }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, full_name, avatar_url, created_at")
      .eq("id", authUser.id)
      .maybeSingle(),
    supabase
      .from("conversation_summaries")
      .select("*")
      .eq("user_id", authUser.id)
      .order("last_activity", { ascending: false }),
  ]);

  if (!profile) {
    // The auth trigger from supabase/schema.sql hasn't been installed yet.
    return (
      <div className="flex h-[100dvh] items-center justify-center p-6">
        <div className="max-w-md space-y-2 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Database not initialized</h1>
          <p className="text-sm text-muted-foreground">
            Your profile row doesn&apos;t exist yet. Run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
              supabase/schema.sql
            </code>{" "}
            in the Supabase SQL Editor, then sign out and create a new account.
          </p>
        </div>
      </div>
    );
  }

  const conversations = (summaries ?? []) as ConversationSummary[];
  let members: ConversationMember[] = [];

  if (conversations.length > 0) {
    const { data: memberRows } = await supabase
      .from("conversation_members")
      .select(
        "conversation_id, user_id, role, joined_at, profile:user_id(id, username, full_name, avatar_url)"
      )
      .in(
        "conversation_id",
        conversations.map((c) => c.id)
      );
    members = normalizeMembers(memberRows);
  }

  return (
    <ChatShell
      user={profile as Profile}
      initialConversations={conversations}
      initialMembers={members}
    >
      {children}
    </ChatShell>
  );
}
