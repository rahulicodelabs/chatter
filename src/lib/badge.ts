import { ensureServiceWorker, pushSupported } from "@/lib/push";

/**
 * App-icon badge for pending (unread) messages — the Web Badging API.
 *
 * Platform reality (2026):
 *  - iOS/iPadOS home-screen web apps (16.4+) and installed Chrome/Edge PWAs
 *    on desktop honour `navigator.setAppBadge()`.
 *  - Chrome on Android does NOT implement the API. There, the launcher dot
 *    comes automatically from unread notifications instead — so we also
 *    retire notifications whose conversation has been read (below), which
 *    keeps that automatic dot honest.
 *  - Everywhere else the calls simply no-op; badges are a progressive
 *    enhancement and must never break the app.
 */

/** Navigator typings for the Badging API (not in every lib.dom version). */
type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** Set/clear the icon badge; feature-detected and fully guarded. */
function setIconBadge(total: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  if (typeof nav.setAppBadge !== "function") return;
  try {
    const count = Math.max(0, Math.floor(total));
    const request =
      count > 0
        ? nav.setAppBadge(count)
        : typeof nav.clearAppBadge === "function"
          ? nav.clearAppBadge()
          : nav.setAppBadge(0);
    void request?.catch(() => {
      /* unsupported context / permission withheld — nothing to show */
    });
  } catch {
    /* synchronous TypeError (bad value) — badges must never crash the app */
  }
}

/**
 * Keep the icon badge and the app's pending push notifications in step with
 * the sidebar's unread counts. Call after any change to the conversation
 * list (boot, incoming message, markRead) — cheap and idempotent.
 *
 * Does nothing while the page is hidden: the service worker owns the badge
 * then (it gets the authoritative unread total on every push), so the two
 * can never fight over the final value.
 */
export function syncUnreadBadge(
  conversations: Array<{ id: string; unread_count: number }>
): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return;
  }

  const list = conversations ?? [];
  const unreadOf = (c: { unread_count: number }) =>
    Number.isFinite(c.unread_count) && c.unread_count > 0 ? c.unread_count : 0;
  const total = list.reduce((sum, c) => sum + unreadOf(c), 0);

  setIconBadge(total);

  // Close notifications for conversations that are now read — on Android
  // this is what actually clears the launcher dot (the API no-ops there).
  if (!pushSupported()) return;
  const pending = new Set(list.filter((c) => unreadOf(c) > 0).map((c) => c.id));
  void (async () => {
    try {
      const registration = await ensureServiceWorker();
      const notifications = await registration?.getNotifications();
      for (const notification of notifications ?? []) {
        // sw.js tags every notification with its conversation id.
        if (!notification.tag || !pending.has(notification.tag)) {
          notification.close();
        }
      }
    } catch {
      /* notification cleanup is best-effort */
    }
  })();
}
