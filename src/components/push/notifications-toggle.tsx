"use client";

import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushStatus,
  type PushStatus,
} from "@/lib/push";

type State = PushStatus | "busy";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong.";
}

/**
 * "Notifications" row for the account drawer. Requests permission, creates
 * or removes this device's push subscription, and mirrors the result in a
 * small On/Off pill (same pill style as the app-lock card).
 */
export function NotificationsToggle() {
  const [state, setState] = useState<State>("busy");
  const [error, setError] = useState<string | null>(null);

  // The drawer remounts on every open, so this reads fresh device state.
  useEffect(() => {
    let alive = true;
    getPushStatus()
      .then((status) => {
        if (alive) setState(status);
      })
      .catch(() => {
        if (alive) setState("off");
      });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle() {
    setError(null);
    const wasOn = state === "on";
    setState("busy");
    try {
      if (wasOn) {
        await disablePush();
      } else {
        await enablePush();
      }
    } catch (err) {
      setError(messageOf(err));
    }
    // Re-read device state — a denied prompt moves us to "blocked", etc.
    try {
      setState(await getPushStatus());
    } catch {
      setState(wasOn ? "off" : "on");
    }
  }

  if (state === "unsupported") {
    return (
      <p className="w-full px-3 py-2.5 text-sm text-muted-foreground">
        Notifications aren&apos;t supported in this browser
      </p>
    );
  }

  if (state === "blocked") {
    return (
      <div className="w-full px-3 py-2.5">
        <p className="text-sm font-medium text-muted-foreground">
          Notifications
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Blocked — allow them for this site in your browser settings.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        disabled={state === "busy"}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-60"
      >
        <span>Notifications</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            state === "on"
              ? "bg-accent/15 text-accent"
              : "bg-surface-hover text-muted-foreground"
          }`}
        >
          {state === "busy" ? "…" : state === "on" ? "On" : "Off"}
        </span>
      </button>
      {error && (
        <p className="mt-1 px-3 text-xs text-red-500 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
