"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { normalizeMembers } from "@/lib/members";
import { isVideoMessage } from "@/lib/attachments";
import { ChatContext } from "@/components/chat/chat-context";
import { ConversationList } from "@/components/chat/conversation-list";
import { NewChatDialog } from "@/components/chat/new-chat-dialog";
import { AccountDrawer } from "@/components/chat/account-drawer";
import { ThemeToggle } from "@/components/chat/theme-toggle";
import { Avatar } from "@/components/chat/avatar";
import type {
  ChatContextValue,
  ConversationMember,
  ConversationSummary,
  Message,
  PublicProfile,
} from "@/lib/types";

type Props = {
  user: PublicProfile;
  initialConversations: ConversationSummary[];
  initialMembers: ConversationMember[];
  children: React.ReactNode;
};

function groupMembers(rows: ConversationMember[]): Record<string, ConversationMember[]> {
  const map: Record<string, ConversationMember[]> = {};
  for (const row of rows) {
    (map[row.conversation_id] ??= []).push(row);
  }
  return map;
}

function ConnectedShell({
  user,
  initialConversations,
  initialMembers,
  children,
}: Props) {
  const pathname = usePathname();
  const [conversations, setConversations] = useState<ConversationSummary[]>(
    initialConversations
  );
  const [membersByConversation, setMembersByConversation] = useState(() =>
    groupMembers(initialMembers)
  );
  const [showNewChat, setShowNewChat] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  // Read the latest pathname inside realtime callbacks without re-subscribing.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const refreshConversations = useCallback(async () => {
    const supabase = createClient();
    const { data: summaries } = await supabase
      .from("conversation_summaries")
      .select("*")
      .eq("user_id", user.id)
      .order("last_activity", { ascending: false });

    const list = (summaries ?? []) as ConversationSummary[];
    setConversations(list);

    if (list.length === 0) {
      setMembersByConversation({});
      return;
    }

    const { data: memberRows } = await supabase
      .from("conversation_members")
      .select(
        "conversation_id, user_id, role, joined_at, profile:user_id(id, username, full_name, avatar_url)"
      )
      .in(
        "conversation_id",
        list.map((c) => c.id)
      );
    setMembersByConversation(groupMembers(normalizeMembers(memberRows)));
  }, [user.id]);

  const markRead = useCallback(
    (conversationId: string) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, unread_count: 0, last_read_at: new Date().toISOString() }
            : c
        )
      );
      const supabase = createClient();
      void supabase
        .from("conversation_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("user_id", user.id)
        .then(({ error }) => {
          if (error) console.error("Failed to mark conversation read:", error.message);
        });
    },
    [user.id]
  );

  const addConversation = useCallback(
    (conversation: ConversationSummary, members: ConversationMember[]) => {
      setConversations((prev) => [
        conversation,
        ...prev.filter((c) => c.id !== conversation.id),
      ]);
      setMembersByConversation((prev) => ({ ...prev, [conversation.id]: members }));
    },
    []
  );

  const conversationLabel = useCallback(
    (c: Pick<ConversationSummary, "id" | "type" | "title">) => {
      if (c.type === "group") return c.title?.trim() || "Group chat";
      const members = membersByConversation[c.id] ?? [];
      const other = members.find((m) => m.profile?.id !== user.id)?.profile;
      if (!other) return "Conversation";
      return other.full_name?.trim() || other.username;
    },
    [membersByConversation, user.id]
  );

  // Latest conversation ids for the realtime callback without re-subscribing.
  const idSetRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    idSetRef.current = new Set(conversations.map((c) => c.id));
  }, [conversations]);

  // Live updates: new messages bump the list preview / unread count,
  // new memberships pull in conversations created by other people.
  //
  // Two subtleties make this effect async and its topic unique:
  // 1. The channel join payload captures Realtime's JWT synchronously. The
  //    token is only populated (asynchronously) after client construction, so
  //    subscribing immediately would send a token-less join: the server acks
  //    it as anon and RLS then silently drops every event.
  // 2. Every subscription instance gets a unique topic, because React
  //    (StrictMode in dev, or any effect re-run) tears the old channel down
  //    asynchronously — re-joining the same topic while the previous
  //    incarnation is still leaving can poison the subscription.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let createdChannel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (cancelled) return;

      const channel = supabase.channel(
        `chat-shell-${user.id}-${crypto.randomUUID()}`
      );
      createdChannel = channel;

      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const message = payload.new as Message;
          if (!idSetRef.current.has(message.conversation_id)) return;

          const viewing = pathnameRef.current === `/chat/${message.conversation_id}`;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === message.conversation_id
                ? {
                    ...c,
                    last_message:
                      message.body ||
                      (message.image_url
                        ? isVideoMessage(message)
                          ? "🎬 Video"
                          : "📷 Photo"
                        : null),
                    last_message_at: message.created_at,
                    last_message_sender_id: message.sender_id,
                    last_activity: message.created_at,
                    unread_count:
                      viewing || message.sender_id === user.id ? 0 : c.unread_count + 1,
                  }
                : c
            )
          );

          // Any open client of the recipient marks the message as delivered
          // (the thread additionally marks it read when it's on screen).
          if (message.sender_id !== user.id) {
            supabase
              .from("message_deliveries")
              .upsert(
                {
                  message_id: message.id,
                  user_id: user.id,
                  delivered_at: new Date().toISOString(),
                },
                { onConflict: "message_id,user_id", ignoreDuplicates: true }
              )
              .then(({ error }) => {
                if (error) console.error("Failed to record delivery:", error.message);
              });
          }
        }
      );

      const onMembershipChange = () => {
        void refreshConversations();
      };
      channel.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_members", filter: `user_id=eq.${user.id}` },
        onMembershipChange
      );
      channel.on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "conversation_members", filter: `user_id=eq.${user.id}` },
        onMembershipChange
      );

      channel.subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[realtime] shell subscription ${status}`, err ?? "");
        }
      });
    })();

    return () => {
      cancelled = true;
      if (createdChannel) void supabase.removeChannel(createdChannel);
    };
  }, [refreshConversations, user.id]);

  const value = useMemo<ChatContextValue>(
    () => ({
      user,
      conversations,
      membersByConversation,
      conversationLabel,
      markRead,
      addConversation,
      refreshConversations,
    }),
    [
      user,
      conversations,
      membersByConversation,
      conversationLabel,
      markRead,
      addConversation,
      refreshConversations,
    ]
  );

  // A dedicated pane (thread or profile) is open: hide the sidebar on mobile.
  const showMainPane =
    pathname.startsWith("/chat/") || pathname.startsWith("/profile");

  return (
    <ChatContext.Provider value={value}>
      <div className="flex h-[100dvh] w-full overflow-hidden">
        <aside
          className={`${
            showMainPane ? "hidden md:flex" : "flex"
          } w-full shrink-0 flex-col border-r border-border bg-surface md:w-80`}
        >
          <header className="relative flex items-center gap-2 border-b border-border px-4 py-3">
            {/* Centred on mobile; back in flow (left) from md up. */}
            <Link
              href="/"
              className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 md:static md:translate-x-0"
              title="Home"
              aria-label="Chatter home"
            >
              <Image
                src="/icons/icon-192.png"
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-xl"
              />
              <span className="font-semibold tracking-tight">Chatter</span>
            </Link>
            <button
              type="button"
              onClick={() => setShowNewChat(true)}
              title="New chat"
              aria-label="New chat"
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border text-lg leading-none text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              +
            </button>
          </header>

          <ConversationList />

          <footer className="border-t border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAccountMenu(true)}
                className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left"
                title="Account menu"
                aria-haspopup="dialog"
                aria-label="Open account menu"
              >
                <Avatar
                  src={user.avatar_url}
                  name={user.full_name || user.username}
                  size="sm"
                />
                <span className="min-w-0 text-left">
                  <span className="block truncate text-sm font-medium group-hover:underline">
                    {user.full_name || user.username}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    @{user.username}
                  </span>
                </span>
              </button>
              <ThemeToggle />
            </div>
          </footer>
        </aside>

        <main
          className={`${
            showMainPane ? "flex" : "hidden md:flex"
          } min-h-0 min-w-0 flex-1 flex-col`}
        >
          {children}
        </main>

        {showNewChat && <NewChatDialog onClose={() => setShowNewChat(false)} />}
        {showAccountMenu && (
          <AccountDrawer
            user={user}
            onClose={() => setShowAccountMenu(false)}
          />
        )}
      </div>
    </ChatContext.Provider>
  );
}

/**
 * Shell boot wrapper.
 *
 * Renders synchronously on the server (an instant skeleton, no data awaits)
 * so route navigations commit immediately, then loads the shell's data — own
 * profile, conversation list, members — once on the client. After that first
 * load the ConnectedShell instance persists across navigations and realtime
 * keeps it fresh; clicking between chats never re-fetches the sidebar.
 */
export function ChatShell({ children }: { children: React.ReactNode }) {
  const [initial, setInitial] = useState<{
    user: PublicProfile;
    conversations: ConversationSummary[];
    members: ConversationMember[];
  } | null>(null);
  const [missingProfile, setMissingProfile] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session) {
        // The proxy already redirects unauthenticated requests; this covers
        // sessions that disappear client-side (signed out in another tab).
        window.location.replace("/login");
        return;
      }

      const [profileRes, summariesRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, username, full_name, avatar_url, created_at")
          .eq("id", session.user.id)
          .maybeSingle(),
        supabase
          .from("conversation_summaries")
          .select("*")
          .eq("user_id", session.user.id)
          .order("last_activity", { ascending: false }),
      ]);
      if (cancelled) return;

      if (profileRes.error || summariesRes.error) {
        // The cookie doesn't map to a reachable, valid session — drop it
        // rather than rendering against a failing API.
        await supabase.auth.signOut();
        if (!cancelled) window.location.replace("/login");
        return;
      }

      const profile = profileRes.data as PublicProfile | null;
      if (!profile) {
        // The auth trigger from supabase/schema.sql hasn't been installed.
        setMissingProfile(true);
        return;
      }

      const conversations = (summariesRes.data ?? []) as ConversationSummary[];
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
        if (cancelled) return;
        members = normalizeMembers(memberRows);
      }

      if (cancelled) return;
      setInitial({ user: profile, conversations, members });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (missingProfile) return <NotInitialized />;
  if (!initial) return <ShellSkeleton />;

  return (
    <ConnectedShell
      user={initial.user}
      initialConversations={initial.conversations}
      initialMembers={initial.members}
    >
      {children}
    </ConnectedShell>
  );
}

/** Full-app skeleton shown while the shell fetches its first data. */
function ShellSkeleton() {
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden">
      <aside className="flex w-full shrink-0 flex-col border-r border-border bg-surface md:w-80">
        <header className="relative flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2 md:static md:translate-x-0">
            <span className="h-8 w-8 animate-pulse rounded-xl bg-skeleton" />
            <span className="h-4 w-20 animate-pulse rounded bg-skeleton" />
          </span>
          <span className="ml-auto block h-8 w-8 rounded-lg bg-skeleton" />
        </header>
        <div className="flex-1 space-y-3 p-4">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-xl bg-skeleton"
            />
          ))}
        </div>
        <footer className="border-t border-border px-4 py-3">
          <div className="h-10 animate-pulse rounded-lg bg-skeleton" />
        </footer>
      </aside>
      <main className="hidden min-h-0 min-w-0 flex-1 flex-col md:flex" />
    </div>
  );
}

/** Shown when the profile row for the signed-in user doesn't exist yet. */
function NotInitialized() {
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
