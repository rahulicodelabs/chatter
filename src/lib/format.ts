/**
 * Formatting locale is pinned so server and client always render the same
 * text. An empty/default locale lets Node (SSR) and the browser pick their
 * own defaults — e.g. "06:18 PM" vs "18:18" — which breaks hydration.
 */
export const LOCALE = "en-GB";

/** "10:42" for today, "Mon 10:42" within a week, otherwise "12 Mar 10:42". */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const time = date.toLocaleTimeString(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (date.toDateString() === now.toDateString()) return time;

  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 7) {
    return `${date.toLocaleDateString(LOCALE, { weekday: "short" })} ${time}`;
  }
  return `${date.toLocaleDateString(LOCALE, { day: "numeric", month: "short" })} ${time}`;
}

/** Short form for the sidebar list: time today, weekday this week, else date. */
export function formatListTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" });
  }
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 7) return date.toLocaleDateString(LOCALE, { weekday: "short" });
  return date.toLocaleDateString(LOCALE, { day: "numeric", month: "numeric" });
}

/** Initials for avatar circles. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Escape user input for a PostgREST `or=...ilike` filter. */
export function sanitizeSearchTerm(q: string): string {
  return q.replace(/[,%_()"]/g, " ").trim();
}
