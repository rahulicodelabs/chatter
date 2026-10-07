import { ChatShell } from "@/components/chat/chat-shell";
import { PushSetup } from "@/components/push/push-setup";

/**
 * Deliberately synchronous — no awaits, no Supabase round trips.
 *
 * Navigations between `/`, `/chat/[id]`, and `/profile/[id]` re-render this
 * layout on every click; keeping it async made every navigation wait for a
 * chain of server queries before the UI could even show a loading state. The
 * shell now loads its own data client-side (once, on first mount), so the
 * router can commit the new route immediately and page data streams in behind
 * the `(chat)/loading.tsx` skeleton.
 *
 * Auth: the proxy gates unauthenticated requests (local cookie check), routes
 * verify with getUser(), and RLS protects every row regardless.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Registers the push service worker and tracks which conversation is
          on screen (for suppressing notifications you're already reading). */}
      <PushSetup />
      <ChatShell>{children}</ChatShell>
    </>
  );
}
