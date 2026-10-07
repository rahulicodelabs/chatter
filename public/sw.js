/* global self */
/**
 * Chatter service worker — Web Push only.
 *
 * Deliberately has NO fetch handler: it never intercepts navigations or
 * assets, so the app (and its app-lock redirects) behave exactly as before.
 *
 * Job: receive a push from FCM and show a notification, unless the user is
 * already looking at that exact conversation (the realtime UI renders it
 * live there). Page state is posted by PushSetup and is only trusted for
 * STATE_FRESH_MS — if the tab dies without reporting, notifications resume.
 */

const STATE_FRESH_MS = 25000;

/** Last known state of the app's pages, as posted by PushSetup. */
let pageState = { visible: false, conversationId: null, at: 0 };

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "chat-state") return;
  pageState = {
    visible: Boolean(data.visible),
    conversationId:
      typeof data.conversationId === "string" && data.conversationId
        ? data.conversationId
        : null,
    at: Date.now(),
  };
});

self.addEventListener("push", (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    /* fall through to the guard below */
  }
  if (!data || typeof data.title !== "string" || !data.title) return;

  const fresh = Date.now() - pageState.at < STATE_FRESH_MS;
  if (
    fresh &&
    pageState.visible &&
    pageState.conversationId &&
    pageState.conversationId === data.conversationId
  ) {
    // The user is already reading this conversation — skip the banner.
    console.log("sw: push suppressed (chat open)", data.conversationId);
    return;
  }

  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-maskable.png",
    tag: typeof data.conversationId === "string" ? data.conversationId : "chatter",
    renotify: true,
    data: { url: typeof data.url === "string" ? data.url : "/" },
  };
  if (typeof data.image === "string" && data.image) options.image = data.image;

  event.waitUntil(
    self.registration.showNotification(data.title, options).then(
      () => {
        console.log(
          "sw: notification shown:",
          data.title,
          "—",
          data.body,
          "conv",
          data.conversationId
        );
      },
      (error) => {
        console.error("sw: showNotification failed:", error);
      }
    )
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = typeof data.url === "string" ? data.url : "/";
  const url = new URL(path, self.location.origin).href;

  event.waitUntil(
    (async () => {
      // Focus an already-open window (navigating it to the conversation)
      // instead of spawning a second one.
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus();
          try {
            await client.navigate(url);
          } catch {
            /* navigating a locked/locking page still lands them in the app */
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
