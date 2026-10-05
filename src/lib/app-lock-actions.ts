"use server";

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  LOCK_OK_COOKIE,
  LOCK_OK_TTL_SECONDS,
  LOCK_REQ_COOKIE,
  LOCK_REQ_TTL_SECONDS,
  PIN_PATTERN,
  hashPasscode,
  lockCookieOptions,
  readLockState,
  signLockCookie,
  verifyPasscode,
} from "@/lib/app-lock";

export type LockActionResult = { ok: boolean; error?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------ brute-force throttle */

// Best-effort, per server instance: after 5 wrong tries the next attempt
// waits 10 s (plus a flat delay on every failure).
const attempts = new Map<string, { fails: number; blockedUntil: number }>();

async function throttleNextAttempt(userId: string) {
  const entry = attempts.get(userId);
  if (!entry) return;
  const now = Date.now();
  if (entry.blockedUntil > now) await sleep(entry.blockedUntil - now);
}

function recordFail(userId: string) {
  const entry = attempts.get(userId) ?? { fails: 0, blockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= 5) {
    entry.fails = 0;
    entry.blockedUntil = Date.now() + 10_000;
  }
  attempts.set(userId, entry);
}

function recordSuccess(userId: string) {
  attempts.delete(userId);
}

/* ------------------------------------------------------------------ helpers */

async function readPasscodeHash(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("passcode_hash")
    .eq("id", userId)
    .maybeSingle();
  return data?.passcode_hash ?? null;
}

async function setLockCookies(userId: string) {
  const store = await cookies();
  const req = await signLockCookie("req", userId, LOCK_REQ_TTL_SECONDS);
  const ok = await signLockCookie("ok", userId, LOCK_OK_TTL_SECONDS);
  store.set(LOCK_REQ_COOKIE, req.value, lockCookieOptions(req.maxAge));
  store.set(LOCK_OK_COOKIE, ok.value, lockCookieOptions(ok.maxAge));
}

async function setOkCookie(userId: string) {
  const store = await cookies();
  const ok = await signLockCookie("ok", userId, LOCK_OK_TTL_SECONDS);
  store.set(LOCK_OK_COOKIE, ok.value, lockCookieOptions(ok.maxAge));
}

function clearLockCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete(LOCK_REQ_COOKIE);
  store.delete(LOCK_OK_COOKIE);
}

/** Read + verify the current passcode against the stored hash (throttled). */
async function checkCurrentPasscode(userId: string, passcode: string): Promise<boolean> {
  await throttleNextAttempt(userId);
  const hash = await readPasscodeHash(userId);
  if (!hash) return false;
  const valid = await verifyPasscode(passcode, hash);
  if (valid) {
    recordSuccess(userId);
  } else {
    recordFail(userId);
    await sleep(350);
  }
  return valid;
}

/* ------------------------------------------------------------------ actions */

/** Called from the lock screen: verifies the PIN and unlocks this device. */
export async function unlockAction(passcode: string): Promise<LockActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const pin = String(passcode ?? "");
  if (!PIN_PATTERN.test(pin)) {
    return { ok: false, error: "Enter your 4–8 digit passcode." };
  }

  const hash = await readPasscodeHash(user.id);
  if (!hash) {
    // The lock was turned off on another device — drop the stale hint.
    clearLockCookies(await cookies());
    return { ok: true };
  }

  await throttleNextAttempt(user.id);
  const valid = await verifyPasscode(pin, hash);
  if (!valid) {
    recordFail(user.id);
    await sleep(350);
    return { ok: false, error: "Incorrect passcode." };
  }

  recordSuccess(user.id);
  await setOkCookie(user.id);
  return { ok: true };
}

/** Turn the app lock on (from the profile settings card). */
export async function enableAction(passcode: string): Promise<LockActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const pin = String(passcode ?? "");
  if (!PIN_PATTERN.test(pin)) {
    return { ok: false, error: "Passcode must be 4–8 digits." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ passcode_hash: await hashPasscode(pin) })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  await setLockCookies(user.id);
  return { ok: true };
}

/** Change the passcode — requires the current one. */
export async function changeAction(
  current: string,
  next: string
): Promise<LockActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const nextPin = String(next ?? "");
  if (!PIN_PATTERN.test(nextPin)) {
    return { ok: false, error: "New passcode must be 4–8 digits." };
  }

  const currentPin = String(current ?? "");
  if (!PIN_PATTERN.test(currentPin)) {
    return { ok: false, error: "Enter your current passcode." };
  }
  if (!(await checkCurrentPasscode(user.id, currentPin))) {
    return { ok: false, error: "Current passcode is incorrect." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ passcode_hash: await hashPasscode(nextPin) })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  await setOkCookie(user.id);
  return { ok: true };
}

/** Turn the app lock off — requires the current passcode. */
export async function disableAction(current: string): Promise<LockActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };

  const currentPin = String(current ?? "");
  if (!PIN_PATTERN.test(currentPin)) {
    return { ok: false, error: "Enter your current passcode." };
  }
  if (!(await checkCurrentPasscode(user.id, currentPin))) {
    return { ok: false, error: "Current passcode is incorrect." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ passcode_hash: null })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  clearLockCookies(await cookies());
  return { ok: true };
}

/**
 * "Forgot passcode?" — re-proving ownership with the account password
 * (verified server-side against Supabase) unlocks this device.
 */
export async function recoverAction(password: string): Promise<LockActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Your session expired. Sign in again." };
  if (!user.email) return { ok: false, error: "This account can't recover by email." };

  await throttleNextAttempt(user.id);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: String(password ?? ""),
  });
  if (error) {
    recordFail(user.id);
    await sleep(350);
    return { ok: false, error: "Incorrect password." };
  }
  recordSuccess(user.id);

  const hash = await readPasscodeHash(user.id);
  if (!hash) {
    clearLockCookies(await cookies());
    return { ok: true };
  }
  await setLockCookies(user.id);
  return { ok: true };
}

/**
 * Self-healing check run by the shell on boot and when the app is
 * foregrounded: other devices with a live session learn about a lock that
 * was enabled elsewhere, and stale hints are cleared after it's disabled.
 */
export async function ensureLockAction(): Promise<{ locked: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { locked: false };

  try {
    const store = await cookies();
    const state = await readLockState((name) => store.get(name)?.value, user.id);
    const hash = await readPasscodeHash(user.id);

    if (!hash) {
      if (state.required || store.get(LOCK_OK_COOKIE)) clearLockCookies(store);
      return { locked: false };
    }

    if (!state.required) {
      const req = await signLockCookie("req", user.id, LOCK_REQ_TTL_SECONDS);
      store.set(LOCK_REQ_COOKIE, req.value, lockCookieOptions(req.maxAge));
    }
    return { locked: !state.unlocked };
  } catch (error) {
    // Missing APP_LOCK_SECRET — the proxy fails closed on the next request.
    console.error("app-lock ensure:", error);
    return { locked: false };
  }
}

/** Whether the signed-in account currently has a passcode set. */
export async function getLockStatusAction(): Promise<{ hasPasscode: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { hasPasscode: false };
  return { hasPasscode: (await readPasscodeHash(user.id)) !== null };
}

/**
 * Sign out: clear the unlock for this device (the "lock enabled" hint stays,
 * so signing back in on this device asks for the passcode again).
 */
export async function signOutAction(): Promise<void> {
  const store = await cookies();
  store.delete(LOCK_OK_COOKIE);
  const supabase = await createClient();
  await supabase.auth.signOut();
}
