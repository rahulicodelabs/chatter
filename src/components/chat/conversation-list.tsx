"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useChatContext } from "@/components/chat/chat-context";
import { Avatar } from "@/components/chat/avatar";
import { formatListTime } from "@/lib/format";

export function ConversationList() {
  const { conversations, user, conversationLabel, markRead, membersByConversation } =
    useChatContext();
  const pathname = usePathname();

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="text-xs text-muted-foreground">
          Start a direct message or create a group chat with the + button above.
        </p>
      </div>
    );
  }

  const sorted = [...conversations].sort(
    (a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime()
  );

  return (
    <nav className="chat-scroll flex-1 overflow-y-auto p-2" aria-label="Conversations">
      <ul className="space-y-1">
        {sorted.map((conversation) => {
          const active = pathname === `/chat/${conversation.id}`;
          const label = conversationLabel(conversation);
          const otherProfile =
            conversation.type === "dm"
              ? (membersByConversation[conversation.id] ?? []).find(
                  (m) => m.profile?.id !== user.id
                )?.profile
              : undefined;
          const preview = conversation.last_message
            ? `${
                conversation.last_message_sender_id === user.id ? "You: " : ""
              }${conversation.last_message}`
            : "No messages yet";

          return (
            <li key={conversation.id}>
              <Link
                href={`/chat/${conversation.id}`}
                onClick={() => markRead(conversation.id)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${
                  active ? "bg-accent/10" : "hover:bg-surface-hover"
                }`}
              >
                <Avatar
                  src={otherProfile?.avatar_url ?? null}
                  name={label}
                  size="md"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatListTime(conversation.last_message_at ?? conversation.created_at)}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-muted-foreground">{preview}</span>
                    {conversation.unread_count > 0 && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
                        {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
