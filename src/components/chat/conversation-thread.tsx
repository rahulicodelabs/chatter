"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useChatContext } from "@/components/chat/chat-context";
import { createClient } from "@/lib/supabase/client";
import { formatMessageTime } from "@/lib/format";
import { loadChatImage, uploadChatPhoto, type ChatImage } from "@/lib/images";
import { Avatar } from "@/components/chat/avatar";
import { ReadTicks, type TickState } from "@/components/chat/read-ticks";
import type {
  Conversation,
  ConversationMember,
  Message,
  MessageDelivery,
  PublicProfile,
} from "@/lib/types";

type Props = {
  conversation: Conversation;
  members: ConversationMember[];
  initialMessages: Message[];
  user: PublicProfile;
};

/** Scale an image to fit inside a box (never upscale). */
function fitWithin(width: number, height: number, maxW: number, maxH: number) {
  const scale = Math.min(1, maxW / Math.max(width, 1), maxH / Math.max(height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Display size for a message photo; falls back to a 4:3 box. */
function photoSize(message: Message): { width: number; height: number } {
  if (message.image_width && message.image_height) {
    return fitWithin(message.image_width, message.image_height, 280, 340);
  }
  return { width: 280, height: 210 };
}

export function ConversationThread({
  conversation,
  members,
  initialMessages,
  user,
}: Props) {
  const { markRead, conversationLabel } = useChatContext();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [receipts, setReceipts] = useState<MessageDelivery[]>([]);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<ChatImage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messageIdsRef = useRef<Set<string>>(
    new Set(initialMessages.map((m) => m.id))
  );

  const label = conversationLabel(conversation);
  const other = members.find((m) => m.profile?.id !== user.id)?.profile;
  const others = members.filter((m) => m.profile?.id !== user.id);

  // Latest members for the realtime callback without re-subscribing.
  const membersRef = useRef(members);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  useEffect(() => {
    messageIdsRef.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  // Opening the thread: clear the unread badge, load receipts, and record
  // delivery + read for any incoming messages we haven't acknowledged yet.
  useEffect(() => {
    markRead(conversation.id);

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data: existing } = await supabase
        .from("message_deliveries")
        .select("message_id, user_id, delivered_at, read_at")
        .in(
          "message_id",
          initialMessages.map((m) => m.id)
        );

      if (cancelled) return;
      const map = new Map<string, MessageDelivery>();
      for (const row of (existing ?? []) as MessageDelivery[]) {
        map.set(`${row.message_id}:${row.user_id}`, row);
      }

      const needsMarking = initialMessages
        .filter(
          (m) => m.sender_id !== user.id && !map.get(`${m.id}:${user.id}`)?.read_at
        )
        .map((m) => m.id);

      if (needsMarking.length > 0) {
        const now = new Date().toISOString();
        const { data: saved } = await supabase
          .from("message_deliveries")
          .upsert(
            needsMarking.map((id) => ({
              message_id: id,
              user_id: user.id,
              delivered_at: now,
              read_at: now,
            })),
            { onConflict: "message_id,user_id" }
          )
          .select("message_id, user_id, delivered_at, read_at");

        if (!cancelled && saved) {
          for (const row of saved as MessageDelivery[]) {
            map.set(`${row.message_id}:${row.user_id}`, row);
          }
        }
      }

      if (!cancelled) setReceipts([...map.values()]);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversation.id, initialMessages, user.id, markRead]);

  // Live incoming messages + live receipt (tick) updates.
  // Runs async with a unique topic — see the long note in chat-shell: the
  // join must carry a freshly-set Realtime JWT (otherwise RLS drops all
  // events silently) and must never reuse a topic that is still tearing down.
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
        `thread-${conversation.id}-${crypto.randomUUID()}`
      );
      createdChannel = channel;

      channel.on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const incoming = payload.new as Message;
          const sender = membersRef.current.find(
            (m) => m.profile?.id === incoming.sender_id
          )?.profile;
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id)
              ? prev
              : [...prev, { ...incoming, sender }]
          );
          if (incoming.sender_id !== user.id) {
            // On screen ⇒ delivered and read immediately.
            markRead(conversation.id);
            const now = new Date().toISOString();
            supabase
              .from("message_deliveries")
              .upsert(
                {
                  message_id: incoming.id,
                  user_id: user.id,
                  delivered_at: now,
                  read_at: now,
                },
                { onConflict: "message_id,user_id" }
              )
              .then(({ error: receiptError }) => {
                if (receiptError)
                  console.error("Failed to record read:", receiptError.message);
              });
          }
        }
      );

      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_deliveries" },
        (payload) => {
          const row = payload.new as MessageDelivery;
          if (!row?.message_id || !messageIdsRef.current.has(row.message_id)) return;
          setReceipts((prev) => [
            ...prev.filter(
              (r) => !(r.message_id === row.message_id && r.user_id === row.user_id)
            ),
            row,
          ]);
        }
      );

      channel.subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[realtime] thread subscription ${status}`, err ?? "");
        }
      });
    })();

    return () => {
      cancelled = true;
      if (createdChannel) void supabase.removeChannel(createdChannel);
    };
  }, [conversation.id, markRead, user.id]);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  /** ✓ / ✓✓ grey / ✓✓ blue for messages I sent. */
  function tickStateFor(message: Message): TickState | null {
    if (message.sender_id !== user.id || others.length === 0) return null;
    const forMessage = receipts.filter((r) => r.message_id === message.id);
    const delivered = new Set(
      forMessage.filter((r) => r.delivered_at).map((r) => r.user_id)
    );
    const read = new Set(forMessage.filter((r) => r.read_at).map((r) => r.user_id));
    if (others.every((o) => read.has(o.user_id))) return "read";
    if (others.every((o) => delivered.has(o.user_id))) return "delivered";
    return "sent";
  }

  function tickTitle(message: Message): string | undefined {
    if (others.length <= 1) return undefined;
    const forMessage = receipts.filter((r) => r.message_id === message.id);
    const readCount = others.filter((o) =>
      forMessage.some((r) => r.user_id === o.user_id && r.read_at)
    ).length;
    return `Read by ${readCount}/${others.length}`;
  }

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    const photo = pendingImage;
    if ((!body && !photo) || sending) return;

    setSending(true);
    setError(null);
    setDraft("");

    // Show the photo in the thread immediately while it uploads.
    const optimisticId = photo ? crypto.randomUUID() : null;
    if (photo && optimisticId) {
      setMessages((prev) => [
        ...prev,
        {
          id: optimisticId,
          conversation_id: conversation.id,
          sender_id: user.id,
          body,
          image_url: photo.dataUrl,
          image_width: photo.width,
          image_height: photo.height,
          created_at: new Date().toISOString(),
          sender: user,
          pending: true,
        },
      ]);
    }

    const supabase = createClient();
    try {
      let uploaded: { url: string; width: number; height: number } | null = null;
      if (photo) {
        uploaded = await uploadChatPhoto(supabase, user.id, photo);
      }

      const { data, error: insertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          sender_id: user.id,
          body,
          image_url: uploaded?.url ?? null,
          image_width: uploaded?.width ?? null,
          image_height: uploaded?.height ?? null,
        })
        .select("*, sender:sender_id(id, username, full_name, avatar_url)")
        .single();

      if (insertError || !data) {
        throw new Error(insertError?.message ?? "Message could not be sent.");
      }

      const saved = { ...(data as Message), sender: user, pending: false };
      setMessages((prev) => {
        const rest = optimisticId ? prev.filter((m) => m.id !== optimisticId) : prev;
        return rest.some((m) => m.id === saved.id)
          ? rest.map((m) => (m.id === saved.id ? saved : m))
          : [...rest, saved];
      });
      setPendingImage(null);
      markRead(conversation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be sent.");
      setDraft(body);
      if (optimisticId) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      }
    } finally {
      setSending(false);
    }
  }

  function pickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    void loadChatImage(file)
      .then((image) => setPendingImage(image))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Couldn't attach that photo.")
      );
  }

  const headerAvatar = (
    <Avatar
      src={conversation.type === "dm" ? (other?.avatar_url ?? null) : null}
      name={label}
      size="sm"
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <Link
          href="/"
          aria-label="Back to conversations"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-surface-hover hover:text-foreground md:hidden"
        >
          ←
        </Link>
        {conversation.type === "dm" && other ? (
          <Link
            href={`/profile/${other.id}`}
            aria-label={`View ${other.username}'s profile`}
            className="shrink-0"
          >
            {headerAvatar}
          </Link>
        ) : (
          headerAvatar
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {conversation.type === "dm" && other ? (
              <Link href={`/profile/${other.id}`} className="hover:underline">
                {label}
              </Link>
            ) : (
              label
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {conversation.type === "group"
              ? `${members.length} member${members.length === 1 ? "" : "s"}`
              : other
                ? `@${other.username}`
                : "Direct message"}
          </p>
        </div>
      </header>

      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs text-muted-foreground">
              Send the first message to get started.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {messages.map((message, index) => {
              const mine = message.sender_id === user.id;
              const previous = messages[index - 1];
              const showSender =
                !mine &&
                conversation.type === "group" &&
                previous?.sender_id !== message.sender_id;
              const senderProfile: PublicProfile | undefined =
                message.sender ??
                members.find((m) => m.profile?.id === message.sender_id)?.profile;
              const senderName = senderProfile
                ? senderProfile.full_name || senderProfile.username
                : "Unknown";
              const tickState = tickStateFor(message);

              return (
                <li
                  key={message.id}
                  className={`flex gap-2 ${mine ? "justify-end" : "justify-start"}`}
                >
                  {!mine && (
                    <Link
                      href={`/profile/${message.sender_id}`}
                      aria-label={`View ${senderName}'s profile`}
                      className="mt-auto shrink-0"
                    >
                      <Avatar
                        src={senderProfile?.avatar_url ?? null}
                        name={senderName}
                        size="xs"
                      />
                    </Link>
                  )}
                  <div
                    className={`flex max-w-[75%] flex-col gap-0.5 ${
                      mine ? "items-end" : "items-start"
                    }`}
                  >
                    {showSender && (
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">
                        {senderName}
                      </span>
                    )}
                    <div
                      className={`rounded-2xl text-sm shadow-sm ${
                        message.image_url ? "overflow-hidden p-1" : "px-3 py-2"
                      } ${
                        mine
                          ? "rounded-br-sm bg-bubble-own text-bubble-own-foreground"
                          : "rounded-bl-sm bg-bubble-other text-bubble-other-foreground"
                      }`}
                    >
                      {message.image_url && (
                        <a
                          href={message.image_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open photo"
                          className="block"
                        >
                          <Image
                            src={message.image_url}
                            alt={message.body || "Photo"}
                            {...photoSize(message)}
                            className={`rounded-xl ${
                              message.image_width && message.image_height
                                ? ""
                                : "object-cover"
                            }`}
                            sizes="(max-width: 768px) 70vw, 280px"
                          />
                        </a>
                      )}
                      {message.body && (
                        <p
                          className={`whitespace-pre-wrap break-words ${
                            message.image_url ? "px-2 pb-1 pt-1.5" : ""
                          }`}
                        >
                          {message.body}
                        </p>
                      )}
                    </div>
                    <span className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                      {formatMessageTime(message.created_at)}
                      {tickState && (
                        <ReadTicks
                          state={tickState}
                          title={tickTitle(message)}
                        />
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p
          role="alert"
          className="border-t border-border bg-red-500/10 px-4 py-1.5 text-xs text-red-500"
        >
          {error}
        </p>
      )}

      <form
        onSubmit={send}
        className="flex flex-col gap-2 border-t border-border bg-surface px-4 py-3"
      >
        {pendingImage && (
          <div className="flex items-center gap-2 self-start rounded-xl border border-border bg-background p-1.5">
            <Image
              src={pendingImage.dataUrl}
              alt="Selected photo"
              width={48}
              height={48}
              className="h-12 w-12 rounded-lg object-cover"
              unoptimized
            />
            <span className="min-w-0 pr-1">
              <span className="block text-xs font-medium">Photo ready</span>
              <span className="block text-[10px] text-muted-foreground">
                Add a caption or send as-is
              </span>
            </span>
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              disabled={sending}
              aria-label="Remove photo"
              className="rounded-lg p-1.5 text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              ✕
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={pickPhoto}
            className="hidden"
            aria-label="Choose a photo"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={sending || !!pendingImage}
            aria-label="Attach a photo"
            title="Attach a photo"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-40"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </button>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message…"
            aria-label="Message"
            className="min-h-10 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <button
            type="submit"
            disabled={sending || (!draft.trim() && !pendingImage)}
            className="shrink-0 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50"
          >
            {sending ? (pendingImage ? "Uploading…" : "…") : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
