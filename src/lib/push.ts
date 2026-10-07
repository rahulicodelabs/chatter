import { createClient } from "@/lib/supabase/client";

/** Status of push notifications on this device. */
export type PushStatus = "unsupported" | "blocked" | "on" | "off";

/**
 * localStorage flag set when the user explicitly turns notifications off on
 * this device. Survives sign-out/in so an opt-out isn't silently undone by
 * the startup sync (enabling again clears it).
 */
export const PUSH_OFF_KEY = "chatter-push-off";

let cachedRegistration: ServiceWorkerRegistration | null = null;

/** Web Push needs the Push API + notifications + a service worker. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** base64url VAPID public key → bytes for PushManager.subscribe(). */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private browsing — the flag is best-effort */
  }
}

/**
 * Register /sw.js and resolve once there is an ACTIVE worker (required for
 * pushManager calls). Cached across calls; returns null on failure.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  if (cachedRegistration?.active) return cachedRegistration;
  try {
    await navigator.serviceWorker.register("/sw.js");
    cachedRegistration = await navigator.serviceWorker.ready;
    return cachedRegistration;
  } catch (error) {
    console.error("notifications: service worker registration failed", error);
    return null;
  }
}

/** Current device status, read locally (permission + subscription state). */
export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  try {
    const registration = await ensureServiceWorker();
    const subscription = await registration?.pushManager.getSubscription();
    return subscription ? "on" : "off";
  } catch {
    return "off";
  }
}

/** Persist this browser's subscription as the signed-in user's row. */
async function upsertSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("This browser returned an invalid push subscription.");
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to turn on notifications.");

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) {
    if (error.message.includes("push_subscriptions")) {
      // The migration hasn't been run on this project yet.
      throw new Error("Notifications aren't set up on this server yet.");
    }
    throw new Error(error.message);
  }
}

/**
 * Turn notifications on. Must be called from a user gesture (the drawer
 * toggle) because Notification.requestPermission() requires one. Throws an
 * Error whose message is safe to show in the UI.
 */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) {
    throw new Error("Notifications aren't supported in this browser.");
  }
  const permission = await Notification.requestPermission();
  if (permission === "denied") {
    throw new Error("Notifications are blocked in your browser settings.");
  }
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) {
    throw new Error("Notifications aren't set up on this server yet.");
  }
  const registration = await ensureServiceWorker();
  if (!registration) {
    throw new Error("Couldn't start the notification service.");
  }

  let subscription = await registration.pushManager.getSubscription();
  const fresh = subscription === null;
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    } catch (error) {
      // Brave ships "Use Google services for push messaging" (brave.gcm) off
      // by default, which makes subscribe() fail with this opaque exception.
      if (error instanceof Error && /push service error/i.test(error.message)) {
        throw new Error(
          'The browser blocked its push service. Brave users: enable "Use Google services for push messaging" in brave://settings/privacy, then restart the browser.'
        );
      }
      throw error;
    }
  }
  try {
    await upsertSubscription(subscription);
  } catch (error) {
    // Roll back a subscription we just created so the toggle never claims
    // "On" while the server has no row to deliver to.
    if (fresh) {
      try {
        await subscription.unsubscribe();
      } catch {
        /* already gone */
      }
    }
    throw error;
  }
  storageSet(PUSH_OFF_KEY, null);

  // Local confirmation (not a server push) so the tap feels immediate.
  try {
    await registration.showNotification("Notifications enabled", {
      body: "You'll get notified when new messages arrive.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-maskable.png",
      tag: "chatter-enabled",
    });
  } catch {
    /* cosmetic only */
  }
}

/**
 * Turn notifications off: unsubscribe this browser and drop the row.
 * Never throws (best-effort). `remember: false` is used on sign-out so the
 * device isn't left with a permanent opt-out flag for the next login.
 */
export async function disablePush(options?: { remember?: boolean }): Promise<void> {
  const remember = options?.remember ?? true;
  if (remember) storageSet(PUSH_OFF_KEY, "1");
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    const registration = await ensureServiceWorker();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    const supabase = createClient();
    await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  } catch (error) {
    console.error("notifications: disable failed", error);
  }
}

/**
 * Heal the subscription on startup: after a login the row may be missing or
 * belong to a previous account, so re-upsert what this browser holds — or
 * subscribe freshly when permission was granted earlier but nothing exists.
 * Skipped when the user opted out on this device. Never throws.
 */
export async function syncPush(): Promise<void> {
  if (!pushSupported()) return;
  if (Notification.permission !== "granted") return;
  if (storageGet(PUSH_OFF_KEY)) return;
  try {
    const registration = await ensureServiceWorker();
    if (!registration) return;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) return;
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await upsertSubscription(subscription);
  } catch (error) {
    console.error("notifications: sync failed", error);
  }
}

/**
 * Tell the service worker which conversation is on screen (and whether the
 * page is visible at all) so push notifications for the conversation the
 * user is reading get suppressed. `visible` overrides the live value when
 * the app is navigating away.
 */
export async function postPushState(
  conversationId: string | null,
  visible?: boolean
): Promise<void> {
  if (!pushSupported()) return;
  try {
    const registration = await ensureServiceWorker();
    const target = registration?.active ?? navigator.serviceWorker.controller;
    target?.postMessage({
      type: "chat-state",
      visible: visible ?? document.visibilityState === "visible",
      conversationId,
    });
  } catch (error) {
    console.error("notifications: state post failed", error);
  }
}
