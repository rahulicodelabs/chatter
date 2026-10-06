"use client";

import { useEffect, useState } from "react";
import {
  changeAction,
  disableAction,
  enableAction,
  getLockStatusAction,
  type LockActionResult,
} from "@/lib/app-lock-actions";

type Status = "loading" | "off" | "on";
type Panel = "none" | "enable" | "change" | "disable";

/**
 * "App lock" settings body — shown inside the App lock dialog (opened from
 * the account drawer). Enable / change / disable the 4–8 digit passcode the
 * app asks for on open.
 */
export function AppLockCard() {
  const [status, setStatus] = useState<Status>("loading");
  const [panel, setPanel] = useState<Panel>("none");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getLockStatusAction()
      .then((s) => alive && setStatus(s.hasPasscode ? "on" : "off"))
      .catch(() => alive && setStatus("off"));
    return () => {
      alive = false;
    };
  }, []);

  function openPanel(which: Panel) {
    setPanel(which);
    setError(null);
    setCurrent("");
    setNext("");
    setConfirm("");
  }

  async function run(action: () => Promise<LockActionResult>, success: Status) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setStatus(success);
      setPanel("none");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function submitEnable(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setError("Passcodes don't match.");
      return;
    }
    void run(() => enableAction(next), "on");
  }

  function submitChange(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setError("Passcodes don't match.");
      return;
    }
    void run(() => changeAction(current, next), "on");
  }

  function submitDisable(event: React.FormEvent) {
    event.preventDefault();
    void run(() => disableAction(current), "off");
  }

  const pinInput = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void
  ) => (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="password"
        required
        inputMode="numeric"
        autoComplete="off"
        maxLength={8}
        pattern="\d{4,8}"
        title="4–8 digits"
        placeholder="••••"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 8))}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
    </div>
  );

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {status === "loading"
            ? "Checking status…"
            : status === "on"
              ? "Ask for a passcode whenever Chatter opens — on any device."
              : "Protect this account with a passcode whenever the app opens."}
        </p>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            status === "on"
              ? "bg-accent/15 text-accent"
              : "bg-surface-hover text-muted-foreground"
          }`}
        >
          {status === "loading" ? "…" : status === "on" ? "On" : "Off"}
        </span>
      </div>

      {status === "on" && panel === "none" && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => openPanel("change")}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            Change passcode
          </button>
          <button
            type="button"
            onClick={() => openPanel("disable")}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
          >
            Turn off
          </button>
        </div>
      )}

      {status === "off" && panel === "none" && (
        <button
          type="button"
          onClick={() => openPanel("enable")}
          className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition hover:bg-accent-hover"
        >
          Turn on app lock
        </button>
      )}

      {panel === "enable" && (
        <form onSubmit={submitEnable} className="mt-3 space-y-3">
          {pinInput("lock-new", "New passcode (4–8 digits)", next, setNext)}
          {pinInput("lock-confirm", "Confirm passcode", confirm, setConfirm)}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || next.length < 4}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Saving…" : "Turn on"}
            </button>
            <button
              type="button"
              onClick={() => openPanel("none")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {panel === "change" && (
        <form onSubmit={submitChange} className="mt-3 space-y-3">
          {pinInput("lock-current", "Current passcode", current, setCurrent)}
          {pinInput("lock-new", "New passcode (4–8 digits)", next, setNext)}
          {pinInput("lock-confirm", "Confirm passcode", confirm, setConfirm)}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || next.length < 4 || current.length < 4}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-60"
            >
              {busy ? "Saving…" : "Change"}
            </button>
            <button
              type="button"
              onClick={() => openPanel("none")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {panel === "disable" && (
        <form onSubmit={submitDisable} className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter your current passcode to turn the lock off.
          </p>
          {pinInput("lock-current", "Current passcode", current, setCurrent)}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || current.length < 4}
              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-600 disabled:opacity-60"
            >
              {busy ? "Turning off…" : "Turn off"}
            </button>
            <button
              type="button"
              onClick={() => openPanel("none")}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-surface-hover hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-500">
          {error}
        </p>
      )}
    </section>
  );
}
