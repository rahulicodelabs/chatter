"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  recoverAction,
  unlockAction,
  type LockActionResult,
} from "@/lib/app-lock-actions";
import { RELOCK_FLAG_KEY } from "@/lib/app-lock";

/**
 * Full-screen passcode gate rendered by /lock. Success navigates to ?next=
 * (the proxy now sees the unlock cookie and lets the request through).
 */
export function LockScreen({
  next,
  email,
  configError,
}: {
  next: string;
  email: string | null;
  configError?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"pin" | "recover">("pin");
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "pin") pinRef.current?.focus();
  }, [mode]);

  function done() {
    // You just unlocked — any leftover background/kill flag is stale.
    try {
      localStorage.removeItem(RELOCK_FLAG_KEY);
    } catch {
      // Storage unavailable — harmless.
    }
    router.replace(next);
    router.refresh();
  }

  async function submitPin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result: LockActionResult = await unlockAction(pin);
      if (result.ok) {
        setPin("");
        done();
      } else {
        setError(result.error ?? "Unable to unlock.");
        setPin("");
        pinRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  async function submitRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await recoverAction(password);
      if (result.ok) {
        setPassword("");
        done();
      } else {
        setError(result.error ?? "Unable to verify.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  if (configError) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm text-center">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-3 h-12 w-12 rounded-2xl"
          />
          <h1 className="text-xl font-semibold">App lock needs setup</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The passcode lock is enabled but <code>APP_LOCK_SECRET</code> isn&apos;t
            configured on this deployment. Add it in your environment variables and
            redeploy to unlock.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Image
            src="/icons/icon-192.png"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-3 h-12 w-12 rounded-2xl"
          />
          <h1 className="text-xl font-semibold">Chatter is locked</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "pin"
              ? "Enter your app passcode to continue."
              : "Verify it's you with your account password."}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          {mode === "pin" ? (
            <form onSubmit={submitPin} className="space-y-4">
              <div>
                <label htmlFor="app-passcode" className="mb-1.5 block text-sm font-medium">
                  Passcode
                </label>
                <div className="relative">
                  <input
                    ref={pinRef}
                    id="app-passcode"
                    name="passcode"
                    type={visible ? "text" : "password"}
                    required
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    pattern="\d{4,8}"
                    title="4–8 digits"
                    placeholder="••••"
                    value={pin}
                    onChange={(event) =>
                      setPin(event.target.value.replace(/\D/g, "").slice(0, 8))
                    }
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-10 text-center text-lg tracking-[0.4em] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((v) => !v)}
                    aria-label={visible ? "Hide passcode" : "Show passcode"}
                    aria-pressed={visible}
                    title={visible ? "Hide passcode" : "Show passcode"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground transition hover:text-foreground"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      {visible ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s8-4 11-4 11 4 11 4-8 4-11 4-11-4-11-4z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending || pin.length < 4}
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-60"
              >
                {pending ? "Unlocking…" : "Unlock"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("recover");
                  setError(null);
                }}
                className="w-full text-center text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                Forgot passcode?
              </button>
            </form>
          ) : (
            <form onSubmit={submitRecovery} className="space-y-4">
              <div>
                <p className="mb-1.5 block text-sm font-medium">Account</p>
                <p className="truncate rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  {email ?? "—"}
                </p>
              </div>

              <div>
                <label htmlFor="recovery-password" className="mb-1.5 block text-sm font-medium">
                  Account password
                </label>
                <input
                  id="recovery-password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={pending || password.length === 0}
                className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition hover:bg-accent-hover disabled:opacity-60"
              >
                {pending ? "Verifying…" : "Unlock with password"}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("pin");
                  setError(null);
                }}
                className="w-full text-center text-xs font-medium text-muted-foreground transition hover:text-foreground"
              >
                Use passcode instead
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
