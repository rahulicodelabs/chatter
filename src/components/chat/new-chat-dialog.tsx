"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChatContext } from "@/components/chat/chat-context";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/chat/avatar";
import { sanitizeSearchTerm } from "@/lib/format";
import type { ConversationMember, ConversationSummary, PublicProfile } from "@/lib/types";

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const { user, addConversation } = useChatContext();
  const router = useRouter();

  const [tab, setTab] = useState<"dm" | "group">("dm");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [selected, setSelected] = useState<PublicProfile[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes the dialog.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced people search.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        const supabase = createClient();
        const term = sanitizeSearchTerm(query);
        const data = term
          ? (
              await supabase
                .from("profiles")
                .select("id, username, full_name, avatar_url")
                .neq("id", user.id)
                .or(`username.ilike.%${term}%,full_name.ilike.%${term}%`)
                .order("username", { ascending: true })
                .limit(20)
            ).data
          : (
              await supabase
                .from("profiles")
                .select("id, username, full_name, avatar_url")
                .neq("id", user.id)
                .order("username", { ascending: true })
                .limit(20)
            ).data;
        if (!cancelled) setResults((data ?? []) as PublicProfile[]);
      },
      query ? 250 : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, user.id]);

  async function createConversation(
    type: "dm" | "group",
    title: string | null,
    others: PublicProfile[]
  ) {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // Generate the id client-side: reading the row back inside the insert
    // statement would fail RLS (the row isn't visible to the policy's
    // subquery until the statement completes), so we never select() here.
    const conversationId = crypto.randomUUID();
    const { error: conversationError } = await supabase
      .from("conversations")
      .insert({ id: conversationId, type, title, created_by: user.id });

    if (conversationError) {
      setError(conversationError.message);
      setBusy(false);
      return;
    }

    const now = new Date().toISOString();
    const { error: memberError } = await supabase.from("conversation_members").insert([
      { conversation_id: conversationId, user_id: user.id, role: "owner" },
      ...others.map((other) => ({
        conversation_id: conversationId,
        user_id: other.id,
        role: "member",
      })),
    ]);

    if (memberError) {
      // Best-effort cleanup so we don't leave an empty conversation behind.
      await supabase.from("conversations").delete().eq("id", conversationId);
      setError(memberError.message);
      setBusy(false);
      return;
    }

    const summary: ConversationSummary = {
      id: conversationId,
      type,
      title,
      created_at: now,
      user_id: user.id,
      last_read_at: now,
      last_message: null,
      last_message_at: null,
      last_message_sender_id: null,
      last_activity: now,
      unread_count: 0,
    };
    const members: ConversationMember[] = [
      {
        conversation_id: conversationId,
        user_id: user.id,
        role: "owner",
        joined_at: now,
        profile: user,
      },
      ...others.map((other) => ({
        conversation_id: conversationId,
        user_id: other.id,
        role: "member" as const,
        joined_at: now,
        profile: other,
      })),
    ];

    addConversation(summary, members);
    setBusy(false);
    onClose();
    router.push(`/chat/${conversationId}`);
  }

  async function startDirectMessage(other: PublicProfile) {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // Reuse an existing DM if one already exists between the two of us.
    const [{ data: mine }, { data: theirs }] = await Promise.all([
      supabase.from("conversation_members").select("conversation_id").eq("user_id", user.id),
      supabase.from("conversation_members").select("conversation_id").eq("user_id", other.id),
    ]);
    const myIds = new Set((mine ?? []).map((row) => row.conversation_id));
    const shared = (theirs ?? [])
      .map((row) => row.conversation_id)
      .filter((id) => myIds.has(id));

    if (shared.length > 0) {
      const { data: dms } = await supabase
        .from("conversations")
        .select("id")
        .in("id", shared)
        .eq("type", "dm");
      if (dms && dms.length > 0) {
        setBusy(false);
        onClose();
        router.push(`/chat/${dms[0].id}`);
        return;
      }
    }

    await createConversation("dm", null, [other]);
  }

  function toggleSelect(profile: PublicProfile) {
    setSelected((prev) =>
      prev.some((p) => p.id === profile.id)
        ? prev.filter((p) => p.id !== profile.id)
        : [...prev, profile]
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New chat"
        className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">New chat</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground transition hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-3 pt-2">
          {(["dm", "group"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setQuery("");
                setError(null);
              }}
              className={`rounded-t-lg px-3 py-1.5 text-sm transition ${
                tab === t
                  ? "border-b-2 border-accent font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "dm" ? "Direct message" : "New group"}
            </button>
          ))}
        </div>

        {tab === "group" && (
          <div className="px-4 pt-3">
            <label htmlFor="group-title" className="mb-1.5 block text-sm font-medium">
              Group name
            </label>
            <input
              id="group-title"
              value={groupTitle}
              onChange={(event) => setGroupTitle(event.target.value)}
              placeholder="e.g. Weekend plans"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </div>
        )}

        <div className="px-4 pt-3">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "dm" ? "Search people…" : "Add people…"}
            aria-label="Search people"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>

        {tab === "group" && selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-2">
            {selected.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => toggleSelect(profile)}
                title="Remove"
                className="flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent transition hover:bg-accent/20"
              >
                {profile.full_name || profile.username} <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}

        <div className="chat-scroll mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No people found.
            </p>
          ) : (
            <ul className="space-y-1">
              {results.map((profile) => {
                const chosen = selected.some((p) => p.id === profile.id);
                return (
                  <li key={profile.id}>
                    <button
                      type="button"
                      onClick={() =>
                        tab === "dm"
                          ? void startDirectMessage(profile)
                          : toggleSelect(profile)
                      }
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-hover"
                    >
                      <Avatar
                        src={profile.avatar_url ?? null}
                        name={profile.full_name || profile.username}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {profile.full_name || profile.username}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{profile.username}
                        </span>
                      </span>
                      {tab === "group" && (
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                            chosen
                              ? "border-accent bg-accent text-accent-foreground"
                              : "border-border text-transparent"
                          }`}
                          aria-hidden
                        >
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="px-4 pb-2 text-xs text-red-500">
            {error}
          </p>
        )}

        {tab === "group" && (
          <div className="border-t border-border px-4 py-3">
            <button
              type="button"
              disabled={busy || selected.length === 0 || !groupTitle.trim()}
              onClick={() => void createConversation("group", groupTitle.trim(), selected)}
              className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-50"
            >
              {busy
                ? "Creating…"
                : `Create group (${selected.length + 1} member${
                    selected.length > 0 ? "s" : ""
                  })`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
