/**
 * Per-user app lock: PIN hashing and signed unlock cookies.
 *
 * Shared by the proxy (enforcement) and the server actions (unlock, enable,
 * change, disable, recovery). Everything uses Web Crypto so it runs on both
 * the Node and Edge proxy runtimes — no native dependencies.
 *
 * Cookie model (both HMAC-signed with APP_LOCK_SECRET, HttpOnly):
 *   chatter-lock-req  "this account has a lock enabled"  (long-lived hint,
 *                     re-issued by ensureLock; signed per user so one
 *                     account's lock never applies to another on a shared
 *                     device)
 *   chatter-lock-ok   "this device unlocked successfully" — a SESSION cookie
 *                     (no Max-Age): it disappears when the browser/app
 *                     session ends, which is the primary "closed the app"
 *                     signal. Its signed payload still expires after
 *                     LOCK_OK_TTL_SECONDS as an absolute cap, and the shell
 *                     force-relocks on background/kill via a relock flag
 *                     (see chat-shell).
 *   chatter-relock    "the app was closed from the background" — JS-set mirror
 *                     of the shell's localStorage relock flag, so the proxy
 *                     can redirect to /lock on the FIRST document request
 *                     instead of letting the homepage paint and bouncing
 *                     client-side a beat later.
 */

export const LOCK_REQ_COOKIE = "chatter-lock-req";
export const LOCK_OK_COOKIE = "chatter-lock-ok";

/**
 * Unlock validity window. The cookie itself is session-scoped (removed when
 * the app/browser session ends); this is the signed-expiry cap inside the
 * cookie value, so a long-running browser session still re-locks eventually.
 */
export const LOCK_OK_TTL_SECONDS = 12 * 60 * 60;
/** The "lock enabled" hint survives ~6 months; ensureLock re-issues it. */
export const LOCK_REQ_TTL_SECONDS = 180 * 24 * 60 * 60;

/** App passcode: 4–8 digits. */
export const PIN_PATTERN = /^\d{4,8}$/;

/** Time the app may stay backgrounded before it relocks on return. */
export const RELOCK_GRACE_MS_TOUCH = 10_000;
export const RELOCK_GRACE_MS_DESKTOP = 30_000;

/** localStorage flag: set when the app is hidden, so a later cold start can
 *  tell it was closed from the background (works even if the process is
 *  killed before any async cleanup can run). */
export const RELOCK_FLAG_KEY = "chatter-relock";

/**
 * Cookie mirror of the localStorage flag (same name, JS-set, not HttpOnly).
 * localStorage is invisible to the proxy; without this cookie a surviving
 * unlock cookie would let the homepage render before the client bounced to
 * /lock. Explicit Max-Age (not a session cookie) so it survives browser
 * restarts and outlives any pre-fix 12h persistent unlock cookies.
 * Set/cleared together with the localStorage flag — see set/clearRelockFlag.
 */
export const RELOCK_FLAG_COOKIE = "chatter-relock";
export const RELOCK_FLAG_COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

/** Client-only: set the relock flag in BOTH stores (localStorage for this
 *  document's checks, cookie for the proxy's pre-render gate). */
export function setRelockFlag() {
  const ts = String(Date.now());
  try {
    localStorage.setItem(RELOCK_FLAG_KEY, ts);
  } catch {
    // Storage unavailable (private mode) — the cookie below still applies.
  }
  try {
    document.cookie = `${RELOCK_FLAG_COOKIE}=${ts}; path=/; max-age=${RELOCK_FLAG_COOKIE_MAX_AGE}${
      window.location.protocol === "https:" ? "; Secure" : ""
    }`;
  } catch {
    // Cookies unavailable — the localStorage flag still applies at boot.
  }
}

/** Client-only: clear both mirrors (unlock succeeded / quick switch back
 *  within the grace period). */
export function clearRelockFlag() {
  try {
    localStorage.removeItem(RELOCK_FLAG_KEY);
  } catch {
    // Storage unavailable — harmless.
  }
  try {
    document.cookie = `${RELOCK_FLAG_COOKIE}=; path=/; max-age=0`;
  } catch {
    // Cookies unavailable — harmless.
  }
}

const PBKDF2_ITERATIONS = 600_000;
const enc = new TextEncoder();

/* ------------------------------------------------------------------ utils */

function getLockSecret(): string {
  const secret = process.env.APP_LOCK_SECRET;
  if (!secret) {
    throw new Error(
      "APP_LOCK_SECRET is not set. Add it to the deployment environment (and .env.local for development) to enable the app lock."
    );
  }
  return secret;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time comparison of two byte arrays. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time comparison of two ASCII strings. */
function equalStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ----------------------------------------------------------- passcode hash */

async function pbkdf2(
  passcode: string,
  salt: Uint8Array,
  iterations: number,
  byteLength: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    key,
    byteLength * 8
  );
  return new Uint8Array(bits);
}

/** Format: pbkdf2$<iterations>$<salt-b64>$<hash-b64> */
export async function hashPasscode(passcode: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(passcode, salt, PBKDF2_ITERATIONS, 32);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPasscode(passcode: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  if (algorithm !== "pbkdf2") return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 5_000_000) {
    return false;
  }

  try {
    const salt = base64ToBytes(saltRaw);
    const expected = base64ToBytes(hashRaw);
    const actual = await pbkdf2(passcode, salt, iterations, expected.length);
    return equalBytes(actual, expected);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------ signed lock cookies */

async function lockSignature(kind: "req" | "ok", userId: string, expiresAt: number) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getLockSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(`${kind}:${userId}:${expiresAt}`)
  );
  return base64UrlEncode(new Uint8Array(sig));
}

export async function signLockCookie(
  kind: "req" | "ok",
  userId: string,
  ttlSeconds: number
): Promise<{ value: string; maxAge: number }> {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const signature = await lockSignature(kind, userId, expiresAt);
  return { value: `${userId}.${expiresAt}.${signature}`, maxAge: ttlSeconds };
}

export async function verifyLockCookie(
  kind: "req" | "ok",
  raw: string,
  userId: string
): Promise<boolean> {
  const parts = raw.split(".");
  if (parts.length !== 3) return false;

  const [cookieUserId, expiresRaw, signature] = parts;
  const expiresAt = Number(expiresRaw);
  if (cookieUserId !== userId) return false; // another account's lock on this device
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = await lockSignature(kind, cookieUserId, expiresAt);
  return equalStrings(signature, expected);
}

/* -------------------------------------------------------------- evaluation */

export type LockState = {
  /** The signed-in account has the app lock enabled. */
  required: boolean;
  /** This device has a valid, unexpired unlock. */
  unlocked: boolean;
};

export async function readLockState(
  getCookie: (name: string) => string | undefined,
  userId: string
): Promise<LockState> {
  const reqRaw = getCookie(LOCK_REQ_COOKIE);
  const okRaw = getCookie(LOCK_OK_COOKIE);
  const required = reqRaw ? await verifyLockCookie("req", reqRaw, userId) : false;
  const unlocked = okRaw ? await verifyLockCookie("ok", okRaw, userId) : false;
  return { required, unlocked };
}

export function lockCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    // Omitting maxAge makes the cookie session-scoped: the browser drops it
    // when the app/browser session ends (the "app closed" signal).
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

/** Only allow same-site absolute paths in ?next= (blocks open redirects). */
export function sanitizeNext(next: string | string[] | undefined): string {
  const value = Array.isArray(next) ? next[0] : next;
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !value.includes("\n") &&
    !value.includes("\r")
  ) {
    return value;
  }
  return "/";
}
