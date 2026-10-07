"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  ensureServiceWorker,
  postPushState,
  pushSupported,
  syncPush,
} from "@/lib/push";

const HEARTBEAT_MS = 10_000;

/**
 * Mounted once by the (chat) layout. Three jobs:
 *
 *  1. Register the push service worker and heal this device's subscription
 *     row (once per mount).
 *  2. Tell the worker which conversation is on screen so it can suppress
 *     notifications the user is already reading.
 *  3. Refresh that state on visibility/route changes — plus a heartbeat
 *     while visible, because the worker stops trusting state older than 25s
 *     (a crashed tab must not suppress notifications forever).
 */
export function PushSetup() {
  const pathname = usePathname();
  const conversationId = pathname.startsWith("/chat/")
    ? pathname.slice("/chat/".length)
    : null;

  // Register + sync once per mount.
  useEffect(() => {
    if (!pushSupported()) return;
    let alive = true;
    void ensureServiceWorker().then((registration) => {
      if (alive && registration) void syncPush();
    });
    return () => {
      alive = false;
    };
  }, []);

  // Keep the worker's screen state current for the open conversation.
  useEffect(() => {
    if (!pushSupported()) return;

    const post = () => {
      void postPushState(conversationId);
    };
    post();
    document.addEventListener("visibilitychange", post);
    window.addEventListener("pagehide", post);
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") post();
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener("visibilitychange", post);
      window.removeEventListener("pagehide", post);
      window.clearInterval(heartbeat);
      // Leaving the (chat) routes (e.g. to /lock): stop suppressing.
      void postPushState(null, false);
    };
  }, [conversationId]);

  return null;
}
