export type TickState = "sent" | "delivered" | "read";

/**
 * WhatsApp-style status ticks for your outgoing messages:
 * ✓ sent → ✓✓ delivered (grey) → ✓✓ read (blue).
 */
export function ReadTicks({
  state,
  title,
}: {
  state: TickState;
  title?: string;
}) {
  const label =
    state === "sent" ? "Sent" : state === "delivered" ? "Delivered" : "Read";
  return (
    <span
      title={title ?? label}
      aria-label={label}
      className={`inline-flex items-center ${
        state === "read" ? "text-sky-400" : "text-muted-foreground"
      }`}
    >
      <svg
        viewBox="0 0 18 10"
        className="h-2.5 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M1 5.6 4.2 8.8 10.6 1.8" />
        {state !== "sent" && <path d="M7.2 5.6 10.4 8.8 16.8 1.8" />}
      </svg>
    </span>
  );
}
