/**
 * Shown by the router the instant a navigation commits — the (chat) layout is
 * synchronous, so the shell paints immediately and this skeleton fills the
 * main pane while the route's server data streams in.
 */
export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Thread header */}
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <span className="h-8 w-8 animate-pulse rounded-full bg-surface-hover" />
        <span className="h-4 w-32 animate-pulse rounded bg-surface-hover" />
      </header>

      {/* Incoming / outgoing message bubbles */}
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 px-4 py-4">
        <div className="h-14 w-1/2 animate-pulse rounded-2xl rounded-bl-sm bg-surface-hover" />
        <div className="ml-auto h-12 w-1/3 animate-pulse rounded-2xl rounded-br-sm bg-surface-hover" />
        <div className="h-16 w-2/3 animate-pulse rounded-2xl rounded-bl-sm bg-surface-hover" />
      </div>

      {/* Composer */}
      <div className="border-t border-border p-3">
        <div className="h-11 w-full animate-pulse rounded-xl bg-surface-hover" />
      </div>
    </div>
  );
}
